/**
 * Personalized weighted PageRank (Fix #3.2) — ranks graph nodes by recursive
 * importance over the reference graph (Fix #3.1's `calls` edges + contains/
 * imports/etc), replacing the old raw edge-degree count.
 *
 * Why it beats degree: degree counts how many edges touch a node; PageRank
 * rewards being referenced by *important* nodes (recursively). A function
 * called by a hub outranks one called by a leaf even at equal degree. This
 * makes engram the only ranked tool in the local-code-graph category
 * (codegraph + Understand-Anything both ship FTS5/fuzzy, no ranking).
 *
 * `personalization` biases the random-walk teleport toward query-relevant
 * nodes (active files, mentioned symbols) — wired in Fix #3.3. With no
 * personalization it's standard global PageRank over the subgraph.
 *
 * Pure + deterministic (no Date/Math.random). Power iteration, O(iters · edges).
 */

export interface PageRankEdge {
  readonly source: string;
  readonly target: string;
  /** Optional edge weight; falls back to confidenceScore, then 1. */
  readonly weight?: number;
  readonly confidenceScore?: number;
}

export interface PageRankOptions {
  /** Teleport probability complement. Standard 0.85. */
  readonly damping?: number;
  /** Power-iteration count. 20 is ample for convergence on code graphs. */
  readonly iterations?: number;
  /** Teleport bias: nodeId → relative weight. Normalized internally. */
  readonly personalization?: ReadonlyMap<string, number>;
}

/**
 * Compute PageRank scores for `nodeIds` over `edges`. Only edges whose BOTH
 * endpoints are in `nodeIds` participate. Returns nodeId → score (scores sum
 * to ~1). Empty input → empty map.
 */
export function pageRank(
  nodeIds: readonly string[],
  edges: readonly PageRankEdge[],
  opts: PageRankOptions = {}
): Map<string, number> {
  const damping = opts.damping ?? 0.85;
  const iterations = opts.iterations ?? 20;
  const n = nodeIds.length;
  const scores = new Map<string, number>();
  if (n === 0) return scores;

  const present = new Set(nodeIds);

  // Teleport (personalization) vector, normalized over present nodes.
  const teleport = new Map<string, number>();
  let pSum = 0;
  if (opts.personalization && opts.personalization.size > 0) {
    for (const id of nodeIds) {
      const w = opts.personalization.get(id) ?? 0;
      if (w > 0) pSum += w;
    }
  }
  for (const id of nodeIds) {
    teleport.set(
      id,
      pSum > 0 ? (opts.personalization!.get(id) ?? 0) / pSum : 1 / n
    );
  }

  // Weighted out-adjacency + out-weight totals (intra-subgraph edges only).
  const outAdj = new Map<string, { target: string; weight: number }[]>();
  const outWeight = new Map<string, number>();
  for (const e of edges) {
    if (!present.has(e.source) || !present.has(e.target)) continue;
    if (e.source === e.target) continue; // ignore self-loops
    const w = e.weight ?? e.confidenceScore ?? 1;
    if (w <= 0) continue;
    const arr = outAdj.get(e.source);
    if (arr) arr.push({ target: e.target, weight: w });
    else outAdj.set(e.source, [{ target: e.target, weight: w }]);
    outWeight.set(e.source, (outWeight.get(e.source) ?? 0) + w);
  }

  // Init ranks = teleport.
  let rank = new Map(teleport);

  for (let iter = 0; iter < iterations; iter++) {
    const next = new Map<string, number>();
    for (const id of nodeIds) next.set(id, (1 - damping) * teleport.get(id)!);

    // Dangling mass: rank held by nodes with no out-edges is redistributed
    // via the teleport vector (standard PageRank dangling handling).
    let dangling = 0;
    for (const id of nodeIds) {
      if (!outAdj.has(id)) dangling += rank.get(id) ?? 0;
    }
    if (dangling > 0) {
      for (const id of nodeIds) {
        next.set(id, next.get(id)! + damping * dangling * teleport.get(id)!);
      }
    }

    // Flow along edges, proportional to edge weight.
    for (const [src, adj] of outAdj) {
      const srcRank = rank.get(src) ?? 0;
      if (srcRank === 0) continue;
      const total = outWeight.get(src)!;
      for (const { target, weight } of adj) {
        next.set(
          target,
          next.get(target)! + damping * srcRank * (weight / total)
        );
      }
    }

    rank = next;
  }

  return rank;
}
