/**
 * Graph query engine — BFS/DFS traversal, shortest path, subgraph extraction.
 * Operates on GraphStore and returns token-budgeted text context.
 */
import type { GraphStore } from "./store.js";
import type { GraphEdge, GraphNode } from "./schema.js";
import { sliceGraphemeSafe, truncateGraphemeSafe } from "./render-utils.js";

// v0.2: mistake priority boost. When a query matches a mistake node, it
// gets a higher score so the landmines surface before normal results.
// ("Landmines" is the user-facing name for past mistakes — internal API
// stays on "mistake" / "list_mistakes" for backward compatibility.)
// 2.5x is tuned by intuition — large enough to beat pure text-match score
// parity, small enough that a stronger text match on a non-mistake still
// wins. Verified in tests/mistake-memory.test.ts.
const MISTAKE_SCORE_BOOST = 2.5;

// v0.2.1: keyword concept downweight. The skills-miner creates hundreds
// of `concept` nodes with `metadata.subkind === "keyword"` that serve as
// routing intermediaries between a text-matched trigger phrase and its
// parent skill. They should be seed-eligible when nothing else matches
// (so skill discovery via keyword bridges still works), but must NOT
// dominate code-query seeding. Without this downweight, a query like
// "how does auth work" seeds BFS from ~30 keyword nodes and pulls in
// the whole skill subgraph, diluting code navigation 5x. Verified in
// tests/stress.test.ts (keyword regression test).
const KEYWORD_SCORE_DOWNWEIGHT = 0.5;

// Exported for use by the MCP server (serve.ts) so truncation is
// consistent across the landmines block and the list_mistakes tool.
export const MAX_MISTAKE_LABEL_CHARS = 500;

// v0.2.1: a node is a "hidden keyword" if it's a concept with subkind
// "keyword". Keywords are invisible at the render layer — they're
// traversal intermediaries only, never user-visible output.
function isHiddenKeyword(node: GraphNode): boolean {
  if (node.kind !== "concept") return false;
  const meta = node.metadata as Record<string, unknown> | undefined;
  return meta?.subkind === "keyword";
}

const CHARS_PER_TOKEN = 4;

interface TraversalResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  text: string;
  estimatedTokens: number;
}

function scoreNodes(
  store: GraphStore,
  terms: string[]
): Array<{ score: number; node: GraphNode }> {
  // Use SQL-level filtering via searchNodes instead of materializing
  // the entire graph into JS. Each term seeds from the index; we then
  // deduplicate and score the reduced set in JS.
  const seen = new Set<string>();
  const seedNodes: GraphNode[] = [];
  for (const t of terms) {
    for (const node of store.searchNodes(t, 200)) {
      if (!seen.has(node.id)) {
        seen.add(node.id);
        seedNodes.push(node);
      }
    }
  }

  // Also pull in immediate neighbors of seeds so BFS/scoring has a
  // meaningful local neighborhood (without loading ALL nodes).
  const neighborNodes: GraphNode[] = [];
  for (const node of seedNodes) {
    for (const { node: neighbor } of store.getNeighbors(node.id)) {
      if (!seen.has(neighbor.id)) {
        seen.add(neighbor.id);
        neighborNodes.push(neighbor);
      }
    }
  }

  const allCandidates = [...seedNodes, ...neighborNodes];
  const scored: Array<{ score: number; node: GraphNode }> = [];

  for (const node of allCandidates) {
    const label = node.label.toLowerCase();
    const file = node.sourceFile.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (label.includes(t)) score += 2;
      if (file.includes(t)) score += 1;
    }
    if (score > 0) {
      // Priority boost for mistake nodes so landmines surface relevant
      // past failures before normal code results.
      if (node.kind === "mistake") score *= MISTAKE_SCORE_BOOST;
      // Priority downweight for keyword concept nodes. Keeps them seed-
      // eligible when no code/skill matches exist (so skill discovery
      // via keyword bridges still works), but lets code nodes dominate
      // seeding whenever they exist.
      if (isHiddenKeyword(node)) score *= KEYWORD_SCORE_DOWNWEIGHT;
      scored.push({ score, node });
    }
  }

  return scored.sort((a, b) => b.score - a.score);
}

