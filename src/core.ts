/**
 * Core engram operations — init, mine, query, stats.
 * This is the main API surface that CLI and MCP server both use.
 */
import { join, resolve, relative } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { GraphStore } from "./graph/store.js";
import { queryGraph, shortestPath, renderFileStructure } from "./graph/query.js";
import { toPosixPath } from "./graph/path-utils.js";
import { extractDirectory } from "./miners/ast-miner.js";
import { mineGitHistory } from "./miners/git-miner.js";
import { mineGitReverts } from "./miners/git-revert-miner.js";
import { mineBugFixCommits } from "./miners/git-bugfix-miner.js";
import { buildReferenceEdgesCached, type RefCache } from "./miners/reference-miner.js";
import { findCallers, findCallees, findImpact } from "./graph/traversal.js";
import { relatedFiles } from "./graph/related-files.js";
import { mineSessionHistory, learnFromSession } from "./miners/session-miner.js";
import { mineSkills } from "./miners/skills-miner.js";
import type { GraphStats } from "./graph/schema.js";

const ENGRAM_DIR = ".engram";
const DB_FILE = "graph.db";
const LOCK_FILE = "init.lock";
/**
 * Default skills dir for `withSkills: true`, resolved at CALL time (not module
 * load) so it honours an `ENGRAM_SKILLS_DIR` override. Production default is
 * unchanged (`~/.claude/skills`); the override keeps tests hermetic instead of
 * mining the developer's live skills dir (non-deterministic + can throw mid-scan).
 */
function defaultSkillsDir(): string {
  return process.env.ENGRAM_SKILLS_DIR || join(homedir(), ".claude", "skills");
}

export function getDbPath(projectRoot: string): string {
  return join(projectRoot, ENGRAM_DIR, DB_FILE);
}

export async function getStore(projectRoot: string): Promise<GraphStore> {
  return GraphStore.open(getDbPath(projectRoot));
}

export interface InitResult {
  nodes: number;
  edges: number;
  fileCount: number;
  totalLines: number;
  timeMs: number;
  skillCount?: number;
  skippedFiles?: number;
  incremental?: boolean;
  /** Count of mistake-kind nodes mined (reverts + bug-fixes + sessions). */
  mistakeCount?: number;
}

export interface InitOptions {
  /**
   * Index Claude Code skills from the given directory.
   *   - `true` → use `~/.claude/skills/`
   *   - `string` → use the given path
   *   - `false` | `undefined` → skip (default)
   */
  withSkills?: boolean | string;
  /**
   * Incremental mode — skip files whose mtime hasn't changed since last init.
   * Dramatically faster for large repos on re-index.
   */
  incremental?: boolean;
  /** Callback for progress reporting during extraction. */
  onProgress?: (processed: number, skipped: number, currentFile: string) => void;
}

