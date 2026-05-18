/**
 * Git revert miner (v4.0) — extracts bi-temporal mistakes from revert commits.
 *
 * A `git revert <sha>` produces a commit whose subject starts with "Revert "
 * and whose body typically contains "This reverts commit <sha>." (the
 * standard git template). When we detect such a commit, we pair it with the
 * reverted commit to capture a bi-temporal mistake:
 *
 *   thenBelieved   — the reverted commit's subject (the belief at the time)
 *   foundFalseAt   — the revert commit's author timestamp (unix ms)
 *   truthNow       — "Reverted in <revertSha>" + revert author
 *   appliesTo      — short label derived from files changed in the revert
 *   sourceFile     — primary file the revert touches
 *
 * Idempotent: stable IDs derived from revert-SHA + original-SHA, so
 * re-running on the same repo overwrites in place rather than duplicating.
 *
 * Performance: one `git log` call + one `git show` per detected revert pair.
 * Bounded by maxCommits (default 200) and the revert frequency.
 *
 * Safety: every git invocation is wrapped in try/catch; missing or
 * non-git directories return zero results silently. The miner never throws.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { GraphEdge, GraphNode } from "../graph/schema.js";

interface GitMineResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Spawn `git <args>` in `cwd`, return stdout or empty string on error. */
function runGit(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 15000,
    }).trim();
  } catch {
    return "";
  }
}

/** Extract a SHA from a "This reverts commit X" line in a commit body. */
function parseRevertedSha(body: string): string | null {
  const m = body.match(/This reverts commit\s+([0-9a-f]{7,40})/i);
  return m ? m[1] : null;
}

/** Strip the standard `Revert "..."` wrapper to recover the original subject. */
function unwrapRevertSubject(subject: string): string {
  // git's default revert subject is `Revert "<original-subject>"`
  const m = subject.match(/^Revert\s+"(.+)"\s*$/i);
  return m ? m[1] : subject.replace(/^Revert\s+/i, "");
}

interface CommitMeta {
  sha: string;
  subject: string;
  author: string;
  unixMs: number;
}

/** Fetch one commit's metadata. Returns null if the SHA isn't reachable. */
function fetchCommitMeta(sha: string, cwd: string): CommitMeta | null {
  const out = runGit(
    ["show", "--no-patch", "--pretty=format:%H|%an|%at|%s", sha],
    cwd,
  );
  if (!out) return null;
  const parts = out.split("|");
  if (parts.length < 4) return null;
  const [fullSha, author, atSecs] = parts;
  const subject = parts.slice(3).join("|");
  const unixMs = Number(atSecs) * 1000;
  if (!Number.isFinite(unixMs) || unixMs <= 0) return null;
  return { sha: fullSha, subject, author, unixMs };
}

/** First non-empty source-ish file changed in a commit, or empty string. */
function fetchPrimaryFile(sha: string, cwd: string): string {
  const out = runGit(
    ["show", "--name-only", "--pretty=format:", sha],
    cwd,
  );
  if (!out) return "";
  const SKIP_PREFIXES = ["dist/", "build/", "node_modules/", "coverage/", ".github/"];
  const candidates = out
    .split("\n")
    .map((s) => s.trim())
    .filter(
      (f) =>
        f.length > 0 &&
        f.includes(".") &&
        !SKIP_PREFIXES.some((p) => f.startsWith(p)),
    );
  return candidates[0] ?? "";
}

/** Derive a short pattern label from a list of changed files. */
function derivePattern(files: readonly string[]): string {
  if (files.length === 0) return "git revert";
  // Use the deepest common directory as the pattern hint, falling back to
  // the first file's basename without extension.
  const dirs = files.map((f) => f.split("/").slice(0, -1).join("/"));
  const commonDir = dirs.every((d) => d === dirs[0]) ? dirs[0] : "";
  if (commonDir) return `git revert in ${commonDir}/`;
  const first = files[0] ?? "";
  const stem = first.split("/").pop()?.replace(/\.[^.]+$/, "") ?? first;
  return `git revert touching ${stem}`;
}