export function queryGraph(
  store: GraphStore,
  question: string,
  options: { mode?: "bfs" | "dfs"; depth?: number; tokenBudget?: number } = {}
): TraversalResult {
  const { mode = "bfs", depth = 3, tokenBudget = 2000 } = options;
  const terms = question
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);

  const scored = scoreNodes(store, terms);
  const startNodes = scored.slice(0, 3).map((s) => s.node);

  if (startNodes.length === 0) {
    return { nodes: [], edges: [], text: "No matching nodes found.", estimatedTokens: 5 };
  }

  // Increment query counts for matched nodes
  for (const n of startNodes) store.incrementQueryCount(n.id);

  const visited = new Set<string>(startNodes.map((n) => n.id));
  const collectedEdges: GraphEdge[] = [];

  // v0.2.1: traversal edge filter. `triggered_by` edges only connect
  // keyword concept nodes to skill concept nodes. getNeighbors returns
  // both directions, so when BFS is at a skill node and calls it, the
  // 30+ inbound triggered_by edges get pulled into the frontier as
  // keyword neighbors — the root cause of the v0.2.0 with-skills
  // bloat. Suppress this by only walking `triggered_by` when the
  // current frontier node is itself a keyword. Keywords remain
  // reachable via direct text-match seeding; they just stop acting
  // as "inbound attractors" for non-keyword traversal.
  const shouldSkipEdgeFrom = (currentNodeId: string, edge: GraphEdge): boolean => {
    if (edge.relation !== "triggered_by") return false;
    const currentNode = store.getNode(currentNodeId);
    if (!currentNode) return false;
    return !isHiddenKeyword(currentNode);
  };

  if (mode === "bfs") {
    let frontier = new Set(startNodes.map((n) => n.id));
    for (let d = 0; d < depth; d++) {
      const nextFrontier = new Set<string>();
      for (const nid of frontier) {
        const neighbors = store.getNeighbors(nid);
        for (const { node, edge } of neighbors) {
          if (shouldSkipEdgeFrom(nid, edge)) continue;
          if (!visited.has(node.id)) {
            nextFrontier.add(node.id);
            collectedEdges.push(edge);
          }
        }
      }
      for (const id of nextFrontier) visited.add(id);
      frontier = nextFrontier;
    }
  } else {
    const stack: Array<{ id: string; d: number }> = startNodes
      .map((n) => ({ id: n.id, d: 0 }))
      .reverse();
    while (stack.length > 0) {
      const { id, d } = stack.pop()!;
      if (d > depth) continue;
      const neighbors = store.getNeighbors(id);
      for (const { node, edge } of neighbors) {
        if (shouldSkipEdgeFrom(id, edge)) continue;
        if (!visited.has(node.id)) {
          visited.add(node.id);
          stack.push({ id: node.id, d: d + 1 });
          collectedEdges.push(edge);
        }
      }
    }
  }

  // Collect all visited nodes
  const resultNodes: GraphNode[] = [];
  for (const id of visited) {
    const node = store.getNode(id);
    if (node) resultNodes.push(node);
  }

  // Render as text with token budget
  const text = renderSubgraph(resultNodes, collectedEdges, tokenBudget);
  const estimatedTokens = Math.ceil(text.length / CHARS_PER_TOKEN);

  return { nodes: resultNodes, edges: collectedEdges, text, estimatedTokens };
}

export function shortestPath(
  store: GraphStore,
  sourceTerm: string,
  targetTerm: string,
  maxHops = 8
): TraversalResult {
  const sourceTerms = sourceTerm.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const targetTerms = targetTerm.toLowerCase().split(/\s+/).filter((t) => t.length > 2);

  const sourceScored = scoreNodes(store, sourceTerms);
  const targetScored = scoreNodes(store, targetTerms);

  if (sourceScored.length === 0 || targetScored.length === 0) {
    return {
      nodes: [],
      edges: [],
      text: `No nodes matching "${sourceTerm}" or "${targetTerm}".`,
      estimatedTokens: 10,
    };
  }

  const srcId = sourceScored[0].node.id;
  const tgtId = targetScored[0].node.id;

  // BFS shortest path
  const queue: string[][] = [[srcId]];
  const seen = new Set<string>([srcId]);

  while (queue.length > 0) {
    const path = queue.shift()!;
    const current = path[path.length - 1];

    if (current === tgtId) {
      // Build result from path
      const pathNodes: GraphNode[] = [];
      const pathEdges: GraphEdge[] = [];
      for (let i = 0; i < path.length; i++) {
        const node = store.getNode(path[i]);
        if (node) pathNodes.push(node);
        if (i < path.length - 1) {
          const neighbors = store.getNeighbors(path[i]);
          const edge = neighbors.find((n) => n.node.id === path[i + 1])?.edge;
          if (edge) pathEdges.push(edge);
        }
      }
      const text = renderPath(pathNodes, pathEdges);
      return {
        nodes: pathNodes,
        edges: pathEdges,
        text,
        estimatedTokens: Math.ceil(text.length / CHARS_PER_TOKEN),
      };
    }

    if (path.length > maxHops) continue;

    const neighbors = store.getNeighbors(current);
    for (const { node } of neighbors) {
      if (!seen.has(node.id)) {
        seen.add(node.id);
        queue.push([...path, node.id]);
      }
    }
  }

  return {
    nodes: [],
    edges: [],
    text: `No path found between "${sourceTerm}" and "${targetTerm}" within ${maxHops} hops.`,
    estimatedTokens: 15,
  };
}

function renderSubgraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  tokenBudget: number
): string {
  const charBudget = tokenBudget * CHARS_PER_TOKEN;
  const lines: string[] = [];

  // v0.2/v0.3: landmines block. If any mistakes are in the result set, emit them
  // at the top of the output as a warning block and exclude them from the
  // main NODE list (they're still in the scored results, just rendered
  // separately with a distinctive marker).
  const mistakes = nodes.filter((n) => n.kind === "mistake");

  // v0.2.1: Filter keyword concept nodes out of visible output. They're
  // traversal intermediaries (text-matched entry points that route BFS
  // to skill concepts via `triggered_by` edges), not user-facing content.
  // Emitting them pollutes the result set 5x on projects with indexed
  // skills. Skill concepts themselves and all other kinds remain visible.
  const visible = nodes.filter(
    (n) => n.kind !== "mistake" && !isHiddenKeyword(n)
  );
  const hiddenKeywordIds = new Set(
    nodes.filter(isHiddenKeyword).map((n) => n.id)
  );

  if (mistakes.length > 0) {
    lines.push("⚠️ PAST MISTAKES (relevant to your query):");
    for (const m of mistakes) {
      const label = truncateGraphemeSafe(m.label, MAX_MISTAKE_LABEL_CHARS);
      const confNote =
        m.confidence === "EXTRACTED"
          ? ""
          : ` [confidence ${m.confidenceScore}]`;
      lines.push(`  - ${label} (from ${m.sourceFile})${confNote}`);
    }
    lines.push("");
  }

  // Sort visible nodes by degree (most connected first)
  const degreeMap = new Map<string, number>();
  for (const e of edges) {
    degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
    degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
  }
  const sorted = [...visible].sort(
    (a, b) => (degreeMap.get(b.id) ?? 0) - (degreeMap.get(a.id) ?? 0)
  );

  for (const n of sorted) {
    lines.push(
      `NODE ${n.label} [${n.kind}] src=${n.sourceFile} ${n.sourceLocation ?? ""}`
    );
  }

  // Build a set of skill concept IDs for the skill↔skill similar_to
  // edge filter below. Skills live as `concept` nodes with metadata
  // subkind === "skill".
  const skillConceptIds = new Set(
    nodes
      .filter(
        (n) =>
          n.kind === "concept" &&
          (n.metadata as Record<string, unknown> | undefined)?.subkind ===
            "skill"
      )
      .map((n) => n.id)
  );

  // Edge rendering: look up endpoint nodes in the full `nodes` array.
  // Mistakes have zero outgoing edges by construction (session-miner.ts
  // returns `edges: []`), so no EDGE line would ever reference a mistake.
  // v0.2.1: skip (a) any edge whose source OR target is a hidden keyword
  // concept — rendering `EDGE code_fn --triggered_by--> keyword_foo`
  // would expose the keyword label even though the node itself is
  // filtered from the NODE list; and (b) `similar_to` edges where BOTH
  // endpoints are skill concepts — these are skill cross-references that
  // add noise to code-focused queries without providing actionable
  // structural information. A user asking about skill networks can still
  // see the skill nodes themselves in the NODE list.
  for (const e of edges) {
    if (hiddenKeywordIds.has(e.source) || hiddenKeywordIds.has(e.target)) {
      continue;
    }
    if (
      e.relation === "similar_to" &&
      skillConceptIds.has(e.source) &&
      skillConceptIds.has(e.target)
    ) {
      continue;
    }
    const srcNode = nodes.find((n) => n.id === e.source);
    const tgtNode = nodes.find((n) => n.id === e.target);
    if (srcNode && tgtNode) {
      const conf =
        e.confidence === "EXTRACTED"
          ? ""
          : ` [${e.confidence} ${e.confidenceScore}]`;
      lines.push(
        `EDGE ${srcNode.label} --${e.relation}--> ${tgtNode.label}${conf}`
      );
    }
  }

  let output = lines.join("\n");
  if (output.length > charBudget) {
    // Surrogate-safe slice — avoids leaving a lone high surrogate at the
    // cut boundary, which would corrupt JSON serialization downstream.
    output =
      sliceGraphemeSafe(output, charBudget) +
      `\n... (truncated to ~${tokenBudget} token budget)`;
  }
  return output;
}

