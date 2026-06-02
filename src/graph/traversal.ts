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

/** Bare symbol name — strips the `(params)` the regex miner appends to labels. */
function bareName(label: string): string {
  return label.split("(")[0].trim();
}

function callsEdges(edges: readonly GraphEdge[]): GraphEdge[] {
  return edges.filter((e) => e.relation === "calls");
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
