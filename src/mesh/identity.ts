/**
 * v4.0 Mesh — ed25519 identity management.
 *
 * Generates, persists, and loads ed25519 keypairs at ~/.engram/mesh/.
 * Uses Node's built-in crypto module — no native deps. ed25519 has been
 * in Node since 12.0.0 stable; we target Node 20+ so it's solid.
 *
 * Storage layout:
 *   ~/.engram/mesh/
 *     ├─ private.key      0600  raw 32 bytes (signing key seed)
 *     ├─ public.key       0644  raw 32 bytes (verification key)
 *     └─ fingerprint      0644  base64url(SHA-256(public.key))
 *
 * The fingerprint is the stable peer identifier used in the `from` field
 * of every wire envelope. Public key is shipped via peer.hello during
 * handshake so peers can verify subsequent signatures.
 *
 * Private key NEVER leaves the machine. There is no export command on
 * purpose — losing a key means rotating, not recovering.
 */
import {
  generateKeyPairSync,
  sign,
  verify,
  createHash,
  createPrivateKey,
  createPublicKey,
} from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const MESH_DIR_NAME = ".engram/mesh";

export interface MeshIdentity {
  /** Path to the directory holding the keypair. */
  readonly dir: string;
  /** Path to the private key file (raw 32 bytes). */
  readonly privatePath: string;
  /** Path to the public key file (raw 32 bytes). */
  readonly publicPath: string;
  /** base64url(SHA-256(publicKey)). Stable across sessions. */
  readonly fingerprint: string;
}

/** Resolve the canonical mesh directory for the current user. */
export function meshDir(home: string = homedir()): string {
  return join(home, MESH_DIR_NAME);
}

/**
 * Initialize a fresh ed25519 identity at the given directory. Idempotent —
 * if a keypair already exists, returns it without regenerating.
 *
 * Throws on:
 *   - filesystem write failure (rare, surfaced)
 *   - inconsistent existing state (private without public, or vice versa)
 */
export function initIdentity(dir: string = meshDir()): MeshIdentity {
  mkdirSync(dir, { recursive: true });
  const privatePath = join(dir, "private.key");
  const publicPath = join(dir, "public.key");
  const fingerprintPath = join(dir, "fingerprint");

  const privExists = existsSync(privatePath);
  const pubExists = existsSync(publicPath);
  if (privExists !== pubExists) {
    throw new Error(
      `mesh identity inconsistent: private.key=${privExists} public.key=${pubExists}. ` +
        `Resolve manually or run \`engram mesh keygen\` to rotate.`,
    );
  }

  if (privExists && pubExists) {
    const fingerprint = existsSync(fingerprintPath)
      ? readFileSync(fingerprintPath, "utf8").trim()
      : computeFingerprint(readFileSync(publicPath));
    return { dir, privatePath, publicPath, fingerprint };
  }

  // Generate fresh keypair using Node's built-in. Output `der` raw seed plus
  // raw 32-byte public.
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicRaw = publicKey.export({ format: "der", type: "spki" });
  const privateRaw = privateKey.export({ format: "der", type: "pkcs8" });

  // Persist DER-encoded forms (Node's sign/verify accept these directly).
  writeFileSync(privatePath, privateRaw, { mode: 0o600 });
  writeFileSync(publicPath, publicRaw, { mode: 0o644 });
  chmodSync(privatePath, 0o600); // Defensive — some shells ignore the mode arg.

  const fingerprint = computeFingerprint(publicRaw);
  writeFileSync(fingerprintPath, fingerprint, { mode: 0o644 });

  return { dir, privatePath, publicPath, fingerprint };
}

/**
 * Load an existing identity. Throws if not initialized — the caller should
 * call `initIdentity` first or surface the error to the user.
 */
export function loadIdentity(dir: string = meshDir()): MeshIdentity {
  const privatePath = join(dir, "private.key");
  const publicPath = join(dir, "public.key");
  if (!existsSync(privatePath) || !existsSync(publicPath)) {
    throw new Error(
      `mesh identity not initialized at ${dir}. Run \`engram mesh init\` first.`,
    );
  }
  const fingerprintPath = join(dir, "fingerprint");
  const fingerprint = existsSync(fingerprintPath)
    ? readFileSync(fingerprintPath, "utf8").trim()
    : computeFingerprint(readFileSync(publicPath));
  return { dir, privatePath, publicPath, fingerprint };
}

/**
 * Sign a byte sequence with the given identity's private key.
 * Returns a base64-encoded signature.
 *
 * The bytes argument should already be a JCS-canonical envelope minus its
 * `sig` field — see `jcs.ts::canonicalizeEnvelopeForSigning`.
 */
export function signBytes(identity: MeshIdentity, bytes: Uint8Array): string {
  const privDer = readFileSync(identity.privatePath);
  const key = createPrivateKey({ key: privDer, format: "der", type: "pkcs8" });
  const sigBuf = sign(null, Buffer.from(bytes), key);
  return sigBuf.toString("base64");
}

/**
 * Verify a base64 signature against a byte sequence using the given peer's
 * public key (DER-encoded, as exported by `peer.hello`).
 *
 * Returns true on valid signature, false on invalid. Never throws on a
 * malformed signature — only on a malformed public key (which is an
 * upstream programmer error worth surfacing).
 */
export function verifyBytes(
  publicKeyDer: Uint8Array,
  bytes: Uint8Array,
  signatureBase64: string,
): boolean {
  let key;
  try {
    key = createPublicKey({ key: Buffer.from(publicKeyDer), format: "der", type: "spki" });
  } catch (err) {
    throw new Error(`mesh: malformed public key DER (${(err as Error).message})`);
  }
  let sigBuf: Buffer;
  try {
    sigBuf = Buffer.from(signatureBase64, "base64");
  } catch {
    return false;
  }
  return verify(null, Buffer.from(bytes), key, sigBuf);
}

/**
 * Compute the stable fingerprint for a public key.
 * SHA-256 → base64url, no padding. URL-safe so it can travel as a query
 * param if needed.
 */
export function computeFingerprint(publicKeyDer: Uint8Array): string {
  const hash = createHash("sha256").update(Buffer.from(publicKeyDer)).digest();
  return hash.toString("base64url");
}

/**
 * Read the public key bytes for sharing in `peer.hello`.
 * Returns DER-encoded SPKI bytes.
 */
export function exportPublicKey(identity: MeshIdentity): Uint8Array {
  return readFileSync(identity.publicPath);
}