export async function init(
  projectRoot: string,
  options: InitOptions = {}
): Promise<InitResult> {
  const root = resolve(projectRoot);
  const start = Date.now();

  mkdirSync(join(root, ENGRAM_DIR), { recursive: true });

  // Atomic lockfile — prevents two concurrent init calls from silently
  // corrupting the graph. `wx` flag = exclusive create, fails if file exists.
  const lockPath = join(root, ENGRAM_DIR, LOCK_FILE);
  try {
    writeFileSync(lockPath, String(process.pid), { flag: "wx" });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `engram: another init is running on ${root} (lock: ${lockPath}). ` +
          `If no other process is active, delete the lock file manually.`
      );
    }
    throw err;
  }

  try {
    // Load previous mtimes for incremental mode
    let previousMtimes: Map<string, number> | undefined;
    if (options.incremental) {
      const store = await getStore(root);
      try {
        const mtimeJson = store.getStat("file_mtimes");
        if (mtimeJson) {
          previousMtimes = new Map(JSON.parse(mtimeJson));
        }
      } finally {
        store.close();
      }
    }

    const { nodes, edges, fileCount, totalLines, mtimes, skippedCount } =
      extractDirectory(root, undefined, {
        previousMtimes,
        onProgress: options.onProgress,
      });
    const gitResult = mineGitHistory(root);
    const gitRevertResult = mineGitReverts(root);
    const bugFixResult = mineBugFixCommits(root);
    const sessionResult = mineSessionHistory(root);

    let skillCount = 0;
    let skillNodes: typeof nodes = [];
    let skillEdges: typeof edges = [];
    if (options.withSkills) {
      const skillsDir =
        typeof options.withSkills === "string"
          ? options.withSkills
          : defaultSkillsDir();
      const skillsResult = mineSkills(skillsDir);
      skillCount = skillsResult.skillCount;
      skillNodes = skillsResult.nodes;
      skillEdges = skillsResult.edges;
    }

    const allNodes = [
      ...nodes,
      ...gitResult.nodes,
      ...gitRevertResult.nodes,
      ...bugFixResult.nodes,
      ...sessionResult.nodes,
      ...skillNodes,
    ];
    const allEdges = [
      ...edges,
      ...gitResult.edges,
      ...gitRevertResult.edges,
      ...sessionResult.edges,
      ...skillEdges,
    ];
    // Fix #3 — cross-file reference (`calls`) edges are (re)built AFTER the node
    // upsert below, over the FULL current graph, so it's correct for BOTH full
    // and incremental init. The authoritative final edge count is captured from
    // the store after the rebuild (the array length alone would mix changed-file
    // edges with the full calls set on incremental runs).
    let totalEdgeCount = allEdges.length;

    const store = await getStore(root);
    try {
      // In incremental mode, only clear nodes from changed files
      // In full mode, clear everything and rebuild
      if (options.incremental && previousMtimes) {
        // Remove stale nodes/edges from files that were re-extracted
        const clearedFiles = new Set<string>();
        for (const node of allNodes) {
          if (node.sourceFile && !clearedFiles.has(node.sourceFile)) {
            store.removeNodesForFile(node.sourceFile);
            clearedFiles.add(node.sourceFile);
          }
        }
      } else {
        store.clearAll();
      }
      store.bulkUpsert(allNodes, allEdges);
      store.setStat("last_mined", String(Date.now()));
      store.setStat("project_root", root);
      // Persist mtimes for next incremental run
      store.setStat("file_mtimes", JSON.stringify([...mtimes.entries()]));

      // Fix #3 — (re)build the cross-file reference graph over the FULL current
      // graph. Runs for BOTH full and incremental init: the node upsert above is
      // complete, so store.getAllNodes() is the authoritative current set. This
      // keeps `calls` edges (and PageRank ranking) correct as files change,
      // instead of drifting on incremental re-index. Clears stale calls edges
      // first so re-runs never duplicate. Non-fatal — ranking falls back to
      // degree on failure. Perf: re-parses files each init; a mtime-keyed refs
      // cache is the tracked optimization for very large repos.
      try {
        let prevRefCache: RefCache = {};
        try {
          prevRefCache = JSON.parse(store.getStat("file_refs_cache") ?? "{}") as RefCache;
        } catch {
          /* corrupt/absent cache → cold rebuild (still correct) */
        }
        const { edges: refEdges, cache: refCache } = await buildReferenceEdgesCached(
          root,
          store.getAllNodes(),
          prevRefCache
        );
        // Atomic: rolls back on failure so a partial rebuild can't persist a
        // calls-less graph via the finally-driven close()/save().
        store.replaceEdgesByRelation("calls", refEdges);
        // Persist the refs cache so the first post-init reindex is already warm.
        store.setStat("file_refs_cache", JSON.stringify(refCache));
      } catch (err) {
        // Non-fatal: the atomic replace rolled back, so the prior reference
        // graph is intact; ranking is unaffected. Surface it (the repo's
        // "no silent fail-open" rule) so a parser/grammar regression isn't
        // invisible rather than a silently-degraded ranking.
        if (process.env.ENGRAM_DEBUG) {
          console.error("engram: reference-graph rebuild skipped:", err);
        }
      }
      // Authoritative edge count from disk — correct on full + incremental,
      // and after a rebuild success OR a rolled-back failure.
      totalEdgeCount = store.getStats().edges;
    } finally {
      store.close();
    }

    return {
      nodes: allNodes.length,
      edges: totalEdgeCount,
      fileCount,
      totalLines,
      timeMs: Date.now() - start,
      skillCount,
      skippedFiles: skippedCount,
      incremental: options.incremental ?? false,
      mistakeCount: allNodes.filter((n) => n.kind === "mistake").length,
    };
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {
      /* lock file may already be gone — not an error */
    }
  }
}

