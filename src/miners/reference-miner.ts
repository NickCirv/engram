/**
 * Reference miner (Fix #3, Phase 3.1) — builds the cross-file reference graph
 * the ranking engine (PageRank) needs.
 *
 * The regex AST miner extracts DEFINITIONS (functions/classes) but emits NO
 * call/reference edges — so there was no graph to rank. This miner adds the
 * missing dimension using the SAME tree-sitter parsers the `engram:ast`
 * provider already loads (no new infra), then resolves callee names to
 * definition nodes across files (name-based, like codegraph + Aider).
 *
 * Two-step, matching the verified category leaders:
 *   1. extractFileReferences() — tree-sitter walk → the callee names a file uses.
 *   2. resolveCallEdges() — pure: name → def-node-in-another-file → `calls` edge.
 *
 * Edges are provenance-tagged `metadata.provenance = "heuristic"` (name-based;
 * a future LSP pass can upgrade to "resolved" and fix name collisions). Edges
 * are deduped and capped per file to bound graph size on large repos.
 *
 * Safety: every parse is wrapped; unsupported languages and parse errors yield
 * zero references (never throws). Trees are freed (`tree.delete()`) to avoid a
 * WASM heap leak across a many-file loop.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Node } from "web-tree-sitter";
import { getSupportedLang, getParser } from "../providers/grammar-loader.js";
import type { GraphEdge, GraphNode } from "../graph/schema.js";

/** Skip files larger than this for reference parsing (minified bundles, etc.)
 *  to avoid multi-second tree-sitter stalls / WASM heap blowups on init. */
const MAX_REF_FILE_BYTES = 1_000_000;

/** A callee name resolving to more defs than this is too ambiguous to be
 *  signal (e.g. `get`/`map`/`on`); skip it so it doesn't pollute the graph. */
const MAX_AMBIGUOUS_DEFS = 10;

/** Tree-sitter node types that denote a call/instantiation across languages. */
const CALL_NODE_TYPES = new Set([
  "call_expression", // JS/TS/Rust/C/C++
  "call", // Python/Ruby/Go
  "method_invocation", // Java
  "function_call_expression", // PHP
  "new_expression", // JS/TS `new Foo()`
  "object_creation_expression", // Java `new Foo()`
]);

/** Definition node kinds whose label is a valid call/reference target. */
const CALLABLE_KINDS = new Set<GraphNode["kind"]>([
  "function",
  "class",
  "method",
  "interface",
  "type",
  "variable",
]);

/** Walk down (right-biased) to the trailing identifier of a callee expression. */
function trailingIdentifier(node: Node): string | null {
  const t = node.type;
  if (t === "identifier" || t === "property_identifier" || t === "field_identifier") {
    return node.text;
  }
  for (let i = node.childCount - 1; i >= 0; i--) {
    const child = node.child(i);
    if (!child) continue;
    const name = trailingIdentifier(child);
    if (name) return name;
  }
  return null;
}

/** The callee name of a call node (handles `foo()`, `a.b.foo()`, `new Foo()`). */
function calleeName(callNode: Node): string | null {
  const fn =
    callNode.childForFieldName("function") ??
    callNode.childForFieldName("name") ??
    callNode.childForFieldName("constructor") ??
    callNode.child(0);
  if (!fn) return null;
  return trailingIdentifier(fn);
}

/** All distinct callee names referenced in a parsed source tree. */
function extractCalleeNames(root: Node): string[] {
  const names = new Set<string>();
  const visit = (node: Node): void => {
    if (CALL_NODE_TYPES.has(node.type)) {
      const name = calleeName(node);
      // length >= 1 so single-char callees ($ / _ — jQuery, lodash) aren't dropped.
      if (name && name.length >= 1) names.add(name);
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) visit(child);
    }
  };
  visit(root);
  return [...names];
}

/**
 * Parse a single source file and return the distinct callee names it uses.
 * Async (tree-sitter parsers load via WASM). Returns [] on anything unsupported
 * or unparseable. Frees the tree to avoid a WASM heap leak.
 */
