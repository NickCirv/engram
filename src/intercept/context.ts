/**
 * Hook context module — path normalization, project root detection, and
 * exempt-path checks.
 *
 * Every hook handler that receives a file path from Claude Code needs to:
 *   1. Normalize the path to an absolute, canonical form.
 *   2. Walk up the directory tree to find a project root with `.engram/graph.db`.
 *   3. Check that the path is not in an exempt zone (/tmp/engram-cache/, etc).
 *
 * This module centralizes that logic so every handler gets it right.
 *
 * Design decisions:
 *   - Project root walking is cached per-invocation in a Map. The hook
 *     process is short-lived (single tool call, then exit), so a bounded
 *     cache is safe and avoids redundant stat() calls when multiple
 *     handlers run in the same process.
 *   - Exempt paths include /tmp/ and /var/ wholesale (system scratch space
 *     and OS files that should never be intercepted) plus specifically
 *     `.engram/cache/` paths (to prevent loops if engram ever writes its
 *     own summaries to a cache file that would itself be Read).
 *   - We never follow symlinks outside the project root, which prevents
 *     a symlinked file from tricking engram into thinking it belongs to a
 *     project graph.
 */
import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

/** Directory name that marks an engram-initialized project. */
const ENGRAM_DIR = ".engram";

/** Filename inside `.engram/` that actually holds the graph. */
const GRAPH_FILE = "graph.db";

/** Maximum directory walk depth when searching for a project root. */
const MAX_WALK_DEPTH = 40;

/**
 * Per-invocation cache mapping file paths to resolved project roots.
 * Cleared when the hook process exits (since each hook invocation is a
 * fresh Node process, this Map never grows beyond a handful of entries).
 */
const projectRootCache = new Map<string, string | null>();

/**
 * Explicit cache reset for tests. Production code never calls this.
 */
export function _resetCacheForTests(): void {
  projectRootCache.clear();
}

/**
 * Normalize a file path to absolute, canonical form suitable for lookup in
 * the graph. Relative paths are resolved against `cwd` (which comes from
 * the hook payload, so it's the agent's current working directory).
 *
 * Does NOT follow symlinks by default — we want the path as the agent sees
 * it, not its real target. Callers that need the real path should call
 * `realpathSync` themselves after this.
 */
export function normalizePath(filePath: string, cwd: string): string {
  if (!filePath) return "";
  try {
    const abs = isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
    // Collapse `..` and `.` segments; do not follow symlinks.
    return resolve(abs);
  } catch {
    // path.resolve historically accepted weird inputs but recent Node
    // versions tighten validation on null bytes and invalid UTF-16
    // surrogates. Any throw here resolves to "no intercept" — safer than
    // letting the error propagate through the hook.
    return "";
  }
}

/**
 * Check whether a path is in a project-internal ignored zone. These
 * directories CAN exist inside a legitimate engram project but must never
 * be intercepted because they're not user code or they'd cause loops.
 *
 * Ignored zones:
 *   - Anything containing `.engram/cache/` — prevents recursive interception
 *     if engram writes its own summaries to cache files
 *   - Anything containing `/node_modules/` — dependencies, not user code
 *   - Anything containing `/.git/` — version control internals
 *
 * Note: we do NOT blanket-exempt `/tmp/` or `/var/folders/` because the
 * project-root walk already handles those correctly — ephemeral files in
 * those locations won't have a `.engram/` ancestor and so will resolve to
 * no-project-root (which naturally passes through). Blanket-exempting
 * would break tests and legitimate projects that live under a temp dir.
 *
 * Returns true if the path should be treated as project-internal-ignored.
 */
export function isExemptPath(absPath: string): boolean {
  if (!absPath) return true;
  // Normalize separators for cross-platform checks (Windows in future).
  const p = absPath.replaceAll(sep, "/");
  if (p.includes("/.engram/cache/")) return true;
  if (p.includes("/node_modules/")) return true;
  if (p.includes("/.git/")) return true;
  return false;
}

/**
 * Wholesale system scratch path check. These are locations where engram
 * should never intercept regardless of whether we find a .engram/ ancestor
 * — they're true scratch space where a "project" would be accidental.
 *
 * Only applies outside of a detected project root. If we find a real
 * project root inside /tmp/ (because the user or a test deliberately put
 * one there), we respect it.
 */