export async function query(
  projectRoot: string,
  question: string,
  options: { mode?: "bfs" | "dfs"; depth?: number; tokenBudget?: number } = {}
): Promise<{ text: string; estimatedTokens: number; nodesFound: number }> {
  const store = await getStore(projectRoot);
  try {
    const result = queryGraph(store, question, options);
    return { text: result.text, estimatedTokens: result.estimatedTokens, nodesFound: result.nodes.length };
  } finally {
    store.close();
  }
}

export async function path(
  projectRoot: string,
  source: string,
  target: string
): Promise<{ text: string; hops: number }> {
  const store = await getStore(projectRoot);
  try {
    const result = shortestPath(store, source, target);
    return { text: result.text, hops: result.edges.length };
  } finally {
    store.close();
  }
}

export async function godNodes(
  projectRoot: string,
  topN = 10
): Promise<Array<{ label: string; kind: string; degree: number; sourceFile: string }>> {
  const store = await getStore(projectRoot);
  try {
    return store.getGodNodes(topN).map((g) => ({
      label: g.node.label, kind: g.node.kind, degree: g.degree, sourceFile: g.node.sourceFile,
    }));
  } finally {
    store.close();
  }
}

export async function stats(projectRoot: string): Promise<GraphStats> {
  const store = await getStore(projectRoot);
  try {
    return store.getStats();
  } finally {
    store.close();
  }
}

/**
 * Tiered related-files for a focal file (#139), for the sub-agent broker. Graph
 * adjacency (files sharing an edge with focal, degree-ranked) FIRST, path-reach
 * (test↔impl, then same-dir siblings) APPENDED — never-worse by construction.
 * `focal` is project-relative POSIX (as stored on nodes). Empty on any miss so
 * the broker never injects noise.
 */
export async function relatedFilesFor(
  projectRoot: string,
  focal: string,
  limit = 5
): Promise<string[]> {
  const store = await getStore(projectRoot);
  try {
    // Lightweight id→file map (2 cols, no node hydration) — bounded by node count.
    const idToFile = store.getNodeFileMap();
    const allFilesSet = new Set<string>();
    const focalIds = new Set<string>();
    for (const [id, file] of idToFile) {
      allFilesSet.add(file);
      if (file === focal) focalIds.add(id);
    }
    // Never-worse / no-noise: only suggest related files for a file engram
    // actually understands (has graph nodes for). A non-code focal (a .md/config
    // the parent happened to read last) has no nodes → we have no real signal and
    // must not guess from path siblings. Returning [] degrades to the god-node
    // slice unchanged.
    if (focalIds.size === 0) return [];
    // Graph-adjacent files, ranked by how many edges connect them to focal.
    const adjCount = new Map<string, number>();
    if (focalIds.size > 0) {
      for (const e of store.getEdgesForNodes([...focalIds])) {
        const other = focalIds.has(e.source) ? e.target : e.source;
        if (focalIds.has(other)) continue; // intra-file edge
        const f = idToFile.get(other);
        if (f && f !== focal) adjCount.set(f, (adjCount.get(f) ?? 0) + 1);
      }
    }
    const graphAdjacent = [...adjCount.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([f]) => f);
    return relatedFiles(focal, graphAdjacent, [...allFilesSet], limit);
  } finally {
    store.close();
  }
}

/** Fix #3.5 — traversal over the `calls` reference graph. */
export async function callers(projectRoot: string, name: string): Promise<string[]> {
  const store = await getStore(projectRoot);
  try {
    return findCallers(store.getAllNodes(), store.getAllEdges(), name);
  } finally {
    store.close();
  }
}

