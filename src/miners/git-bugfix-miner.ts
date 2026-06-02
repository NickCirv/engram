/**
 * Git bug-fix miner (v4.x) — seeds mistake-memory from bug-fix commits so a
 * FRESH `engram init` surfaces real, useful "this file had a bug here"
 * landmines on day one — not the near-empty table the revert miner alone
 * produces (explicit `git revert` is rare; bug-fix commits are everywhere).
 *
 * Detection (conservative, to keep false-positives low):
 *   - Conventional-commit fix prefix:  fix: / fix(scope): / bugfix: / hotfix:
 *   - Issue-closing fixes:             "fixes #123", "closes #45", "resolves #7"
 *   Excludes reverts (the revert miner owns those) and `fixup!` autosquash
 *   commits (not real fixes).
 *
 * These are LOWER-confidence than reverts (a revert explicitly says "this was
 * wrong"; a fix just says "there was a bug here"). They are emitted at
 * confidenceScore 0.6 / "INFERRED" so they:
 *   - surface in `engram mistakes` and the init count (the day-1 wow), but
 *   - do NOT fire the proactive PreToolUse warning (which applies a
 *     confidence floor) — so we add value without adding nag-spam.
 *
 * Idempotent: stable id `bugfix_<sha7>`; re-running overwrites in place.
 * Safety: every git call is wrapped; non-git dirs return [] silently; never
 * throws.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { GraphEdge, GraphNode } from "../graph/schema.js";

interface GitMineResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const SKIP_PREFIXES = ["dist/", "build/", "node_modules/", "coverage/", ".github/"];

/** Spawn `git <args>` in `cwd`; stdout or "" on any error. */
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

/** First source-ish file changed in a commit (skips build/vendor dirs), or "". */
function fetchPrimaryFile(sha: string, cwd: string): string {
  const out = runGit(["show", "--name-only", "--pretty=format:", sha], cwd);
  if (!out) return "";
  const candidates = out
    .split("\n")
    .map((s) => s.trim())
    .filter(
      (f) =>
        f.length > 0 &&
        f.includes(".") &&
        !SKIP_PREFIXES.some((p) => f.startsWith(p))
    );
  // Require a real source file — a docs-only fix (e.g. "fix: typo in readme")
  // is not a code landmine, so return "" and let the caller skip it.
  return (
    candidates.find((f) =>
      /\.(ts|tsx|js|jsx|py|rb|go|rs|java|kt|c|cpp|cc|cs|php|swift|scala)$/.test(f)
    ) ?? ""
  );
}

/**
 * True if a commit subject/body describes a bug fix (and is not a revert or
 * an autosquash fixup commit).
 */
export function looksLikeBugFix(subject: string, body: string): boolean {
  const s = subject.trim();
  if (/^revert\b/i.test(s)) return false; // revert miner owns these
  if (/^(fixup|squash)!/i.test(s)) return false; // autosquash, not a fix
  // Conventional-commit fix prefix.
  if (/^(fix|bugfix|hotfix)(\([^)]+\))?!?:\s/i.test(s)) return true;
  // Issue-closing fix language (subject or body).
  if (/\b(fix(es|ed)?|close[sd]?|resolve[sd]?)\s+#\d+/i.test(`${s}\n${body}`)) {
    return true;
  }
  return false;
}

/**
 * Mine recent history for bug-fix commits and emit INFERRED mistake nodes.
 * Returns the standard `{ nodes, edges }` contract (edges always empty).
 */
export function mineBugFixCommits(
  projectRoot: string,
  maxCommits = 300
): GitMineResult {
  const root = resolve(projectRoot);
  const nodes: GraphNode[] = [];

  if (!runGit(["rev-parse", "--git-dir"], root)) {
    return { nodes, edges: [] };
  }

  const log = runGit(
    ["log", `--max-count=${maxCommits}`, "--pretty=format:%H%x1f%at%x1f%s%x1f%b%x00"],
    root
  );
  if (!log) return { nodes, edges: [] };

  const blocks = log.split("\x00").filter((b) => b.trim().length > 0);

  for (const block of blocks) {
    const parts = block.split("\x1f");
    if (parts.length < 4) continue;
    const sha = parts[0].trim();
    const secs = Number(parts[1]);
    const subject = parts[2] ?? "";
    const body = parts[3] ?? "";
    if (!sha || !Number.isFinite(secs)) continue;

    if (!looksLikeBugFix(subject, body)) continue;

    const primaryFile = fetchPrimaryFile(sha, root);
    if (!primaryFile) continue; // docs-only / no source file — skip

    const short = sha.slice(0, 7);
    nodes.push({
      id: `bugfix_${short}`,
      label: `Bug fixed here: ${subject}`.slice(0, 120),
      kind: "mistake",
      sourceFile: primaryFile,
      sourceLocation: null,
      confidence: "INFERRED",
      confidenceScore: 0.6,
      lastVerified: secs * 1000,
      queryCount: 0,
      metadata: {
        miner: "git-bugfix",
        fixSha: sha,
        fixDate: new Date(secs * 1000).toISOString().slice(0, 10),
      },
    });
  }

  return { nodes, edges: [] };
}
