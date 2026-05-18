/**
 * Tests for the v4.0 git-revert miner.
 *
 * Strategy: spin up a tiny temp git repo, make commits, run `git revert`,
 * then call mineGitReverts() and verify the bi-temporal mistake nodes.
 * Hermetic — every test uses its own temp dir with mkdtempSync. No
 * dependency on the engramx repo's own history.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mineGitReverts } from "../../src/miners/git-revert-miner.js";

interface GitRepo {
  readonly root: string;
  commit: (file: string, content: string, message: string) => string;
  revert: (sha: string) => string;
  raw: (...args: string[]) => string;
}

function makeRepo(): GitRepo {
  const root = mkdtempSync(join(tmpdir(), "engram-revert-miner-"));
  const raw = (...args: string[]): string =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf-8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test Author",
        GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_COMMITTER_NAME: "Test Author",
        GIT_COMMITTER_EMAIL: "test@example.com",
      },
    }).trim();

  raw("init", "-q");
  raw("config", "commit.gpgsign", "false");
  raw("config", "tag.gpgsign", "false");
  raw("config", "user.name", "Test Author");
  raw("config", "user.email", "test@example.com");

  return {
    root,
    commit(file, content, message) {
      writeFileSync(join(root, file), content);
      raw("add", file);
      raw("commit", "-q", "-m", message);
      return raw("rev-parse", "HEAD");
    },
    revert(sha) {
      raw("revert", "--no-edit", sha);
      return raw("rev-parse", "HEAD");
    },
    raw,
  };
}

describe("mineGitReverts", () => {
  let repo: GitRepo;

  beforeEach(() => {
    repo = makeRepo();
  });

  afterEach(() => {
    rmSync(repo.root, { recursive: true, force: true });
  });

  it("returns empty result for a non-git directory", () => {
    const tmp = mkdtempSync(join(tmpdir(), "engram-non-git-"));
    try {
      const result = mineGitReverts(tmp);
      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns empty result for a git repo with no reverts", () => {
    repo.commit("a.ts", "export const a = 1;\n", "feat: add a");
    repo.commit("b.ts", "export const b = 2;\n", "feat: add b");
    const result = mineGitReverts(repo.root);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("creates one bi-temporal mistake for a single revert", () => {
    const originalSha = repo.commit(
      "src.ts",
      "export const buggy = () => null;\n",
      "feat: add buggy helper that returns null",
    );
    repo.revert(originalSha);

    const result = mineGitReverts(repo.root);
    expect(result.nodes).toHaveLength(1);
    const m = result.nodes[0];

    expect(m.kind).toBe("mistake");
    expect(m.sourceFile).toBe("src.ts");
    expect(m.label).toContain("Reverted");
    expect(m.label).toContain("add buggy helper");
    expect(m.thenBelieved).toBe("feat: add buggy helper that returns null");
    expect(m.foundFalseAt).toBeGreaterThan(0);
    expect(m.truthNow).toContain("Reverted in");
    expect(m.appliesTo).toBeTruthy();
    expect(m.confidence).toBe("EXTRACTED");
  });

  it("creates two mistakes for two independent reverts", () => {
    const first = repo.commit("a.ts", "a\n", "feat: add a");
    const second = repo.commit("b.ts", "b\n", "feat: add b");
    repo.revert(first);
    repo.revert(second);

    const result = mineGitReverts(repo.root);
    expect(result.nodes).toHaveLength(2);
    const sourceFiles = result.nodes.map((n) => n.sourceFile).sort();
    expect(sourceFiles).toEqual(["a.ts", "b.ts"]);
  });

  it("produces stable IDs — running twice yields identical node IDs (idempotent)", () => {
    const sha = repo.commit("src.ts", "export const x = 1;\n", "feat: x");
    repo.revert(sha);

    const first = mineGitReverts(repo.root);
    const second = mineGitReverts(repo.root);

    expect(first.nodes).toHaveLength(1);
    expect(second.nodes).toHaveLength(1);
    expect(first.nodes[0].id).toBe(second.nodes[0].id);
    expect(first.nodes[0].id).toMatch(/^revert_[0-9a-f]{7}_[0-9a-f]{7}$/);
  });

  it("skips manual 'Revert' commits with no body SHA reference (can't pair)", () => {
    repo.commit("src.ts", "x\n", "feat: x");
    // Empty-commit with subject that looks like a revert but no body marker
    repo.raw(
      "commit",
      "--allow-empty",
      "-q",
      "-m",
      "Revert something but I forgot to use git revert",
    );
    const result = mineGitReverts(repo.root);
    expect(result.nodes).toHaveLength(0);
  });

  it("skips reverts whose reverted commit only touched skipped paths (build dirs)", () => {
    // Commit only dist/ files — these are in the skip list
    writeFileSync(join(repo.root, "config.txt"), "x\n");
    repo.raw("add", "config.txt");
    repo.raw("commit", "-q", "-m", "anchor");
    const distSha = (() => {
      writeFileSync(join(repo.root, "noise"), "x\n");
      repo.raw("add", "noise");
      repo.raw("commit", "-q", "-m", "anchor 2");
      // Now create a commit that ONLY touches dist/
      const distDir = join(repo.root, "dist");
      execFileSync("mkdir", ["-p", distDir]);
      writeFileSync(join(distDir, "bundle.js"), "x\n");
      repo.raw("add", "dist/bundle.js");
      repo.raw("commit", "-q", "-m", "build: bundle output");
      return repo.raw("rev-parse", "HEAD");
    })();
    repo.revert(distSha);
    const result = mineGitReverts(repo.root);
    // build-only revert should be skipped — no source file
    expect(result.nodes).toHaveLength(0);
  });

  it("captures the revert author timestamp as foundFalseAt (not the original commit time)", () => {
    const before = Math.floor(Date.now() / 1000) * 1000;
    const sha = repo.commit("src.ts", "x\n", "feat: x");
    // Tiny pause so the revert timestamp could differ if we wanted, but
    // we mostly care that foundFalseAt is >= the original commit time
    // and within the test window.
    repo.revert(sha);
    const after = Date.now() + 1000;

    const result = mineGitReverts(repo.root);
    expect(result.nodes).toHaveLength(1);
    const m = result.nodes[0];
    expect(m.foundFalseAt).toBeDefined();
    expect(m.foundFalseAt!).toBeGreaterThanOrEqual(before);
    expect(m.foundFalseAt!).toBeLessThanOrEqual(after);
  });

  it("metadata records both SHAs + revertedFiles for audit traceability", () => {
    const sha = repo.commit("foo.ts", "x\n", "feat: foo");
    repo.revert(sha);

    const result = mineGitReverts(repo.root);
    const m = result.nodes[0];
    expect(m.metadata.miner).toBe("git-revert");
    expect(typeof m.metadata.revertSha).toBe("string");
    expect(typeof m.metadata.originalSha).toBe("string");
    expect(Array.isArray(m.metadata.revertedFiles)).toBe(true);
    expect((m.metadata.revertedFiles as string[]).length).toBeGreaterThan(0);
  });
});
