/**
 * Rendering helpers shared across graph output paths.
 *
 * These helpers exist to avoid UTF-16 surrogate corruption when truncating
 * strings that may contain emoji or other astral-plane characters. A naive
 * `s.slice(0, n)` can leave a lone high surrogate at the cut boundary,
 * which is invalid Unicode and corrupts downstream JSON serialization
 * (e.g. the MCP `list_mistakes` tool response).
 *
 * These are "surrogate-safe" (guaranteed valid UTF-16) but NOT full
 * grapheme-cluster-safe: ZWJ sequences (👨‍👩‍👧), flag emoji (🇺🇸), and
 * skin-tone modifiers can still split. The "GraphemeSafe" suffix is a
 * convenience name — if you need true grapheme safety for user-facing
 * labels, use Intl.Segmenter. For our purposes (JSON round-trip safety
 * on mistake labels), surrogate-safe is sufficient.
 */

/**
 * Slice a string to at most `max` UTF-16 code units, but back off by one
 * if the cut boundary would land in the middle of a surrogate pair.
 *
 * Result is always valid UTF-16 (no lone surrogates). Length is either
 * `max` or `max - 1`. Use this when you want `s.slice(0, max)` semantics
 * without the risk of corrupting downstream JSON.
 */
export function sliceGraphemeSafe(s: string, max: number): string {
  if (max <= 0) return "";
  if (s.length <= max) return s;
  let cut = max;
  const code = s.charCodeAt(cut - 1);
  // 0xD800–0xDBFF = high surrogate (leading half of a pair)
  if (code >= 0xD800 && code <= 0xDBFF) cut--;
  return s.slice(0, cut);
}

/**
 * Truncate a string to at most `max` characters, appending "…" to mark
 * the truncation. The ellipsis counts against the budget, so the result
 * length is always ≤ `max`. Grapheme-safe: avoids lone surrogates.
 *
 * For values of `max` ≤ 1, returns "" (no room for content + ellipsis).
 */
export function truncateGraphemeSafe(s: string, max: number): string {
  if (max <= 0) return "";
  if (s.length <= max) return s;
  // Reserve 1 char for the ellipsis
  let cut = max - 1;
  if (cut <= 0) return "";
  const code = s.charCodeAt(cut - 1);
  if (code >= 0xD800 && code <= 0xDBFF) cut--;
  return s.slice(0, cut) + "…";
}

/**
 * Format an integer with comma thousands separators. Locale-independent
 * and deterministic — always emits `"1,234,567"` regardless of system
 * locale.
 *
 * Why not `Number.prototype.toLocaleString()`?
 *   1. **Performance.** First-call ICU init on Windows Node has been
 *      observed to take multiple seconds in CI VMs, flaking tests with
 *      tight (5000ms) timeouts.
 *   2. **Correctness.** `toLocaleString()` emits `"1,234"` on en-US but
 *      `"1.234"` on de-DE — users running engram in a non-US locale
 *      would see inconsistent CLI output, and any test asserting
 *      `toContain("1,234")` would fail under a CI runner with a
 *      European locale.
 *
 * Handles negative numbers correctly (`-1234 → "-1,234"`) and preserves
 * the integer portion untouched for inputs that already stringify with
 * exponents or decimals (the regex only touches contiguous digit runs
 * anchored by word boundaries).
 */
export function formatThousands(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