function renderPath(nodes: GraphNode[], edges: GraphEdge[]): string {
  if (nodes.length === 0) return "Empty path.";
  const segments: string[] = [nodes[0].label];
  for (let i = 0; i < edges.length; i++) {
    const conf =
      edges[i].confidence === "EXTRACTED"
        ? ""
        : ` [${edges[i].confidence}]`;
    segments.push(`--${edges[i].relation}${conf}--> ${nodes[i + 1]?.label ?? "?"}`);
  }
  return `Path (${edges.length} hops): ${segments.join(" ")}`;
}

export interface FileStructureResult {
  readonly text: string;
  /** Total nodes rendered in the summary (includes the file metadata node). */
  readonly nodeCount: number;
  /**
   * Count of code declaration nodes — excludes the `file` and `module`
   * metadata kinds. This is what callers should use to judge whether the
   * graph has meaningful coverage of the file's contents. A file with
   * `nodeCount: 5` but `codeNodeCount: 1` is actually sparse — it only
   * has the file metadata and a single declaration.
   */
  readonly codeNodeCount: number;
  readonly avgConfidence: number;
  readonly estimatedTokens: number;
}

/**
 * Render the structural view of a single file as a compact summary
 * suitable for dropping into a PreToolUse deny reason. Used by the Read
 * handler to replace a full file read with a ~300-token graph summary.
 *
 * Strategy:
 *   1. Filter all graph nodes where sourceFile === relativeFilePath
 *   2. Group by NodeKind so the summary is scannable by kind (functions,
 *      classes, types, ...)
 *   3. Append key relationships: edges where at least one endpoint is in
 *      this file. Sorted by degree so the most-connected nodes surface first.
 *   4. Include a header describing the file and a footer telling Claude how
 *      to escape (Read with explicit offset/limit still works).
 *   5. Truncate to `tokenBudget` using the same surrogate-safe slice as
 *      renderSubgraph so we never corrupt JSON serialization.
 *
 * Returns a FileStructureResult with the rendered text, node count, and
 * average extraction confidence for the nodes in this file. Callers use
 * the nodeCount + avgConfidence to decide whether to actually use the
 * summary (see `core.ts::getFileContext` and the confidence threshold in
 * `intercept/handlers/read.ts`).
 *
 * If the file has zero nodes in the graph, returns an empty-shell result
 * with `nodeCount: 0`. Callers MUST check this before using `text`.
 */
