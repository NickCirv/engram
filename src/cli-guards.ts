import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * True iff `project` has an initialized engram graph (`.engram/graph.db`).
 *
 * Graph-reading commands (`query`, `gen`, …) use this to fail LOUDLY on a
 * missing or mistyped `--project` instead of silently "succeeding" — e.g.
 * `query` would otherwise print "No matching nodes found" and exit 0 against a
 * path that has no graph at all, which reads as "your code has nothing" rather
 * than "you pointed me at the wrong place" (engram issue #92).
 */
export function hasGraph(project: string): boolean {
  return existsSync(join(resolve(project), ".engram", "graph.db"));
}

/** Canonical stderr line when a project has no engram graph. */
export function noGraphMessage(project: string): string {
  return `engram: no graph found at ${resolve(project)}. Run 'engram init' first.`;
}
