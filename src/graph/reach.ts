/**
 * reach.ts — path-based candidate reach for the context resolver.
 *
 * The call/import graph is rich on call-graph-dense repos but SPARSE on app-style
 * repos (handlers, components, configs that barely call each other). Measured: the
 * ranker lifts recall ~+5.6pp on engram's own repo but ~0 on app repos — because
 * few relevant files even become candidates. These path-based sources add reach
 * that GENERALIZES to every repo: related files cluster in directories, and tests
 * sit beside their implementations.
 *
 * Pure + dependency-free. Whether these candidates actually raise recall is MEASURED
 * by the recall-coverage benchmark before they ship to the product (build-and-
 * measure; no recall % is ever claimed without data — W1.9).
 */

/** Directory of a POSIX path ("" for a top-level file). */
export function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/**
 * Files in the SAME directory as `file` (excluding itself). The highest-signal
 * path-based reach on app repos — related code clusters in directories.
 */
export function sameDirSiblings(file: string, allFiles: readonly string[]): string[] {
  const dir = dirOf(file);
  const out: string[] = [];
  for (const f of allFiles) {
    if (f !== file && dirOf(f) === dir) out.push(f);
  }
  return out;
}

/** Matches a test/spec file by its filename suffix. */
const TEST_SUFFIX_RE = /\.(test|spec)\.[cm]?[jt]sx?$/i;

/** Reduce a path to a comparable base key: filename minus any test/spec marker and
 *  extension. `src/foo.ts` and `tests/foo.test.ts` both → `foo`. */
function baseKey(path: string): string {
  const file = path.slice(path.lastIndexOf("/") + 1);
  return file
    .replace(/\.(test|spec)\./i, ".") // drop the test/spec marker
    .replace(/\.[cm]?[jt]sx?$/i, ""); // drop the extension
}

/**
 * Test↔impl counterparts: files sharing the same base filename but OPPOSITE
 * test-ness (an impl's test, or a test's impl). `foo.ts` ↔ `foo.test.ts`,
 * `src/auth.ts` ↔ `tests/auth.spec.ts`. Generalizes to any repo that co-locates
 * or mirror-locates tests.
 */
export function testImplCounterparts(file: string, allFiles: readonly string[]): string[] {
  const fileIsTest = TEST_SUFFIX_RE.test(file);
  const key = baseKey(file);
  const out: string[] = [];
  for (const f of allFiles) {
    if (f === file) continue;
    if (TEST_SUFFIX_RE.test(f) === fileIsTest) continue; // need the opposite test-ness
    if (baseKey(f) === key) out.push(f);
  }
  return out;
}

/**
 * The union of path-based reach for a file: same-dir siblings + test↔impl
 * counterparts, de-duplicated, excluding the file itself. The caller ranks +
 * budget-trims this (Phase A), so breadth here is safe.
 */
export function pathReach(file: string, allFiles: readonly string[]): string[] {
  const set = new Set<string>();
  for (const f of sameDirSiblings(file, allFiles)) set.add(f);
  for (const f of testImplCounterparts(file, allFiles)) set.add(f);
  set.delete(file);
  return [...set];
}