export function renderFileStructure(
  store: GraphStore,
  relativeFilePath: string,
  tokenBudget = 600
): FileStructureResult {
  // Use targeted SQL queries instead of full table scans. On 50k-node
  // projects, getAllNodes()/getAllEdges() materialize the entire graph
  // into JS arrays and time out silently.
  const allFileNodes = store.getNodesByFile(relativeFilePath);
  const fileNodes = allFileNodes.filter((n) => !isHiddenKeyword(n));

  if (fileNodes.length === 0) {
    return {
      text: "",
      nodeCount: 0,
      codeNodeCount: 0,
      avgConfidence: 0,
      estimatedTokens: 0,
    };
  }

  // Code node count excludes file/module metadata kinds. These represent
  // the file itself (one per file) and are not useful signal for coverage.
  const codeNodeCount = fileNodes.filter(
    (n) => n.kind !== "file" && n.kind !== "module"
  ).length;

  // Average extraction confidence — used by the caller to decide whether
  // to trust this summary as a full-file replacement.
  const avgConfidence =
    fileNodes.reduce((s, n) => s + n.confidenceScore, 0) / fileNodes.length;

  // Fetch only edges that touch this file's nodes (indexed query).
  const fileNodeIds = new Set(fileNodes.map((n) => n.id));
  const fileEdges = store.getEdgesForNodes([...fileNodeIds]);

  // Degree map: how many edges touch each node in this file. Used to sort
  // nodes within each kind group so the most-connected (= most important)
  // surface first.
  const degreeMap = new Map<string, number>();
  for (const e of fileEdges) {
    if (fileNodeIds.has(e.source)) {
      degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
    }
    if (fileNodeIds.has(e.target)) {
      degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
    }
  }

  // Group nodes by kind so the summary is scannable.
  const byKind = new Map<GraphNode["kind"], GraphNode[]>();
  for (const n of fileNodes) {
    const list = byKind.get(n.kind) ?? [];
    list.push(n);
    byKind.set(n.kind, list);
  }
  // Sort each group by degree (desc) so the most connected nodes come first.
  for (const list of byKind.values()) {
    list.sort(
      (a, b) => (degreeMap.get(b.id) ?? 0) - (degreeMap.get(a.id) ?? 0)
    );
  }

  // Kind render order — entities users care about most, then metadata kinds.
  // Matches the NodeKind union in schema.ts exactly; do not add kinds that
  // don't exist in the schema or TS will flag them.
  const kindOrder: GraphNode["kind"][] = [
    "class",
    "interface",
    "type",
    "function",
    "method",
    "variable",
    "import",
    "module",
    "file",
    "decision",
    "pattern",
    "mistake",
    "concept",
  ];

  const lines: string[] = [];
  lines.push(`[engram] Structural summary for ${relativeFilePath}`);
  lines.push(
    `Nodes: ${fileNodes.length} | avg extraction confidence: ${avgConfidence.toFixed(2)}`
  );
  lines.push("");

  for (const kind of kindOrder) {
    const group = byKind.get(kind);
    if (!group || group.length === 0) continue;
    for (const n of group) {
      const loc = n.sourceLocation ?? "";
      lines.push(`NODE ${n.label} [${n.kind}] ${loc}`.trim());
    }
  }

  // Relationships involving this file's nodes (outgoing + incoming).
  // Sort by combined degree of endpoints so god-node relationships
  // surface first, then cap at 10 to stay under budget.
  const relevantEdges = fileEdges
    .filter(
      (e) => fileNodeIds.has(e.source) || fileNodeIds.has(e.target)
    )
    .sort((a, b) => {
      const degA = (degreeMap.get(a.source) ?? 0) + (degreeMap.get(a.target) ?? 0);
      const degB = (degreeMap.get(b.source) ?? 0) + (degreeMap.get(b.target) ?? 0);
      return degB - degA;
    })
    .slice(0, 10);

  // Build a lookup map for node labels (covers file nodes + edge endpoints).
  const nodeById = new Map<string, GraphNode>();
  for (const n of fileNodes) nodeById.set(n.id, n);
  // For edges that cross file boundaries, fetch the external endpoint.
  for (const e of relevantEdges) {
    if (!nodeById.has(e.source)) {
      const n = store.getNode(e.source);
      if (n) nodeById.set(n.id, n);
    }
    if (!nodeById.has(e.target)) {
      const n = store.getNode(e.target);
      if (n) nodeById.set(n.id, n);
    }
  }

  if (relevantEdges.length > 0) {
    lines.push("");
    lines.push("Key relationships:");
    for (const e of relevantEdges) {
      const src = nodeById.get(e.source);
      const tgt = nodeById.get(e.target);
      if (src && tgt) {
        lines.push(`EDGE ${src.label} --${e.relation}--> ${tgt.label}`);
      }
    }
  }

  lines.push("");
  lines.push(
    "Note: engram replaced a full-file read with this structural view to save tokens. " +
      "If you need specific lines, Read this file again with explicit offset/limit " +
      "parameters — engram passes partial reads through unchanged."
  );

  let text = lines.join("\n");
  const charBudget = tokenBudget * CHARS_PER_TOKEN;
  if (text.length > charBudget) {
    text =
      sliceGraphemeSafe(text, charBudget) +
      "\n... (truncated to fit summary budget)";
  }

  return {
    text,
    nodeCount: fileNodes.length,
    codeNodeCount,
    avgConfidence,
    estimatedTokens: Math.ceil(text.length / CHARS_PER_TOKEN),
  };
}
