/**
 * git-miner tests. Hermetic — each test spins up its own temp git repo with
 * mkdtempSync, makes multi-file commits, and runs mineGitHistory over them.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { mineGitHistory } from "../../src/miners/git-miner.js";

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "engram-git-miner-"));
  const raw = (...args: string[]): string =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf-8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.com",
      },
    }).trim();
  raw("init", "-q");
  raw("config", "commit.gpgsign", "false");
  raw("config", "user.name", "Test");
  raw("config", "user.email", "test@example.com");
  return {
    root,
    commitMany(files: Record<string, string>, message: string): void {
      for (const [f, c] of Object.entries(files)) {
        const abs = join(root, f);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, c);
        raw("add", f);
      }
      raw("commit", "-q", "-m", message);
    },
  };
}

describe("mineGitHistory", () => {
  let repo: ReturnType<typeof makeRepo>;
  beforeEach(() => {
    repo = makeRepo();
  });
  afterEach(() => {
    rmSync(repo.root, { recursive: true, force: true });
  });

  it("never emits a self co-change edge for distinct files sharing a basename stem", () => {
    // src/index.ts and lib/index.ts both reduce to the stem "index"; the bug
    // collapsed them to one node id and emitted a file "co-changing with itself".
    for (let i = 0; i < 4; i++) {
      repo.commitMany(
        { "src/index.ts": `export const a = ${i};\n`, "lib/index.ts": `export const b = ${i};\n` },
        `change ${i}`
      );
    }
    const { edges } = mineGitHistory(repo.root);
    expect(edges.filter((e) => e.source === e.target)).toEqual([]);
  });

  it("emits a co-change edge for genuinely distinct files that change together", () => {
    for (let i = 0; i < 4; i++) {
      repo.commitMany(
        { "auth.ts": `export const a = ${i};\n`, "session.ts": `export const b = ${i};\n` },
        `change ${i}`
      );
    }
    const { edges } = mineGitHistory(repo.root);
    expect(edges.some((e) => e.relation === "depends_on" && e.source !== e.target)).toBe(true);
  });

  it("returns an empty result for a non-git directory (no throw)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "engram-nongit-"));
    try {
      const r = mineGitHistory(tmp);
      expect(r.nodes).toEqual([]);
      expect(r.edges).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
