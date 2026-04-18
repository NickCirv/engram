/**
 * File watcher — incremental re-indexing on file save.
 *
 * Instead of rebuilding the entire graph with `engram init`, this watches
 * the project directory for changes and re-extracts only the modified
 * file's AST nodes. The graph stays fresh without manual intervention.
 *
 * Uses Node.js native `fs.watch` (recursive) — no native dependencies.
 *
 * Architecture:
 *   - Debounce: 300ms per file (IDEs save multiple times per keystroke)
 *   - Only re-indexes files with known language extensions
 *   - Ignores .engram/, node_modules, .git, dist, build
 *   - Deletes old nodes for the file, then re-inserts fresh ones
 *   - Saves the graph after each batch
 */
import { watch, existsSync, statSync } from "node:fs";
import { resolve, relative, extname, join, sep } from "node:path";
import { extractFile } from "./miners/ast-miner.js";
import { toPosixPath } from "./graph/path-utils.js";
import { getStore, getDbPath } from "./core.js";

/** Extensions the AST miner can handle. */
const WATCHABLE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs",
  ".java", ".c", ".cpp", ".cs", ".rb",
]);

/** Directories to ignore entirely. */
const IGNORED_DIRS = new Set([
  ".engram", "node_modules", ".git", "dist", "build",
  ".next", "__pycache__", ".venv", "target", "vendor",
]);

/** Debounce window in ms. */
const DEBOUNCE_MS = 300;

/**
 * Check whether a relative path should be ignored.
 */
function shouldIgnore(relPath: string): boolean {
  const parts = relPath.split(/[/\\]/);
  return parts.some((p) => IGNORED_DIRS.has(p));
}

/**
 * Result of a `syncFile` call.
 *  - "indexed": file existed and was re-extracted; `count` is nodes inserted.
 *  - "pruned":  file was missing AND had been previously indexed; `count` is
 *               the number of nodes removed.
 *  - "skipped": unsupported extension, ignored directory, directory itself,
 *               or missing file that was never indexed. `count` is 0.
 */
export type SyncResult =
  | { readonly action: "indexed"; readonly count: number }
  | { readonly action: "pruned"; readonly count: number }
  | { readonly action: "skipped"; readonly count: 0 };

/**
 * Bring the graph in sync with one file path: re-index if it exists, prune
 * if it doesn't (and was previously indexed). Shared by `engram watch` and
 * the `engram reindex` CLI subcommand so both have identical semantics.
 */
export async function syncFile(
  absPath: string,
  projectRoot: string
): Promise<SyncResult> {
  const ext = extname(absPath).toLowerCase();
  if (!WATCHABLE_EXTENSIONS.has(ext)) return { action: "skipped", count: 0 };

  const relPath = toPosixPath(relative(projectRoot, absPath));
  if (shouldIgnore(relPath)) return { action: "skipped", count: 0 };

  if (!existsSync(absPath)) {
    const store = await getStore(projectRoot);
    try {
      const prior = store.countBySourceFile(relPath);
      if (prior === 0) return { action: "skipped", count: 0 };
      store.deleteBySourceFile(relPath);
      return { action: "pruned", count: prior };
    } finally {
      store.close();
    }
  }

  try {
    if (statSync(absPath).isDirectory()) return { action: "skipped", count: 0 };
  } catch {
    return { action: "skipped", count: 0 };
  }

  const store = await getStore(projectRoot);
  try {
    store.deleteBySourceFile(relPath);
    const { nodes, edges } = extractFile(absPath, projectRoot);
    if (nodes.length > 0 || edges.length > 0) {
      store.bulkUpsert(nodes, edges);
    }
    return { action: "indexed", count: nodes.length };
  } finally {
    store.close();
  }
}

export interface WatchOptions {
  /** Called when a file is re-indexed. */
  readonly onReindex?: (filePath: string, nodeCount: number) => void;
  /** Called when a file's nodes are pruned because the file was deleted. */
  readonly onDelete?: (filePath: string, prunedCount: number) => void;
  /** Called on errors. */
  readonly onError?: (error: Error) => void;
  /** Called when the watcher starts. */
  readonly onReady?: () => void;
}

/**
 * Start watching a project directory for file changes. Returns an
 * AbortController — call `.abort()` to stop watching.
 */
export function watchProject(
  projectRoot: string,
  options: WatchOptions = {}
): AbortController {
  const root = resolve(projectRoot);
  const controller = new AbortController();

  if (!existsSync(getDbPath(root))) {
    throw new Error(
      `engram: no graph found at ${root}. Run 'engram init' first.`
    );
  }

  // Per-instance debounce map — no shared mutable state across callers.
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const watcher = watch(root, { recursive: true, signal: controller.signal });

  const handleEvent = (_eventType: string, filename: unknown): void => {
    if (typeof filename !== "string") return;

    const absPath = resolve(root, filename);
    const relPath = toPosixPath(relative(root, absPath));

    if (shouldIgnore(relPath)) return;

    const ext = extname(filename).toLowerCase();
    if (!WATCHABLE_EXTENSIONS.has(ext)) return;

    const existing = debounceTimers.get(absPath);
    if (existing) clearTimeout(existing);

    debounceTimers.set(
      absPath,
      setTimeout(async () => {
        debounceTimers.delete(absPath);
        try {
          const result = await syncFile(absPath, root);
          if (result.action === "indexed" && result.count > 0) {
            options.onReindex?.(relPath, result.count);
          } else if (result.action === "pruned") {
            options.onDelete?.(relPath, result.count);
          }
        } catch (err) {
          options.onError?.(
            err instanceof Error ? err : new Error(String(err))
          );
        }
      }, DEBOUNCE_MS)
    );
  };

  // fs.watch fires "change" for content edits and "rename" for create/delete
  // (recursive mode, all platforms). Subscribe to both so deletions prune.
  watcher.on("change", handleEvent);
  watcher.on("rename", handleEvent);

  watcher.on("error", (err) => {
    options.onError?.(err instanceof Error ? err : new Error(String(err)));
  });

  options.onReady?.();

  return controller;
}
