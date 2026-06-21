/**
 * related-files.ts — tiered "you'll likely also need these files" for a focal
 * file, for the sub-agent context broker (#83/#139).
 *
 * TIERING (bench-validated): graph-adjacent files FIRST (real call/import edges —
 * highest precision, #139), then GIT CO-CHANGE (files historically changed
 * together — #141 temporal-holdout: weak alone, but combined with path-reach it
 * beats a popularity baseline on 3/3 repos, CI excludes 0; it's the only source
 * that reaches cross-directory pairs like route↔schema that path-reach can't),
 * then PATH-REACH (test↔impl above same-dir siblings, #139). Each lower tier only
 * fills the slots the higher tiers left empty, so a focal with rich graph
 * adjacency is unaffected — never-worse by construction.
 *
 * Pure + dependency-free (composes reach.ts). The store-touching adjacency + the
 * co-change lookup live in core.ts; this module is the orderable, unit-testable core.
 */
import { sameDirSiblings, testImplCounterparts } from "./reach.js";

/**
 * Top-`limit` related files for `focal`, de-duplicated, never including `focal`.
 *
 * @param focal         the file the sub-agent's work centers on
 * @param graphAdjacent files sharing a graph edge with focal, in the caller's
 *                      preferred (e.g. degree-ranked) order — Tier 1
 * @param coChange      files that historically changed together with focal,
 *                      count-ranked (already path-keyed, may include non-code
 *                      files like config/schema) — Tier 2
 * @param allFiles      every source file in the graph (for path-based reach) — Tier 3
 * @param limit         max files to return (>0; <=0 yields [])
 */
export function relatedFiles(
  focal: string,
  graphAdjacent: readonly string[],
  coChange: readonly string[],
  allFiles: readonly string[],
  limit: number
): string[] {
  if (limit <= 0) return [];
  const out: string[] = [];
  const seen = new Set<string>([focal]);
  const take = (f: string): boolean => {
    if (seen.has(f)) return false;
    seen.add(f);
    out.push(f);
    return out.length >= limit;
  };
  // Tier 1 — graph-adjacent (real edges; preserve the caller's ranking).
  for (const f of graphAdjacent) {
    if (take(f)) return out;
  }
  // Tier 2 — git co-change (count-ranked; reaches cross-dir code↔config pairs).
  for (const f of coChange) {
    if (take(f)) return out;
  }
  // Tier 3 — path-reach: test↔impl counterparts above same-dir siblings.
  for (const f of testImplCounterparts(focal, allFiles)) {
    if (take(f)) return out;
  }
  for (const f of sameDirSiblings(focal, allFiles)) {
    if (take(f)) return out;
  }
  return out;
}