export async function callees(
  projectRoot: string,
  name: string
): Promise<Array<{ name: string; file: string }>> {
  const store = await getStore(projectRoot);
  try {
    return findCallees(store.getAllNodes(), store.getAllEdges(), name);
  } finally {
    store.close();
  }
}

export async function impact(projectRoot: string, name: string): Promise<string[]> {
  const store = await getStore(projectRoot);
  try {
    return findImpact(store.getAllNodes(), store.getAllEdges(), name);
  } finally {
    store.close();
  }
}

export interface FileContextResult {
  /** True if the graph has at least one node with this sourceFile. */
  readonly found: boolean;
  /**
   * Confidence that the summary is a faithful replacement for reading the
   * file. Combines coverage (do we have enough CODE declarations?) and
   * quality (are those nodes extracted with high confidence?). Scale 0..1.
   *
   * Formula: min(codeNodeCount / 3, 1) * avgExtractionConfidence
   *   - 3 code declarations is the "full coverage" ceiling. A file with
   *     3+ exported functions/classes/types has meaningful structure that
   *     the graph summary captures well.
   *   - `file` and `module` metadata nodes are EXCLUDED from the count so
   *     a file with only its own metadata node doesn't look covered.
   *   - avgExtractionConfidence weights by how sure the miner was
   *     (EXTRACTED = 1.0, INFERRED ≈ 0.7, AMBIGUOUS ≈ 0.4).
   */
  readonly confidence: number;
  /** The rendered structural summary (empty if found=false). */
  readonly summary: string;
  /** How many nodes matched the file (includes file metadata). */
  readonly nodeCount: number;
  /** Code declaration count (excludes file/module metadata nodes). */
  readonly codeNodeCount: number;
  /** Average extraction confidence across the file's nodes. */
  readonly avgNodeConfidence: number;
  /** Graph database mtime in ms since epoch (used for staleness checks). */
  readonly graphMtimeMs: number;
  /** File mtime in ms since epoch (null if the file does not exist). */
  readonly fileMtimeMs: number | null;
  /** True if the file is newer than the graph — summary is stale. */
  readonly isStale: boolean;
}

/**
 * Number of CODE nodes (excluding file/module metadata) at which coverage
 * is considered "full" for confidence purposes. Tuned empirically on
 * 2026-04-11: auth.ts fixture with 2 code nodes (class + function) should
 * be borderline, 3+ should confidently intercept.
 *
 * KNOWN LIMITATION: this formula undervalues files with a single large
 * class + many methods. The AST miner currently emits one node per class
 * (not one per method), so a 20-method file is counted as 1 code node.
 * The result is conservative passthrough — we'd rather miss a chance to
 * save tokens than feed Claude a sparse summary. v0.3.1 will tune this
 * from real hook-stats data, potentially by folding edge degree into the
 * coverage score so a richly-connected class node counts for more.
 */
const FILE_CONTEXT_COVERAGE_CEILING = 3;

/**
 * Resolve a file path (absolute or project-relative) against a project
 * root and return the engram graph's structural view of that file, plus
 * metadata needed by the Read interception hook to decide whether to use
 * the summary as a replacement for a raw file read.
 *
 * This is the bridge between the hook layer (which receives absolute
 * paths from Claude Code) and the graph layer (which stores sourceFile
 * as project-relative paths).
 *
 * Contract:
 *   - Never throws. Any internal error resolves to `found: false` with
 *     the failure reflected in nodeCount=0 and confidence=0.
 *   - Opens and closes the store in a single call. Caller must NOT hold
 *     the store open concurrently.
 *   - Does NOT check `.engram/hook-disabled` — that's the safety layer's
 *     job, handled upstream by the Read handler.
 *   - Does check file vs graph mtime and sets `isStale` accordingly, but
 *     still returns the summary. Caller decides what to do with stale data.
 */
