import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  initIdentity,
  loadIdentity,
  signBytes,
  verifyBytes,
  computeFingerprint,
  exportPublicKey,
} from "../../src/mesh/index.js";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "engram-mesh-id-"));
}

describe("mesh.identity.initIdentity", () => {
  it("creates a fresh keypair when none exists", () => {
    const dir = freshDir();
    const id = initIdentity(dir);
    expect(existsSync(id.privatePath)).toBe(true);
    expect(existsSync(id.publicPath)).toBe(true);
    expect(id.fingerprint).toMatch(/^[A-Za-z0-9_-]+$/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("persists the private key with mode 0600", () => {
    if (process.platform === "win32") return; // Windows perms differ
    const dir = freshDir();
    const id = initIdentity(dir);
    const mode = statSync(id.privatePath).mode & 0o777;
    expect(mode).toBe(0o600);
    rmSync(dir, { recursive: true, force: true });
  });

  it("is idempotent — re-init returns same fingerprint", () => {
    const dir = freshDir();
    const a = initIdentity(dir);
    const b = initIdentity(dir);
    expect(b.fingerprint).toBe(a.fingerprint);
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws when only one of the keypair files is present", () => {
    const dir = freshDir();
    initIdentity(dir);
    rmSync(join(dir, "public.key"));
    expect(() => initIdentity(dir)).toThrow(/inconsistent/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("mesh.identity.loadIdentity", () => {
  it("loads a pre-initialized identity", () => {
    const dir = freshDir();
    const init = initIdentity(dir);
    const loaded = loadIdentity(dir);
    expect(loaded.fingerprint).toBe(init.fingerprint);
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws when uninitialized", () => {
    const dir = freshDir();
    expect(() => loadIdentity(dir)).toThrow(/not initialized/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("mesh.identity sign/verify round trip", () => {
  it("signs and verifies bytes successfully", () => {
    const dir = freshDir();
    const id = initIdentity(dir);
    const message = new TextEncoder().encode("hello mesh");
    const sig = signBytes(id, message);
    const pubKey = exportPublicKey(id);
    expect(verifyBytes(pubKey, message, sig)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects a tampered message", () => {
    const dir = freshDir();
    const id = initIdentity(dir);
    const message = new TextEncoder().encode("hello mesh");
    const sig = signBytes(id, message);
    const tampered = new TextEncoder().encode("hello evil");
    const pubKey = exportPublicKey(id);
    expect(verifyBytes(pubKey, tampered, sig)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects a malformed base64 signature", () => {
    const dir = freshDir();
    const id = initIdentity(dir);
    const message = new TextEncoder().encode("hello mesh");
    const pubKey = exportPublicKey(id);
    expect(verifyBytes(pubKey, message, "not-base64-!!!")).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("mesh.identity.computeFingerprint", () => {
  it("is deterministic for a given key", () => {
    const dir = freshDir();
    const id = initIdentity(dir);
    const pub = exportPublicKey(id);
    expect(computeFingerprint(pub)).toBe(computeFingerprint(pub));
    rmSync(dir, { recursive: true, force: true });
  });

  it("differs across distinct keypairs", () => {
    const a = initIdentity(freshDir());
    const b = initIdentity(freshDir());
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });
});
