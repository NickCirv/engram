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
 * Re-index a single file: delete old nodes, extract new ones, upsert.
 * Returns the count of nodes inserted, or 0 if the file was skipped.
 */
async function reindexFile(
  absPath: string,
  projectRoot: string
): Promise<number> {
  const ext = extname(absPath).toLowerCase();
  if (!WATCHABLE_EXTENSIONS.has(ext)) return 0;
  if (!existsSync(absPath)) return 0;

  // Skip directories
  try {
    if (statSync(absPath).isDirectory()) return 0;
  } catch {
    return 0;
  }

  const relPath = toPosixPath(relative(projectRoot, absPath));
  if (shouldIgnore(relPath)) return 0;

  const store = await getStore(projectRoot);
  try {
    // Remove old nodes/edges for this file
    store.deleteBySourceFile(relPath);

    // Re-extract
    const { nodes, edges } = extractFile(absPath, projectRoot);

    // Upsert new nodes/edges
    if (nodes.length > 0 || edges.length > 0) {
      store.bulkUpsert(nodes, edges);
    }

    return nodes.length;
  } finally {
    store.close();
  }
}

export interface WatchOptions {
  /** Called when a file is re-indexed. */
  readonly onReindex?: (filePath: string, nodeCount: number) => void;
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

  watcher.on("change", (_eventType, filename) => {
    if (typeof filename !== "string") return;

    // Normalize the filename to an absolute path
    const absPath = resolve(root, filename);
    const relPath = toPosixPath(relative(root, absPath));

    if (shouldIgnore(relPath)) return;

    const ext = extname(filename).toLowerCase();
    if (!WATCHABLE_EXTENSIONS.has(ext)) return;

    // Debounce: clear existing timer for this file
    const existing = debounceTimers.get(absPath);
    if (existing) clearTimeout(existing);

    debounceTimers.set(
      absPath,
      setTimeout(async () => {
        debounceTimers.delete(absPath);
        try {
          const count = await reindexFile(absPath, root);
          if (count > 0) {
            options.onReindex?.(relPath, count);
          }
        } catch (err) {
          options.onError?.(
            err instanceof Error ? err : new Error(String(err))
          );
        }
      }, DEBOUNCE_MS)
    );
  });

  watcher.on("error", (err) => {
    options.onError?.(err instanceof Error ? err : new Error(String(err)));
  });

  options.onReady?.();

  return controller;
}