export async function getFileContext(
  projectRoot: string,
  absFilePath: string
): Promise<FileContextResult> {
  const empty: FileContextResult = {
    found: false,
    confidence: 0,
    summary: "",
    nodeCount: 0,
    codeNodeCount: 0,
    avgNodeConfidence: 0,
    graphMtimeMs: 0,
    fileMtimeMs: null,
    isStale: false,
  };

  try {
    const root = resolve(projectRoot);
    const abs = resolve(absFilePath);
    // POSIX-normalize for consistent lookup against the graph, which
    // always stores sourceFile in POSIX form (see graph/path-utils.ts).
    const relPath = toPosixPath(relative(root, abs));

    // If the file is outside the project (relative path starts with ..),
    // there's no graph data for it by construction.
    if (relPath.startsWith("..") || relPath === "") {
      return empty;
    }

    // Capture the graph database mtime for staleness comparison. We use
    // the db file's fs mtime rather than the stats table's `last_mined`
    // key because the fs mtime is always up-to-date even if the stats
    // table lags behind incremental updates.
    const dbPath = getDbPath(root);
    let graphMtimeMs = 0;
    try {
      graphMtimeMs = statSync(dbPath).mtimeMs;
    } catch {
      // No graph.db — nothing to do. Return empty (found: false).
      return empty;
    }

    // Capture the file's mtime. If the file doesn't exist (common case
    // for new files during an Edit), fileMtimeMs is null and we treat the
    // summary as not-stale (the hook will still fall through because the
    // graph will have zero nodes for a file that doesn't exist yet).
    let fileMtimeMs: number | null = null;
    try {
      fileMtimeMs = statSync(abs).mtimeMs;
    } catch {
      fileMtimeMs = null;
    }

    const isStale = fileMtimeMs !== null && fileMtimeMs > graphMtimeMs;

    const store = await getStore(root);
    try {
      const summary = renderFileStructure(store, relPath);
      if (summary.codeNodeCount === 0) {
        // No code declarations → not worth a summary even if there's a
        // file metadata node. Treat as passthrough.
        return {
          ...empty,
          nodeCount: summary.nodeCount,
          codeNodeCount: 0,
          graphMtimeMs,
          fileMtimeMs,
          isStale,
        };
      }
      const coverageScore = Math.min(
        summary.codeNodeCount / FILE_CONTEXT_COVERAGE_CEILING,
        1
      );
      const confidence = coverageScore * summary.avgConfidence;
      return {
        found: true,
        confidence,
        summary: summary.text,
        nodeCount: summary.nodeCount,
        codeNodeCount: summary.codeNodeCount,
        avgNodeConfidence: summary.avgConfidence,
        graphMtimeMs,
        fileMtimeMs,
        isStale,
      };
    } finally {
      store.close();
    }
  } catch {
    // Never throw from getFileContext. Graceful degradation is the whole
    // point of the hook layer — any error here should fall through to
    // "no summary available" so the Read proceeds normally.
    return empty;
  }
}

export interface KeywordIDFResult {
  readonly keyword: string;
  readonly documentFrequency: number;
  readonly idf: number;
}

/**
 * v0.3.1: TF-IDF filter for UserPromptSubmit pre-query keywords.
 *
 * The problem this solves: substring matching in UserPromptSubmit was
 * producing massive false-positive injections. A prompt containing the
 * word "engram" would match every node whose label contained "engram"
 * (hundreds of them in the engram repo itself), injecting 70+ nodes of
 * noise before Claude started reasoning.
 *
 * The fix: compute inverse document frequency for each keyword against
 * the graph, drop keywords that appear in >15% of node labels. These
 * "common graph terms" have no discriminative value and should never
 * be used as query seeds.
 *
 * Returns a scored list sorted by IDF descending. Callers typically
 * filter this further (e.g., keep only entries with idf > 0) and take
 * the top N.
 *
 * Never throws. Returns an empty array on any internal error so the
 * handler falls back to its passthrough path.
 */
