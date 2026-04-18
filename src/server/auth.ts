/**
 * engram HTTP server auth — token management, constant-time comparison,
 * cookie parsing.
 *
 * Token resolution priority:
 *   1. process.env.ENGRAM_API_TOKEN (power-user override)
 *   2. ~/.engram/http-server.token (auto-generated on first start, 0600)
 *
 * Rationale: the local HTTP server must be fail-closed. Any browser tab the
 * developer visits is a local client — wildcard CORS + auth-off-by-default
 * previously enabled graph exfiltration and persistent prompt injection via
 * Sentinel-surfaced mistake nodes. See issue #7 / GHSA.
 */
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TOKEN_MIN_LEN = 32;
const TOKEN_BYTES = 32; // 64-char hex output

export interface TokenInfo {
  /** The resolved token value. */
  readonly token: string;
  /** Where the token came from — useful for CLI banner messaging. */
  readonly source: "env" | "file" | "generated";
  /** Absolute path to the token file, if one was read or written. */
  readonly path: string | null;
}

function tokenDir(): string {
  return join(homedir(), ".engram");
}

function tokenPath(): string {
  return join(tokenDir(), "http-server.token");
}

/**
 * Resolve the server auth token. Reads ENGRAM_API_TOKEN env, then the
 * on-disk cache, otherwise generates a fresh 32-byte random token and
 * persists it to ~/.engram/http-server.token with mode 0600.
 *
 * Idempotent: subsequent calls return the same token unless the file is
 * deleted or the env var changes.
 */
export function getOrCreateToken(): TokenInfo {
  const envToken = process.env.ENGRAM_API_TOKEN;
  if (envToken && envToken.length >= TOKEN_MIN_LEN) {
    return { token: envToken, source: "env", path: null };
  }

  const path = tokenPath();
  if (existsSync(path)) {
    try {
      const cached = readFileSync(path, "utf8").trim();
      if (cached.length >= TOKEN_MIN_LEN) {
        return { token: cached, source: "file", path };
      }
    } catch {
      // fall through to regenerate
    }
  }

  const fresh = randomBytes(TOKEN_BYTES).toString("hex");
  const dir = tokenDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, fresh + "\n", { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows chmod is a no-op — acceptable.
  }
  return { token: fresh, source: "generated", path };
}

/**
 * Constant-time string comparison. Prevents timing attacks on token
 * validation. Returns false on length mismatch (length itself is not secret).
 *
 * Defence-in-depth: empty inputs never match. Guards against the footgun
 * where both the presented and expected token somehow end up empty strings
 * (regressions, misconfig, corrupt token file) — `safeEqual("", "")` would
 * otherwise trivially return true.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Parse a `Cookie` header value into a flat record. Tolerant of missing
 * values, extra whitespace, and multiple pairs. Returns `{}` on any input
 * that isn't a string.
 */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header || typeof header !== "string") return out;
  for (const pair of header.split(/;\s*/)) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Validate the Host header against the bound port. Rejects DNS rebinding
 * and Host spoofing. Accepts `127.0.0.1`, `localhost`, and `::1` on the
 * configured port.
 */
export function isHostValid(hostHeader: string | undefined, port: number): boolean {
  if (!hostHeader) return false;

  let hostname: string;
  let portStr: string;

  // IPv6 bracketed form: [::1]:7337
  if (hostHeader.startsWith("[")) {
    const close = hostHeader.indexOf("]");
    if (close < 0) return false;
    hostname = hostHeader.slice(1, close);
    portStr = hostHeader.slice(close + 2); // skip "]:"
  } else {
    const colon = hostHeader.lastIndexOf(":");
    if (colon < 0) {
      hostname = hostHeader;
      portStr = "";
    } else {
      hostname = hostHeader.slice(0, colon);
      portStr = hostHeader.slice(colon + 1);
    }
  }

  // Lowercase hostname — RFC 3986 says host is case-insensitive. Browsers
  // already lowercase, but non-browser clients may send mixed case.
  const h = hostname.toLowerCase();
  if (h !== "127.0.0.1" && h !== "localhost" && h !== "::1") return false;

  // Require the port to match exactly. Previously a missing port (`Host:
  // 127.0.0.1`) was accepted, which violated the stated "bound-port only"
  // invariant. Tighten to explicit equality.
  if (portStr !== String(port)) return false;
  return true;
}

/**
 * Check whether an Origin header value is allowed. Same-origin (127.0.0.1
 * or localhost on the server's port) is always allowed. Additional origins
 * can be permitted via ENGRAM_ALLOWED_ORIGINS (comma-separated).
 */
export function isOriginAllowed(origin: string, port: number): boolean {
  if (origin === `http://127.0.0.1:${port}`) return true;
  if (origin === `http://localhost:${port}`) return true;

  const env = process.env.ENGRAM_ALLOWED_ORIGINS;
  if (!env) return false;
  const list = env
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.includes(origin);
}