export async function extractFileReferences(
  filePath: string,
  source: string
): Promise<string[]> {
  const lang = getSupportedLang(filePath);
  if (!lang) return [];
  const parser = await getParser(lang);
  if (!parser) return [];
  let tree: ReturnType<typeof parser.parse> | null = null;
  try {
    tree = parser.parse(source);
    if (!tree) return [];
    return extractCalleeNames(tree.rootNode);
  } catch {
    return [];
  } finally {
    try {
      tree?.delete();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Pure resolver: given the file + definition nodes already in the graph and a
 * map of (file relPath → callee names it uses), emit cross-file `calls` edges
 * from the calling file node to each resolved definition node.
 *
 * - Name-based: a name resolves to every CALLABLE def node sharing that label.
 * - Cross-file only: intra-file references are skipped (no ranking signal).
 * - Deduped (source+target) and capped per file (`maxPerFile`, default 60).
 */
export function resolveCallEdges(
  nodes: readonly GraphNode[],
  fileRefs: ReadonlyMap<string, readonly string[]>,
  opts: { maxPerFile?: number } = {}
): GraphEdge[] {
  const maxPerFile = opts.maxPerFile ?? 60;
  const now = Date.now();

  // Bare symbol name from a def label. The regex miner labels functions as
  // `foo()` / `foo(params)` / `foo<T>(params)`, but tree-sitter callee names
  // are bare (`foo`). Split on the first `(` OR `<` so generic functions
  // (`wrap<T>()`) also match their bare callee name.
  const bareName = (label: string): string => label.split(/[(<]/)[0].trim();

  // bare-name → callable def nodes
  const byLabel = new Map<string, GraphNode[]>();
  // file relPath → file node id
  const fileIdByPath = new Map<string, string>();
  for (const n of nodes) {
    if (n.kind === "file") {
      fileIdByPath.set(n.sourceFile, n.id);
    } else if (CALLABLE_KINDS.has(n.kind)) {
      const key = bareName(n.label);
      if (key.length === 0) continue;
      const arr = byLabel.get(key);
      if (arr) arr.push(n);
      else byLabel.set(key, [n]);
    }
  }

  const edges: GraphEdge[] = [];
  for (const [relPath, names] of fileRefs) {
    const callerId = fileIdByPath.get(relPath);
    if (!callerId) continue;
    const seen = new Set<string>();
    let count = 0;
    for (const name of names) {
      if (count >= maxPerFile) break;
      const defs = byLabel.get(name);
      if (!defs) continue;
      // Too-common name (defined in many files) is noise, not a real call —
      // skip so it doesn't eat the per-file budget with spurious edges.
      if (defs.length > MAX_AMBIGUOUS_DEFS) continue;
      for (const def of defs) {
        if (def.sourceFile === relPath) continue; // intra-file — no signal
        if (seen.has(def.id)) continue;
        seen.add(def.id);
        edges.push({
          source: callerId,
          target: def.id,
          relation: "calls",
          confidence: "INFERRED",
          confidenceScore: 0.7,
          sourceFile: relPath,
          sourceLocation: null,
          lastVerified: now,
          metadata: { provenance: "heuristic", via: "name", name },
        });
        count += 1;
        if (count >= maxPerFile) break;
      }
    }
  }
  return edges;
}

/**
 * Build cross-file `calls` edges for a whole project. Re-reads each file node's
 * source (the regex miner didn't retain content) and parses it for references,
 * then resolves. Intended for FULL (non-incremental) init only.
 */
export async function buildReferenceEdges(
  projectRoot: string,
  nodes: readonly GraphNode[]
): Promise<GraphEdge[]> {
  const fileRefs = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.kind !== "file") continue;
    try {
      const abs = join(projectRoot, n.sourceFile);
      // Skip oversized files (minified bundles) — a synchronous tree-sitter
      // parse of a multi-MB file stalls init and bloats the WASM heap.
      if (statSync(abs).size > MAX_REF_FILE_BYTES) continue;
      const source = readFileSync(abs, "utf-8");
      const names = await extractFileReferences(n.sourceFile, source);
      if (names.length > 0) fileRefs.set(n.sourceFile, names);
    } catch {
      /* unreadable / binary — skip */
    }
  }
  return resolveCallEdges(nodes, fileRefs);
}