export async function computeKeywordIDF(
  projectRoot: string,
  keywords: readonly string[]
): Promise<KeywordIDFResult[]> {
  if (keywords.length === 0) return [];
  try {
    const root = resolve(projectRoot);
    const dbPath = getDbPath(root);
    if (!existsSync(dbPath)) return [];

    const store = await getStore(root);
    try {
      const allNodes = store.getAllNodes();
      const total = allNodes.length;
      if (total === 0) return [];

      // Pre-lowercase all node labels once to avoid repeated case-folding
      // inside the O(keywords * nodes) match loop.
      const labels = allNodes.map((n) => n.label.toLowerCase());

      const results: KeywordIDFResult[] = [];
      for (const kw of keywords) {
        const kwLower = kw.toLowerCase();
        let df = 0;
        for (const label of labels) {
          if (label.includes(kwLower)) df += 1;
        }
        // IDF = log(total / df). If df === 0, the keyword doesn't
        // appear in the graph at all — it's meaningless for this query.
        const idf = df === 0 ? 0 : Math.log(total / df);
        results.push({
          keyword: kw,
          documentFrequency: df,
          idf,
        });
      }

      // Sort by IDF descending so callers can take the top-N most
      // discriminative keywords.
      results.sort((a, b) => b.idf - a.idf);
      return results;
    } finally {
      store.close();
    }
  } catch {
    return [];
  }
}

export async function learn(
  projectRoot: string,
  text: string,
  sourceLabel = "manual"
): Promise<{ nodesAdded: number }> {
  const { nodes, edges } = learnFromSession(text, sourceLabel);
  if (nodes.length === 0 && edges.length === 0) return { nodesAdded: 0 };
  // Explicit `engram learn` is high-intent teaching, so its mistakes are
  // nag-worthy (>= the proactive-guard floor). Auto-inferred miners
  // (session-scan, bug-fix commits) stay at 0.6 and only browse, never nag.
  const promoted = nodes.map((n) =>
    n.kind === "mistake"
      ? { ...n, confidenceScore: Math.max(n.confidenceScore, 0.85), confidence: "EXTRACTED" as const }
      : n
  );
  const store = await getStore(projectRoot);
  try {
    store.bulkUpsert(promoted, edges);
  } finally {
    store.close();
  }
  return { nodesAdded: promoted.length };
}

export interface MistakeEntry {
  id: string;
  label: string;
  confidence: string;
  confidenceScore: number;
  sourceFile: string;
  lastVerified: number;
  /**
   * v4.0 bi-temporal fields (schema v9). All optional for back-compat with
   * v3.x mistakes captured before the v9 columns existed. When all four are
   * undefined, the CLI/provider render the legacy single-line layout.
   */
  thenBelieved?: string;
  foundFalseAt?: number;
  truthNow?: string;
  appliesTo?: string;
}

/**
 * v0.2: list mistake nodes from the graph. Powers the `engram mistakes`
 * CLI command and the `list_mistakes` MCP tool. Mistakes are sorted by
 * most-recently-verified first.
 *
 * v0.3: added `sourceFile` option. When set, only returns mistakes whose
 * `sourceFile` matches (exact string match, project-relative). Used by
 * the Edit/Write hook handler for per-file landmine lookups.
 */
export async function mistakes(
  projectRoot: string,
  options: {
    limit?: number;
    sinceDays?: number;
    sourceFile?: string;
    /**
     * Minimum confidenceScore to include. Proactive nag-paths (the
     * Edit/Write landmine, the explicit guard) pass a floor so only
     * high-confidence mistakes (reverts) warn; `engram mistakes` and the
     * init count omit it to show the full history.
     */
    minConfidence?: number;
  } = {}
): Promise<MistakeEntry[]> {
  const store = await getStore(projectRoot);
  try {
    let items = store.getAllNodes().filter((n) => n.kind === "mistake");

    if (options.sourceFile !== undefined) {
      const target = options.sourceFile;
      items = items.filter((m) => m.sourceFile === target);
    }

    if (options.minConfidence !== undefined) {
      const floor = options.minConfidence;
      items = items.filter((m) => m.confidenceScore >= floor);
    }

    if (options.sinceDays !== undefined) {
      const cutoff = Date.now() - options.sinceDays * 24 * 60 * 60 * 1000;
      items = items.filter((m) => m.lastVerified >= cutoff);
    }

    items.sort((a, b) => b.lastVerified - a.lastVerified);

    const limit = options.limit ?? 20;
    return items.slice(0, limit).map((m) => ({
      id: m.id,
      label: m.label,
      confidence: m.confidence,
      confidenceScore: m.confidenceScore,
      sourceFile: m.sourceFile,
      lastVerified: m.lastVerified,
      thenBelieved: m.thenBelieved,
      foundFalseAt: m.foundFalseAt,
      truthNow: m.truthNow,
      appliesTo: m.appliesTo,
    }));
  } finally {
    store.close();
  }
}

