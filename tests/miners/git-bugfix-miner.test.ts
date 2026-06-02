/**
 * Tests for the git bug-fix miner (Fix #2 — day-1 mistakes).
 *
 * Hermetic: each test spins up its own temp git repo, makes commits, then
 * runs mineBugFixCommits(). No dependency on engramx's own history.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import {
  mineBugFixCommits,
  looksLikeBugFix,
} from "../../src/miners/git-bugfix-miner.js";

describe("looksLikeBugFix (pure)", () => {
  it("matches conventional-commit fix prefixes", () => {
    expect(looksLikeBugFix("fix: handle null deref", "")).toBe(true);
    expect(looksLikeBugFix("fix(auth): stale token", "")).toBe(true);
    expect(looksLikeBugFix("bugfix: off-by-one", "")).toBe(true);
    expect(looksLikeBugFix("hotfix!: prod crash", "")).toBe(true);
  });
  it("matches issue-closing fix language", () => {
    expect(looksLikeBugFix("resolve crash", "fixes #123")).toBe(true);
    expect(looksLikeBugFix("closes #45", "")).toBe(true);
  });
  it("does NOT match non-fixes, reverts, or autosquash", () => {
    expect(looksLikeBugFix("feat: add dashboard", "")).toBe(false);
    expect(looksLikeBugFix("docs: update readme", "")).toBe(false);
    expect(looksLikeBugFix('Revert "fix: x"', "This reverts commit abc1234")).toBe(false);
    expect(looksLikeBugFix("fixup! wip", "")).toBe(false);
    expect(looksLikeBugFix("prefix: not a fix", "")).toBe(false);
    expect(looksLikeBugFix("fixture setup", "")).toBe(false);
  });
});

describe("mineBugFixCommits (git integration)", () => {
  let root: string;
  const raw = (...args: string[]): string =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf-8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "T",
        GIT_AUTHOR_EMAIL: "t@e.com",
        GIT_COMMITTER_NAME: "T",
        GIT_COMMITTER_EMAIL: "t@e.com",
      },
    }).trim();
  const commit = (file: string, content: string, message: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
    raw("add", file);
    raw("commit", "-q", "-m", message);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "engram-bugfix-miner-"));
    raw("init", "-q");
    raw("config", "commit.gpgsign", "false");
    raw("config", "user.name", "T");
    raw("config", "user.email", "t@e.com");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("emits an INFERRED mistake node for a bug-fix commit touching source", () => {
    commit("src/auth.ts", "export const x = 1;\n", "fix: stale token in auth");
    const { nodes } = mineBugFixCommits(root);
    expect(nodes.length).toBe(1);
    const n = nodes[0];
    expect(n.kind).toBe("mistake");
    expect(n.confidenceScore).toBe(0.6);
    expect(n.confidence).toBe("INFERRED");
    expect(n.sourceFile).toBe("src/auth.ts");
    expect(n.metadata?.miner).toBe("git-bugfix");
    expect(n.label).toContain("fix: stale token in auth");
  });

  it("ignores non-fix commits", () => {
    commit("src/a.ts", "export const a = 1;\n", "feat: add a");
    expect(mineBugFixCommits(root).nodes.length).toBe(0);
  });

  it("ignores docs-only fixes (no source file)", () => {
    commit("README.md", "# hi\n", "fix: typo in readme");
    expect(mineBugFixCommits(root).nodes.length).toBe(0);
  });

  it("returns [] on a non-git directory", () => {
    const nogit = mkdtempSync(join(tmpdir(), "engram-nogit-"));
    try {
      expect(mineBugFixCommits(nogit).nodes.length).toBe(0);
    } finally {
      rmSync(nogit, { recursive: true, force: true });
    }
  });
});