/** All non-skipped files touched by a commit. */
function fetchAllFiles(sha: string, cwd: string): string[] {
  const out = runGit(["show", "--name-only", "--pretty=format:", sha], cwd);
  if (!out) return [];
  const SKIP_PREFIXES = ["dist/", "build/", "node_modules/", "coverage/", ".github/"];
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(
      (f) =>
        f.length > 0 &&
        f.includes(".") &&
        !SKIP_PREFIXES.some((p) => f.startsWith(p)),
    );
}

/**
 * Mine recent git history for revert pairs and emit bi-temporal mistakes.
 *
 * Returns `{ nodes, edges }` matching the standard miner contract. Edges is
 * always empty — reverts don't produce graph edges in v4.0 (deferred to
 * a future "decision_invalidated_by" edge in v4.2).
 */
export function mineGitReverts(
  projectRoot: string,
  maxCommits = 200,
): GitMineResult {
  const root = resolve(projectRoot);
  const nodes: GraphNode[] = [];

  // Bail if this isn't a git repository.
  if (!runGit(["rev-parse", "--git-dir"], root)) {
    return { nodes, edges: [] };
  }

  // Get recent commits with subject + body. Use null-byte separator (%x00)
  // between commits so multi-line bodies don't break parsing on \n\n.
  const log = runGit(
    [
      "log",
      `--max-count=${maxCommits}`,
      "--pretty=format:%H%x1f%at%x1f%s%x1f%b%x00",
    ],
    root,
  );
  if (!log) return { nodes, edges: [] };

  const blocks = log.split("\x00").filter((b) => b.trim().length > 0);

  for (const block of blocks) {
    const parts = block.split("\x1f");
    if (parts.length < 4) continue;
    const revertSha = parts[0].trim();
    const revertSecs = Number(parts[1]);
    const revertSubject = parts[2];
    const revertBody = parts[3];

    if (!revertSha || !Number.isFinite(revertSecs)) continue;

    // Detect a revert: subject prefix OR body marker. Subject-only matches
    // (manual /^Revert/ commits without a SHA pointer) are skipped because
    // we can't pair them with an original commit.
    const looksLikeRevert =
      /^revert\b/i.test(revertSubject.trim()) ||
      /This reverts commit\s+[0-9a-f]{7,40}/i.test(revertBody);
    if (!looksLikeRevert) continue;

    const originalShaCandidate = parseRevertedSha(revertBody);
    if (!originalShaCandidate) continue;

    const original = fetchCommitMeta(originalShaCandidate, root);
    if (!original) continue;

    const allFiles = fetchAllFiles(original.sha, root);
    const primaryFile = fetchPrimaryFile(original.sha, root) || primaryFromList(allFiles);
    if (!primaryFile) continue; // No source file changed — skip (likely docs-only)

    const revertShort = revertSha.slice(0, 7);
    const originalShort = original.sha.slice(0, 7);

    nodes.push({
      id: `revert_${revertShort}_${originalShort}`,
      label: `Reverted: ${unwrapRevertSubject(original.subject)}`.slice(0, 120),
      kind: "mistake",
      sourceFile: primaryFile,
      sourceLocation: null,
      confidence: "EXTRACTED",
      confidenceScore: 0.9,
      lastVerified: revertSecs * 1000,
      queryCount: 0,
      metadata: {
        miner: "git-revert",
        revertSha,
        originalSha: original.sha,
        originalAuthor: original.author,
        revertedFiles: allFiles.slice(0, 10),
      },
      thenBelieved: unwrapRevertSubject(original.subject),
      foundFalseAt: revertSecs * 1000,
      truthNow: `Reverted in ${revertShort} (${new Date(revertSecs * 1000)
        .toISOString()
        .slice(0, 10)})`,
      appliesTo: derivePattern(allFiles),
    });
  }

  return { nodes, edges: [] };
}

/** Helper — pick the first source-ish file from a pre-fetched list. */
function primaryFromList(files: readonly string[]): string {
  return files.find((f) => /\.(ts|tsx|js|jsx|py|rb|go|rs|java|c|cpp|cs|php)$/.test(f)) ?? files[0] ?? "";
}
