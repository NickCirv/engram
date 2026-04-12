/**
 * Path normalization helpers for the graph.
 *
 * The graph stores `sourceFile` as a project-relative path. For the graph
 * to be portable across machines and for lookups to be consistent, paths
 * MUST be stored in POSIX form (forward slashes) regardless of the host
 * OS. This module is the single source of truth for that normalization.
 */

/**
 * Convert any path (native or POSIX) to POSIX form by replacing backslash
 * separators with forward slashes. On POSIX this is a no-op. On Windows
 * this collapses `src\auth.ts` to `src/auth.ts`.
 *
 * Does NOT touch the path content otherwise — no `..` collapsing, no
 * case folding, no drive-letter rewriting. Callers that need absolute
 * resolution should call `path.resolve()` first, then this.
 */
export function toPosixPath(p: string): string {
  if (!p) return p;
  return p.replace(/\\/g, "/");
}