function isHardSystemPath(absPath: string): boolean {
  if (!absPath) return true;
  const p = absPath.replaceAll(sep, "/");

  // POSIX: filesystem root, device files, proc/sys entries.
  if (p === "/" || p.startsWith("/dev/") || p.startsWith("/proc/")) return true;
  if (p.startsWith("/sys/")) return true;

  // Windows: UNC device paths, system directories. Drive letter is
  // normalized to forward slash by the replaceAll above, so C:\Windows
  // becomes C:/Windows.
  const upper = p.toUpperCase();
  if (upper.startsWith("//./") || upper.startsWith("//?/")) return true;
  // Match C:/Windows, D:/Windows, etc.
  if (/^[A-Z]:\/WINDOWS(\/|$)/.test(upper)) return true;
  // Match C:/Program Files, C:/ProgramData (system locations, not user code)
  if (/^[A-Z]:\/(PROGRAM FILES|PROGRAMDATA)(\/|$)/.test(upper)) return true;

  return false;
}

/**
 * Binary file extensions that engram should never attempt to summarize.
 * These would produce garbage summaries (no code structure to extract)
 * and wasting a Read on them is better than corrupting Claude's context.
 */
const BINARY_EXTENSIONS = new Set<string>([
  // Images
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".tiff",
  ".svg",
  // Documents
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  // Archives
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  // Compiled / binary code
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".o",
  ".a",
  ".class",
  ".wasm",
  // Audio / video
  ".mp3",
  ".mp4",
  ".m4a",
  ".wav",
  ".flac",
  ".ogg",
  ".avi",
  ".mov",
  ".mkv",
  ".webm",
  // Data blobs
  ".bin",
  ".dat",
  ".db",
  ".sqlite",
  ".parquet",
  // Fonts
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
  ".eot",
]);

/**
 * Detect likely binary files by extension. Returns true for anything in
 * BINARY_EXTENSIONS. Case-insensitive on the extension.
 *
 * This is a cheap heuristic — it does NOT open the file to check magic
 * bytes. The intent is to skip clearly-binary formats without adding I/O
 * overhead to every hook invocation.
 */
