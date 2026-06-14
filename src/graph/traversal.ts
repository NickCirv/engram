/**
 * Graph traversal (Fix #3.5) — `callers / callees / impact` queries over the
 * `calls` reference graph built by the reference miner (Fix #3.1).
 *
 * Closes the visible gap vs codegraph (the 37.8k category leader ships
 * `callers/callees/impact/explore` verbs). Pure functions over nodes+edges so
 * they're trivially testable; the CLI/core wrappers just load the store.
 *
 * Edge model (from reference-miner): a `calls` edge goes
 *   caller FILE node  ──calls──▶  callee DEFINITION node
 * so "callers of a symbol" are FILES, and "callees of a file" are DEFS.
 */
import type { GraphEdge, GraphNode } from "./schema.js";

const CALLABLE_KINDS = new Set<GraphNode["kind"]>([
  "function",
  "class",
  "method",
  "interface",
  "type",
  "variable",
]);

/** Bare symbol name — strips `(params)` and `<generics>` from miner labels
 *  (`foo()`, `wrap<T>(x)`) so traversal matches the bare callee name. */
function bareName(label: string): string {
  return label.split(/[(<]/)[0].trim();
}

function callsEdges(edges: readonly GraphEdge[]): GraphEdge[] {
  return edges.filter((e) => e.relation === "calls");
}

function importsEdges(edges: readonly GraphEdge[]): GraphEdge[] {
  return edges.filter((e) => e.relation === "imports");
}

/** Resolve a file argument (source path or label) to its file node. */
function resolveFileNode(
  nodes: readonly GraphNode[],
  file: string
): GraphNode | undefined {
  return nodes.find((n) => n.kind === "file" && (n.sourceFile === file || n.label === file));
}

/**
 * Files that call a symbol (incoming `calls` edges to defs named `name`).
 * Returns sorted, de-duplicated caller file paths.
 */
export function findCallers(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  name: string
): string[] {
  const target = bareName(name);
  const defIds = new Set(
    nodes.filter((n) => CALLABLE_KINDS.has(n.kind) && bareName(n.label) === target).map((n) => n.id)
  );
  if (defIds.size === 0) return [];
  const fileById = new Map(nodes.filter((n) => n.kind === "file").map((n) => [n.id, n.sourceFile]));
  const callers = new Set<string>();
  for (const e of callsEdges(edges)) {
    if (defIds.has(e.target)) {
      callers.add(fileById.get(e.source) ?? e.sourceFile);
    }
  }
  return [...callers].sort();
}

/**
 * Definitions that a symbol's (or file's) file calls (outgoing `calls` edges
 * from the file node). Returns sorted `{ name, file }` of the callees.
 */
export function findCallees(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  name: string
): Array<{ name: string; file: string }> {
  // Resolve `name` to a source file: a file node by path/label, else the file
  // that defines a symbol named `name`.
  const bare = bareName(name);
  let fileId: string | undefined;
  const fileNode =
    nodes.find((n) => n.kind === "file" && (n.sourceFile === name || n.label === name)) ??
    undefined;
  if (fileNode) {
    fileId = fileNode.id;
  } else {
    const def = nodes.find((n) => CALLABLE_KINDS.has(n.kind) && bareName(n.label) === bare);
    if (def) {
      const owningFile = nodes.find((n) => n.kind === "file" && n.sourceFile === def.sourceFile);
      fileId = owningFile?.id;
    }
  }
  if (!fileId) return [];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const out: Array<{ name: string; file: string }> = [];
  const seen = new Set<string>();
  for (const e of callsEdges(edges)) {
    if (e.source !== fileId || seen.has(e.target)) continue;
    seen.add(e.target);
    const def = nodeById.get(e.target);
    if (def) out.push({ name: bareName(def.label), file: def.sourceFile });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Files that import `file` (incoming `imports` edges to `file`'s node).
 *
 * Edge model (from ast-miner): an `imports` edge goes
 *   importer FILE node  ──imports──▶  imported FILE node (local) | module id (external)
 * so "importers of a file" are the source FILE nodes of import edges whose
 * target is `file`'s node. External-module import edges (target is a synthetic
 * module id, not a file node) never match here. Returns sorted, de-duplicated
 * importer file paths (excluding `file` itself).
 */
export function findImporters(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  file: string
): string[] {
  const target = resolveFileNode(nodes, file);
  if (!target) return [];
  const fileById = new Map(nodes.filter((n) => n.kind === "file").map((n) => [n.id, n.sourceFile]));
  const importers = new Set<string>();
  for (const e of importsEdges(edges)) {
    if (e.target !== target.id) continue;
    const src = fileById.get(e.source);
    if (src && src !== target.sourceFile) importers.add(src);
  }
  return [...importers].sort();
}

/**
 * Files that `file` imports (outgoing `imports` edges from `file`'s node,
 * resolved to local file nodes). External-module imports (target is a synthetic
 * module id, not a file node) are excluded — they have no in-repo file to
 * surface. Returns sorted, de-duplicated imported file paths (excluding `file`).
 */
export function findImports(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  file: string
): string[] {
  const origin = resolveFileNode(nodes, file);
  if (!origin) return [];
  const fileById = new Map(nodes.filter((n) => n.kind === "file").map((n) => [n.id, n.sourceFile]));
  const imported = new Set<string>();
  for (const e of importsEdges(edges)) {
    if (e.source !== origin.id) continue;
    const tgt = fileById.get(e.target); // undefined for external-module targets
    if (tgt && tgt !== origin.sourceFile) imported.add(tgt);
  }
  return [...imported].sort();
}

/**
 * Transitive blast radius: all files that (directly or transitively) depend on
 * the file defining `name`. Backward BFS over the file→file dependency derived
 * from `calls` edges (caller file depends on the callee's defining file).
 * Excludes the origin file itself.
 */
export function findImpact(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  name: string
): string[] {
  const bare = bareName(name);
  const def = nodes.find((n) => CALLABLE_KINDS.has(n.kind) && bareName(n.label) === bare);
  if (!def) return [];
  const originFile = def.sourceFile;

  const fileById = new Map(nodes.filter((n) => n.kind === "file").map((n) => [n.id, n.sourceFile]));
  const fileByDefId = new Map(
    nodes.filter((n) => CALLABLE_KINDS.has(n.kind)).map((n) => [n.id, n.sourceFile])
  );
  // reverseDeps: file → set of files that depend on it (i.e. call into it).
  const reverseDeps = new Map<string, Set<string>>();
  for (const e of callsEdges(edges)) {
    const callerFile = fileById.get(e.source);
    const calleeFile = fileByDefId.get(e.target);
    if (!callerFile || !calleeFile || callerFile === calleeFile) continue;
    let set = reverseDeps.get(calleeFile);
    if (!set) reverseDeps.set(calleeFile, (set = new Set()));
    set.add(callerFile);
  }

  const affected = new Set<string>();
  const queue = [originFile];
  while (queue.length > 0) {
    const f = queue.shift()!;
    for (const dependant of reverseDeps.get(f) ?? []) {
      if (!affected.has(dependant)) {
        affected.add(dependant);
        queue.push(dependant);
      }
    }
  }
  affected.delete(originFile);
  return [...affected].sort();
}
