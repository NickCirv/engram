/**
 * dedup.ts — Phase A displacement: collapse redundant context ACROSS providers.
 *
 * The resolver fans out to many providers (built-in + plugin + MCP). Two of them
 * routinely return the SAME thing (structure ↔ an MCP code-graph; mistakes ↔ git;
 * mempalace ↔ obsidian). Concatenating both INFLATES the packet — the opposite of
 * what a context spine should do. This module turns concatenation into
 * DISPLACEMENT: given results already ranked highest-first, it keeps the
 * highest-ranked member of each duplicate cluster and discards the rest, reporting
 * how many tokens it eliminated.
 *
 * Honesty (W1.9): this only ever REMOVES content — it can never grow the packet.
 * The accounting is "redundancy eliminated", never "cost saved".
 *
 * Pure + dependency-free: shingled Jaccard over normalized content (FNV-1a hashing,
 * no embeddings — see docs/design/phaseA-displacement-resolver.md §2a for the
 * data-gated justification on why hashing first). The token estimator is injected
 * so this stays unit-testable without the resolver's internals.
 */

import type { ProviderResult } from "./types.js";

/** k-shingle width (words). 5 balances reformatting-tolerance vs topic-collision. */
export const SHINGLE_W = 5;
/** Section-level Jaccard ≥ this ⇒ duplicate section. Tolerates reformatting. */
export const SECTION_THRESHOLD = 0.85;
/** Line-level Jaccard ≥ this ⇒ duplicate line (stricter — partial overlap). */
export const LINE_THRESHOLD = 0.9;

/** FNV-1a 32-bit. Fast, no deps, good enough for shingle identity. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Normalize for comparison: NFKC-fold, lowercase, strip markdown headers +
 * bracketed labels (so `[engram:git]`-style section noise doesn't drive matches),
 * collapse all whitespace. Comparison-only — the original content is preserved.
 */
export function normalize(content: string): string {
  return content
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^#+\s*/gm, "") // markdown headers
    .replace(/\[[^\]\n]*\]/g, " ") // [label] noise
    .replace(/\s+/g, " ")
    .trim();
}

/** Word-level k-shingle set of normalized text. Short text → one whole-text shingle. */
export function shingles(normText: string, w: number = SHINGLE_W): Set<number> {
  const set = new Set<number>();
  const words = normText.split(" ").filter(Boolean);
  if (words.length === 0) return set;
  if (words.length < w) {
    set.add(fnv1a(words.join(" ")));
    return set;
  }
  for (let i = 0; i + w <= words.length; i++) {
    set.add(fnv1a(words.slice(i, i + w).join(" ")));
  }
  return set;
}

/** Jaccard similarity of two shingle sets. Both empty ⇒ 1; one empty ⇒ 0. */
export function jaccard(a: Set<number>, b: Set<number>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const x of small) if (large.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface DedupOutput {
  /** Survivors, in the input (ranked) order, with line-level dupes stripped. */
  readonly kept: ProviderResult[];
  /** Tokens removed by section + line dedup (for engram-counter attestation). */
  readonly redundantTokens: number;
}

/**
 * Collapse cross-provider redundancy. `ranked` MUST be pre-sorted highest-first
 * (the resolver blends confidence+priority before calling this) so the kept member
 * of every cluster is the most relevant. Two passes:
 *   1. SECTION dedup — drop a whole result whose shingles ≥ SECTION_THRESHOLD vs
 *      any already-kept result.
 *   2. LINE dedup — within survivors (in rank order), drop individual lines whose
 *      shingles ≥ LINE_THRESHOLD vs a line already emitted by a higher-ranked
 *      result. A result whose body falls to nothing is dropped entirely.
 * Total-monotonic: output content ⊆ input content, so it can never grow the packet.
 */
export function dedupResults(
  ranked: readonly ProviderResult[],
  estimateTokens: (s: string) => number,
  opts: { sectionThreshold?: number; lineThreshold?: number } = {}
): DedupOutput {
  const sectionT = opts.sectionThreshold ?? SECTION_THRESHOLD;
  const lineT = opts.lineThreshold ?? LINE_THRESHOLD;

  const kept: ProviderResult[] = [];
  const keptShingles: Set<number>[] = [];
  const emittedLineShingles: Set<number>[] = [];
  let redundantTokens = 0;

  for (const r of ranked) {
    // Defensive: a malformed provider result must never break dedup.
    if (!r || typeof r.content !== "string") continue;
    const norm = normalize(r.content);
    if (norm.length === 0) {
      kept.push(r); // nothing to compare; pass through untouched
      continue;
    }

    const sh = shingles(norm);
    if (keptShingles.some((ks) => jaccard(sh, ks) >= sectionT)) {
      redundantTokens += estimateTokens(r.content); // whole section is redundant
      continue;
    }

    // Line-level dedup within this (kept) result.
    const lines = r.content.split("\n");
    const survivors: string[] = [];
    let droppedLineTokens = 0;
    for (const line of lines) {
      const ln = normalize(line);
      if (ln.length === 0) {
        survivors.push(line); // preserve blank/structural lines
        continue;
      }
      const lsh = shingles(ln);
      if (emittedLineShingles.some((es) => jaccard(lsh, es) >= lineT)) {
        droppedLineTokens += estimateTokens(line);
        continue;
      }
      survivors.push(line);
      emittedLineShingles.push(lsh);
    }

    const newContent = survivors.join("\n");
    if (normalize(newContent).length === 0) {
      // Body fully dedup'd away → drop the orphaned section entirely.
      redundantTokens += estimateTokens(r.content);
      continue;
    }

    redundantTokens += droppedLineTokens;
    keptShingles.push(sh);
    kept.push(newContent === r.content ? r : { ...r, content: newContent });
  }

  return { kept, redundantTokens };
}

export interface Displacement {
  /** Results to assemble (deduped), or the original ranked set if the
   *  never-worse backstop tripped. */
  readonly kept: ProviderResult[];
  /** Tokens removed by dedup (redundancy eliminated). */
  readonly redundantTokens: number;
  /** Content tokens displaced before budgeting (baseline − final). Always ≥ 0. */
  readonly tokensDisplaced: number;
  /** Candidate-set content tokens BEFORE dedup (what engram would emit today). */
  readonly baselineTokens: number;
}

/**
 * The resolver's displacement step as a pure, testable unit: measure baseline,
 * dedup, measure final, apply a never-worse backstop, and report honest counters.
 * `ranked` MUST be pre-sorted highest-first. Because dedup is monotonic the gate
 * never trips in practice — it's a belt-and-braces guard against any future
 * regression that could inflate content. Returns counters labelled "displaced" /
 * "redundancy eliminated" — never "saved" (W1.9).
 */
export function applyDisplacement(
  ranked: readonly ProviderResult[],
  estimateTokens: (s: string) => number
): Displacement {
  const baselineTokens = ranked.reduce(
    (sum, r) => sum + (typeof r?.content === "string" ? estimateTokens(r.content) : 0),
    0
  );
  const { kept, redundantTokens } = dedupResults(ranked, estimateTokens);
  const finalTokens = kept.reduce((sum, r) => sum + estimateTokens(r.content), 0);

  if (finalTokens > baselineTokens) {
    // Should be impossible (dedup only removes) — fall back to the original set.
    return { kept: [...ranked], redundantTokens: 0, tokensDisplaced: 0, baselineTokens };
  }
  return { kept, redundantTokens, tokensDisplaced: baselineTokens - finalTokens, baselineTokens };
}
