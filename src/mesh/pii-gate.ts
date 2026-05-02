/**
 * v4.0 Mesh — PII gate.
 *
 * Every outbound mesh envelope passes through `stripPii` before signing.
 * Every inbound envelope passes through `containsPii` for an audit-only
 * check (we don't reject inbound on PII detection — we log it and let
 * trust scoring handle the trend).
 *
 * Categories (14):
 *   1. emails
 *   2. high-entropy API keys (10+ entropy chars)
 *   3. AWS access key IDs (AKIA*, ASIA*)
 *   4. AWS secret access keys (40-char base64ish following an AWS key context)
 *   5. JWT-like tokens (xxx.yyy.zzz)
 *   6. Bitcoin addresses
 *   7. Ethereum-style 0x addresses (40 hex chars)
 *   8. IPv4 addresses (private + public, both stripped)
 *   9. Phone numbers (E.164 + common formats)
 *  10. SSN-like patterns (NNN-NN-NNNN)
 *  11. Credit-card-like patterns (Luhn-validated)
 *  12. Absolute filesystem paths under /Users/, /home/, C:\Users\
 *  13. Hostnames (FQDN with TLD)
 *  14. Bearer tokens / Authorization-header values
 *
 * The stripper is intentionally aggressive. Federation users opt-in, and a
 * false positive (over-redaction) is far preferable to a real leak.
 *
 * Tested against `tests/fixtures/pii-zoo.json` which we curate to cover
 * each category PLUS edge cases (e.g., emails inside Markdown links,
 * phone numbers with extensions, IPv4 in CIDR notation).
 */

const REDACTED = "[REDACTED]";

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  // (1) Email
  { name: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // (3) AWS access key ID
  { name: "aws-access-key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  // (5) JWT
  {
    name: "jwt",
    re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  },
  // (14) Bearer token in Authorization-style headers
  { name: "bearer", re: /\b(?:Bearer|Token)\s+[A-Za-z0-9._\-+/=]{16,}\b/g },
  // (7) Ethereum 0x40-hex
  { name: "eth-address", re: /\b0x[a-fA-F0-9]{40}\b/g },
  // (6) Bitcoin (legacy + bech32 — slightly loose but high-precision in practice)
  {
    name: "btc-address",
    re: /\b(?:bc1[ac-hj-np-z02-9]{11,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g,
  },
  // (10) SSN-like
  { name: "ssn-like", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  // (9a) Phone — US/CAN style 3-3-4 with optional country code.
  {
    name: "phone",
    re: /\+?\b(?:\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  },
  // (9b) Phone — international E.164-ish: +CC followed by 7–14 digits with
  // optional spaces/dashes. Catches UK `+44 20 7946 0958`, French
  // `+33 1 23 45 67 89`, etc.
  {
    name: "phone",
    re: /\+\d{1,3}[-.\s]?\d{1,4}(?:[-.\s]?\d{1,4}){2,5}\b/g,
  },
  // (8) IPv4. Match before (12)/(13) so subnets don't survive as hostnames.
  {
    name: "ipv4",
    re: /\b(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}(?:\/\d{1,2})?\b/g,
  },
  // (12) Filesystem paths
  {
    name: "fs-path",
    re: /(?:\/Users\/|\/home\/|[A-Z]:\\Users\\)[^\s"'<>]+/g,
  },
  // (13) Hostname-ish FQDN — must have at least one dot and a 2+ char TLD.
  // Skip common code-style identifiers (no `.com.example.foo` chains; require TLD-shaped suffix).
  {
    name: "hostname",
    re: /\b[a-zA-Z0-9-]{1,63}(?:\.[a-zA-Z0-9-]{1,63})*\.[a-zA-Z]{2,24}\b/g,
  },
];

/** Does the input contain anything matched by our PII rules? */
export function containsPii(input: string): boolean {
  for (const { re } of PATTERNS) {
    if (resetAndTest(re, input)) return true;
  }
  // Categories (2), (4), (11) — these need byte-level checks.
  if (containsHighEntropyToken(input)) return true;
  if (containsLuhnValidCard(input)) return true;
  return false;
}

/**
 * Strip PII from a string, replacing each match with `[REDACTED]`. Returns
 * the redacted string plus the categories that fired.
 */
export function stripPii(input: string): { redacted: string; categories: string[] } {
  const fired = new Set<string>();
  let out = input;
  for (const { name, re } of PATTERNS) {
    out = replaceAndRecord(re, out, () => {
      fired.add(name);
      return REDACTED;
    });
  }
  // Pass: high-entropy token sweep
  out = stripHighEntropyTokens(out, () => fired.add("high-entropy-token"));
  // Pass: Luhn-valid card numbers
  out = stripLuhnCards(out, () => fired.add("credit-card"));
  return { redacted: out, categories: Array.from(fired) };
}

/**
 * Recursively strip PII from any JSON-serializable value. Strings get
 * `stripPii` applied. Objects and arrays recurse. Other primitives pass
 * through unchanged.
 */
export function stripPiiDeep(value: unknown): { value: unknown; categories: string[] } {
  const all = new Set<string>();
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const { redacted, categories } = stripPii(v);
      categories.forEach((c) => all.add(c));
      return redacted;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[k] = walk(val);
      }
      return out;
    }
    return v;
  };
  return { value: walk(value), categories: Array.from(all) };
}

// ─── helpers ──────────────────────────────────────────────────────────────

function resetAndTest(re: RegExp, s: string): boolean {
  re.lastIndex = 0;
  return re.test(s);
}

function replaceAndRecord(
  re: RegExp,
  s: string,
  onMatch: () => string,
): string {
  re.lastIndex = 0;
  return s.replace(re, () => onMatch());
}

/**
 * Heuristic for unmarked secret-shaped tokens. Matches strings that look
 * like base64url or hex tokens with high Shannon entropy.
 *
 * False-positive surface: long random IDs (UUIDs, ULIDs). We dedupe by
 * leaving values shorter than 24 chars alone — UUIDs without hyphens (32
 * chars) still get caught, which is the right call because if your code
 * leaks a UUID secret-key, you do want it stripped.
 */
function containsHighEntropyToken(s: string): boolean {
  return findHighEntropyTokens(s).length > 0;
}

function stripHighEntropyTokens(s: string, onHit: () => void): string {
  const matches = findHighEntropyTokens(s);
  if (matches.length === 0) return s;
  let out = s;
  for (const m of matches) {
    out = out.replaceAll(m, REDACTED);
    onHit();
  }
  return out;
}

function findHighEntropyTokens(s: string): string[] {
  const candidates = s.match(/[A-Za-z0-9_+/=-]{24,}/g) ?? [];
  return candidates.filter((c) => shannonEntropy(c) >= 4.0);
}

function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

function containsLuhnValidCard(s: string): boolean {
  const matches = s.match(/\b(?:\d[ -]?){13,19}\b/g) ?? [];
  return matches.some((m) => isLuhnValid(m.replace(/[^\d]/g, "")));
}

function stripLuhnCards(s: string, onHit: () => void): string {
  return s.replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => {
    if (isLuhnValid(m.replace(/[^\d]/g, ""))) {
      onHit();
      return REDACTED;
    }
    return m;
  });
}

function isLuhnValid(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}
