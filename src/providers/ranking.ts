/**
 * ranking.ts — Phase A blended cross-provider ranking.
 *
 * The old resolver sorted by provider PRIORITY first, using confidence only as a
 * tiebreak. That meant a low-priority provider with a genuinely more relevant
 * result (high confidence) always lost to a high-priority provider with a weak
 * result — the opposite of what a ranking spine should do.
 *
 * This blends both into one score so confidence and priority both matter:
 *   score = W·confidence + (1-W)·priorityWeight        (W = RANK_CONFIDENCE_WEIGHT)
 * priorityWeight maps the priority list to [0,1] (top of list → ~1, unknown → 0),
 * so priority still contributes a real signal — it's just no longer absolute.
 *
 * Pure + deterministic (stable tiebreaks) so it's unit-testable in isolation.
 */

import type { ProviderResult } from "./types.js";

/** Map a provider's position in the priority list to a weight in [0,1].
 *  Top of list → ~1; not in list → 0. */
export function priorityWeight(
  provider: string,
  priority: readonly string[]
): number {
  const idx = priority.indexOf(provider);
  return idx === -1 ? 0 : (priority.length - idx) / priority.length;
}

/** Blended relevance score: W·confidence + (1-W)·priorityWeight. */
export function blendScore(
  r: ProviderResult,
  priority: readonly string[],
  weight: number
): number {
  return weight * r.confidence + (1 - weight) * priorityWeight(r.provider, priority);
}

/**
 * Sort highest-relevance first by blended score. Deterministic tiebreaks:
 * equal score → higher raw confidence → lower priority index. Returns a new
 * array (does not mutate the input).
 */
export function blendSort(
  results: readonly ProviderResult[],
  priority: readonly string[],
  weight: number
): ProviderResult[] {
  return [...results].sort((a, b) => {
    const sb = blendScore(b, priority, weight);
    const sa = blendScore(a, priority, weight);
    if (sb !== sa) return sb - sa;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    const ai = priority.indexOf(a.provider);
    const bi = priority.indexOf(b.provider);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}