export function isBinaryFile(absPath: string): boolean {
  if (!absPath) return false;
  const dot = absPath.lastIndexOf(".");
  if (dot === -1) return false;
  const ext = absPath.slice(dot).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Detect likely secret files that engram must never summarize into a
 * graph, never surface via an intercept, and never leak into a hook
 * response. The detection is conservative: any match → skip.
 *
 * Patterns match basenames (not full paths) so ".env" works regardless of
 * directory depth.
 */
export function isSecretFile(absPath: string): boolean {
  if (!absPath) return false;
  const idx = Math.max(absPath.lastIndexOf("/"), absPath.lastIndexOf(sep));
  const base = idx === -1 ? absPath : absPath.slice(idx + 1);
  const lower = base.toLowerCase();

  // Dotenv variants
  if (lower === ".env") return true;
  if (lower.startsWith(".env.")) return true;

  // Classic credential / secret names
  if (lower === "secrets.json" || lower === "secrets.yaml" || lower === "secrets.yml") return true;
  if (lower === "credentials" || lower === "credentials.json") return true;
  if (lower === "config.secret.json") return true;

  // Private keys
  if (lower.endsWith(".pem")) return true;
  if (lower.endsWith(".key")) return true;
  if (lower.endsWith(".p12")) return true;
  if (lower.endsWith(".pfx")) return true;
  if (lower.endsWith(".keystore")) return true;

  // SSH / GPG private key material
  if (lower === "id_rsa" || lower === "id_ed25519" || lower === "id_ecdsa" || lower === "id_dsa") {
    return true;
  }

  return false;
}

/**
 * Combined "never intercept this file" check. Returns true if the file
 * is a binary or a likely secret.
 */
export function isContentUnsafeForIntercept(absPath: string): boolean {
  return isBinaryFile(absPath) || isSecretFile(absPath);
}

/**
 * Walk up from a file path to find the nearest directory containing
 * `.engram/graph.db`. Returns the project root (absolute path) or null if
 * no engram-initialized project contains this file.
 *
 * Cached per-invocation to avoid redundant stat() calls.
 *
 * Safety: bounded walk depth (prevents infinite loops on pathological
 * symlink chains) and bounded directory climbs (stops at filesystem root).
 */
export function findProjectRoot(filePath: string): string | null {
  if (!filePath) return null;

  // Start from the file's directory. If filePath is a directory, start from
  // the directory itself. If it doesn't exist, start from its parent.
  let startDir: string;
  try {
    const st = statSync(filePath);
    startDir = st.isDirectory() ? filePath : dirname(filePath);
  } catch {
    // File doesn't exist yet (could be a new file being written). Walk
    // from its parent directory, which must exist.
    startDir = dirname(filePath);
  }

  if (projectRootCache.has(startDir)) {
    return projectRootCache.get(startDir) ?? null;
  }

  let current = startDir;
  let depth = 0;
  while (depth < MAX_WALK_DEPTH) {
    const candidate = join(current, ENGRAM_DIR, GRAPH_FILE);
    try {
      if (existsSync(candidate)) {
        projectRootCache.set(startDir, current);
        return current;
      }
    } catch {
      // Permission denied or similar — treat as "not found here", keep walking.
    }

    const parent = dirname(current);
    if (parent === current) {
      // Reached filesystem root, stop.
      break;
    }
    current = parent;
    depth += 1;
  }

  projectRootCache.set(startDir, null);
  return null;
}

/**
 * Check that `filePath` is actually inside `projectRoot`. Uses realpathSync
 * to resolve symlinks, then string-prefix check. This prevents a symlinked
 * file from being intercepted based on a "fake" location.
 *
 * Returns false if either path can't be resolved (fail-safe: don't intercept).
 */
export function isInsideProject(
  filePath: string,
  projectRoot: string
): boolean {
  if (!filePath || !projectRoot) return false;
  try {
    // Use realpath on the project root so symlinked project roots work.
    // For the file path, use realpath only if it exists — new files won't.
    const realRoot = realpathSync(projectRoot);
    let realFile: string;
    try {
      realFile = realpathSync(filePath);
    } catch {
      // File doesn't exist yet (new file being written). Use the
      // normalized path as a best-effort approximation.
      realFile = resolve(filePath);
    }
    // Ensure the prefix match is on a directory boundary.
    const rootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
    return realFile === realRoot || realFile.startsWith(rootWithSep);
  } catch {
    return false;
  }
}

/**
 * Validate that a cwd string from a hook payload is an absolute path
 * pointing to an existing directory. Used by session-level handlers
 * (SessionStart, UserPromptSubmit, PostToolUse) that trust cwd as the
 * anchor for project detection.
 *
 * Without this guard, a malformed cwd like `"\0garbage"` or an empty
 * string would cause findProjectRoot to walk up from the ambient
 * process cwd (where engram's own source may have a .engram/ dir),
 * hallucinating a project root that isn't what the agent actually
 * intends. Always fail closed on bad cwd.
 */
export function isValidCwd(cwd: string): boolean {
  if (!cwd || typeof cwd !== "string") return false;
  if (!isAbsolute(cwd)) return false;
  try {
    return statSync(cwd).isDirectory();
  } catch {
    return false;
  }
}

/**
 * One-shot helper: given an agent-supplied file path and cwd, perform ALL
 * safety checks needed before querying the graph.
 *
 * Returns an object describing whether the handler should proceed and,
 * if so, the resolved project root.
 *
 * Returning `{ proceed: false }` means "this path cannot be intercepted;
 * exit 0 and let Claude Code handle it normally". Reasons include:
 *   - empty path
 *   - exempt zone (/tmp/, node_modules, etc.)
 *   - no project root found
 *   - file is outside the project root
 */
export function resolveInterceptContext(
  filePath: string,
  cwd: string
): { proceed: true; absPath: string; projectRoot: string } | { proceed: false; reason: string } {
  if (!filePath) return { proceed: false, reason: "empty-path" };

  // Check the raw input BEFORE resolve — path.resolve on macOS strips
  // Windows UNC prefixes (//./COM1 → /COM1), so we'd miss them.
  if (isHardSystemPath(filePath)) {
    return { proceed: false, reason: "system-path" };
  }

  const absPath = normalizePath(filePath, cwd);
  if (!absPath) return { proceed: false, reason: "normalize-failed" };

  // Also check the resolved form (catches cases where resolve produces
  // a system path from relative input, e.g. cwd is /dev/).
  if (isHardSystemPath(absPath)) {
    return { proceed: false, reason: "system-path" };
  }

  // Find a project root. If none exists, the path is "free" — including
  // ephemeral files in /tmp/ that aren't inside any engram project. This
  // is how scratch files naturally get exempted.
  const projectRoot = findProjectRoot(absPath);
  if (projectRoot === null) {
    return { proceed: false, reason: "no-project-root" };
  }

  if (!isInsideProject(absPath, projectRoot)) {
    return { proceed: false, reason: "outside-project" };
  }

  // Project-internal ignored zones (node_modules, .git, .engram/cache).
  // Only checked inside a detected project, since these patterns are
  // project-relative.
  if (isExemptPath(absPath)) {
    return { proceed: false, reason: "exempt-path" };
  }

  return { proceed: true, absPath, projectRoot };
}