export async function benchmark(
  projectRoot: string,
  questions?: string[]
): Promise<{
  naiveFullCorpus: number;
  naiveRelevantFiles: number;
  avgQueryTokens: number;
  reductionVsFull: number;
  reductionVsRelevant: number;
  perQuestion: Array<{ question: string; tokens: number; reductionFull: number; reductionRelevant: number }>;
}> {
  const root = resolve(projectRoot);
  const store = await getStore(root);
  try {
    const allNodes = store.getAllNodes();

    // Full corpus baseline (all source files)
    let fullCorpusChars = 0;
    const seenFiles = new Set<string>();
    for (const node of allNodes) {
      if (node.sourceFile && !seenFiles.has(node.sourceFile)) {
        seenFiles.add(node.sourceFile);
        try {
          const fullPath = join(root, node.sourceFile);
          if (existsSync(fullPath)) fullCorpusChars += readFileSync(fullPath, "utf-8").length;
        } catch { /* skip */ }
      }
    }
    const naiveFullCorpus = Math.ceil(fullCorpusChars / 4);

    const qs = questions ?? [
      "how does authentication work",
      "what is the main entry point",
      "how are errors handled",
      "what connects the data layer to the api",
      "what are the core abstractions",
    ];

    const perQuestion: Array<{ question: string; tokens: number; reductionFull: number; reductionRelevant: number }> = [];

    for (const q of qs) {
      const result = queryGraph(store, q, { tokenBudget: 2000 });
      if (result.estimatedTokens > 0) {
        // Relevant files baseline: only files containing matched nodes
        const matchedFiles = new Set(result.nodes.map((n) => n.sourceFile).filter(Boolean));
        let relevantChars = 0;
        for (const f of matchedFiles) {
          try {
            const fullPath = join(root, f);
            if (existsSync(fullPath)) relevantChars += readFileSync(fullPath, "utf-8").length;
          } catch { /* skip */ }
        }
        const naiveRelevant = Math.ceil(relevantChars / 4) || 1;

        perQuestion.push({
          question: q,
          tokens: result.estimatedTokens,
          reductionFull: naiveFullCorpus > 0
            ? Math.round((naiveFullCorpus / result.estimatedTokens) * 10) / 10
            : 0,
          reductionRelevant: Math.round((naiveRelevant / result.estimatedTokens) * 10) / 10,
        });
      }
    }

    const avgQueryTokens = perQuestion.length > 0
      ? Math.round(perQuestion.reduce((sum, p) => sum + p.tokens, 0) / perQuestion.length)
      : 0;

    const avgRelevantChars = perQuestion.length > 0
      ? perQuestion.reduce((sum, p) => sum + p.reductionRelevant, 0) / perQuestion.length
      : 0;

    return {
      naiveFullCorpus,
      naiveRelevantFiles: avgQueryTokens > 0 ? Math.round(avgQueryTokens * avgRelevantChars) : 0,
      avgQueryTokens,
      reductionVsFull: avgQueryTokens > 0 ? Math.round((naiveFullCorpus / avgQueryTokens) * 10) / 10 : 0,
      reductionVsRelevant: Math.round(avgRelevantChars * 10) / 10,
      perQuestion,
    };
  } finally {
    store.close();
  }
}

/**
 * Honest phrasing for a packet/baseline ratio. A ratio > 1 is a genuine
 * reduction ("Nx smaller packet"); a ratio < 1 means the packet is LARGER than
 * the baseline it would replace — engram passes through rather than shipping it,
 * so saying "0.2x smaller" would be a backwards (over-)claim. Centralised so the
 * CLI, the older bench print, and the HTTP server can't drift.
 */
export function packetRatioPhrase(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return "n/a";
  if (ratio >= 1) return `${ratio}x smaller packet`;
  return `${Math.round((1 / ratio) * 10) / 10}x LARGER — engram passes through`;
}
