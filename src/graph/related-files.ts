/**
 * related-files.ts — tiered "you'll likely also need these files" for a focal
 * file, for the sub-agent context broker (#83/#139).
 *
 * TIERING (bench-validated, #139): graph-adjacent files FIRST (real call/import
 * edges — highest signal), then path-reach APPENDED (test↔impl above same-dir
 * siblings). Path candidates never displace a graph hit, so a focal file with
 * rich graph adjacency is unaffected and path-reach only fills the slots the
 * graph left empty — never-worse by construction. On engram's own repo this
 * lifted recall@10 +6.1pp and nearly doubled the ranker's lift over random.
 *
 * Pure + dependency-free (composes reach.ts). The store-touching adjacency query
 * lives in core.ts; this module is the orderable, unit-testable core.
 */
import { sameDirSiblings, testImplCounterparts } from "./reach.js";

/**
 * Top-`limit` related files for `focal`, de-duplicated, never including `focal`.
 *
 * @param focal         the file the sub-agent's work centers on
 * @param graphAdjacent files sharing a graph edge with focal, in the caller's
 *                      preferred (e.g. degree-ranked) order — Tier 1
 * @param allFiles      every source file in the graph (for path-based reach)
 * @param limit         max files to return (>0; <=0 yields [])
 */
export function relatedFiles(
  focal: string,
  graphAdjacent: readonly string[],
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
  // Tier 2 — path-reach: test↔impl counterparts (strong co-change signal) above
  // same-dir siblings (moderate). Appended only after every graph hit.
  for (const f of testImplCounterparts(focal, allFiles)) {
    if (take(f)) return out;
  }
  for (const f of sameDirSiblings(focal, allFiles)) {
    if (take(f)) return out;
  }
  return out;
}
