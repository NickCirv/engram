/**
 * v4.0 Mesh — JCS (RFC 8785) canonical JSON serialization.
 *
 * Used to produce the byte sequence we sign with ed25519. Both sender and
 * receiver must agree byte-for-byte, so we follow the JCS rules:
 *
 *   1. Object keys sorted lexicographically by UTF-16 code units.
 *   2. No insignificant whitespace anywhere.
 *   3. Strings serialized per RFC 8259 with the JCS-specific escapes.
 *   4. Numbers serialized per ECMAScript ToString(Number).
 *   5. null, true, false serialized literally.
 *
 * Pure JS implementation — no native dep. ~30 LoC core. The cost of
 * adopting `canonicalize` from npm vs vendoring this is roughly equal,
 * and vendoring keeps the install lean.
 *
 * RFC 8785: https://datatracker.ietf.org/doc/html/rfc8785
 */

/**
 * Canonicalize a JSON value per RFC 8785. Throws on:
 *   - undefined values (can't be serialized)
 *   - functions (can't be serialized)
 *   - circular references
 *   - non-finite numbers (NaN, Infinity)
 *
 * Returns a UTF-8 byte sequence as a Uint8Array, ready to sign.
 */
export function canonicalize(value: unknown): Uint8Array {
  const text = canonicalizeToString(value);
  return new TextEncoder().encode(text);
}

/**
 * Same as canonicalize() but returns the string form. Useful for tests
 * and for debugging signature mismatches.
 */
export function canonicalizeToString(value: unknown): string {
  return serialize(value, new WeakSet());
}

function serialize(value: unknown, seen: WeakSet<object>): string {
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`canonicalize: non-finite number ${value}`);
    }
    return numberToString(value);
  }

  if (typeof value === "string") {
    return stringEscape(value);
  }

  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    throw new Error(`canonicalize: unserializable type ${typeof value}`);
  }

  if (typeof value === "bigint") {
    throw new Error("canonicalize: bigint not supported");
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error("canonicalize: circular reference");
    seen.add(value);
    try {
      const parts = value.map((v) => serialize(v, seen));
      return `[${parts.join(",")}]`;
    } finally {
      seen.delete(value);
    }
  }

  // Plain object
  const obj = value as Record<string, unknown>;
  if (seen.has(obj)) throw new Error("canonicalize: circular reference");
  seen.add(obj);
  try {
    // Filter out undefined keys (they're ignored, not errors, per JCS conventions
    // for round-tripping JSON.parse output).
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort(compareCodeUnits);
    const parts = keys.map((k) => `${stringEscape(k)}:${serialize(obj[k], seen)}`);
    return `{${parts.join(",")}}`;
  } finally {
    seen.delete(obj);
  }
}

/** Lexicographic comparison by UTF-16 code unit. JS strings are already UTF-16. */
function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Serialize a string with the JCS escape rules (which match RFC 8259 strictly).
 * Control characters U+0000 through U+001F MUST be escaped.
 * Quote and backslash MUST be escaped.
 * Forward slash MAY remain unescaped (we leave it alone).
 */
function stringEscape(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22) {
      out += '\\"';
    } else if (c === 0x5c) {
      out += "\\\\";
    } else if (c === 0x08) {
      out += "\\b";
    } else if (c === 0x09) {
      out += "\\t";
    } else if (c === 0x0a) {
      out += "\\n";
    } else if (c === 0x0c) {
      out += "\\f";
    } else if (c === 0x0d) {
      out += "\\r";
    } else if (c < 0x20) {
      out += "\\u" + c.toString(16).padStart(4, "0");
    } else {
      out += s[i];
    }
  }
  out += '"';
  return out;
}

/**
 * Serialize a finite number per ECMAScript ToString(Number) — which JCS
 * adopts as the canonical form. JavaScript's String(n) already implements
 * this for finite numbers.
 */
function numberToString(n: number): string {
  if (Object.is(n, -0)) return "0"; // JCS folds -0 to 0
  return String(n);
}

/**
 * Strip the `sig` field from an envelope and canonicalize the result.
 * This is what the sender signs and the receiver verifies.
 */
export function canonicalizeEnvelopeForSigning(env: {
  readonly [k: string]: unknown;
}): Uint8Array {
  // Object spread preserves all keys, then we delete `sig` from a clone.
  const { sig, ...rest } = env as { sig?: unknown };
  void sig;
  return canonicalize(rest);
}
