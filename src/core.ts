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
import { mineSessionHistory, learnFromSession } from "./miners/session-miner.js";
import { mineSkills } from "./miners/skills-miner.js";
import type { GraphStats } from "./graph/schema.js";

const ENGRAM_DIR = ".engram";
const DB_FILE = "graph.db";
const LOCK_FILE = "init.lock";
const DEFAULT_SKILLS_DIR = join(homedir(), ".claude", "skills");

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
}

export interface InitOptions {
  /**
   * Index Claude Code skills from the given directory.
   *   - `true` → use `~/.claude/skills/`
   *   - `string` → use the given path
   *   - `false` | `undefined` → skip (default)
   */
  withSkills?: boolean | string;
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
    const { nodes, edges, fileCount, totalLines } = extractDirectory(root);
    const gitResult = mineGitHistory(root);
    const sessionResult = mineSessionHistory(root);

    let skillCount = 0;
    let skillNodes: typeof nodes = [];
    let skillEdges: typeof edges = [];
    if (options.withSkills) {
      const skillsDir =
        typeof options.withSkills === "string"
          ? options.withSkills
          : DEFAULT_SKILLS_DIR;
      const skillsResult = mineSkills(skillsDir);
      skillCount = skillsResult.skillCount;
      skillNodes = skillsResult.nodes;
      skillEdges = skillsResult.edges;
    }

    const allNodes = [
      ...nodes,
      ...gitResult.nodes,
      ...sessionResult.nodes,
      ...skillNodes,
    ];
    const allEdges = [
      ...edges,
      ...gitResult.edges,
      ...sessionResult.edges,
      ...skillEdges,
    ];

    const store = await getStore(root);
    try {
      store.clearAll();
      store.bulkUpsert(allNodes, allEdges);
      store.setStat("last_mined", String(Date.now()));
      store.setStat("project_root", root);
    } finally {
      store.close();
    }

    return {
      nodes: allNodes.length,
      edges: allEdges.length,
      fileCount,
      totalLines,
      timeMs: Date.now() - start,
      skillCount,
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
  const store = await getStore(projectRoot);
  try {
    store.bulkUpsert(nodes, edges);
  } finally {
    store.close();
  }
  return { nodesAdded: nodes.length };
}

export interface MistakeEntry {
  id: string;
  label: string;
  confidence: string;
  confidenceScore: number;
  sourceFile: string;
  lastVerified: number;
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
  } = {}
): Promise<MistakeEntry[]> {
  const store = await getStore(projectRoot);
  try {
    let items = store.getAllNodes().filter((n) => n.kind === "mistake");

    if (options.sourceFile !== undefined) {
      const target = options.sourceFile;
      items = items.filter((m) => m.sourceFile === target);
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
