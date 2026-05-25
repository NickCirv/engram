import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { mineGitHistory } from "../src/miners/git-miner.js";

describe("git-miner", () => {
  it("caps co-change edges at MAX_FILES_PER_COMMIT (50) for large commits", () => {
    const tmpDir = mkdtempSync(join(os.tmpdir(), "engram-cap-"));
    const gitDir = join(tmpDir, "repo");
    mkdirSync(gitDir, { recursive: true });

    execSync("git init", { cwd: gitDir });
    execSync("git config user.email test@test.com", { cwd: gitDir });
    execSync("git config user.name Test", { cwd: gitDir });

    // Create 51 files and commit them all together
    for (let i = 1; i <= 51; i++) {
      writeFileSync(join(gitDir, `file${i}.ts`), `export const x${i} = ${i};\n`);
    }

    execSync("git add .", { cwd: gitDir });
    execSync("git commit -m 'bulk: add 51 files'", { cwd: gitDir });

    const result = mineGitHistory(gitDir);

    // MAX_FILES_PER_COMMIT = 50 → files beyond limit are ignored
    // With only 1 commit, no pair reaches the threshold of 3 co-changes
    const coChangeEdges = result.edges.filter(
      (e) => e.metadata?.coChangeCount !== undefined
    );
    expect(coChangeEdges.length).toBe(0);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("handles commit with exactly MAX_FILES_PER_COMMIT (50) files", () => {
    const tmpDir = mkdtempSync(join(os.tmpdir(), "engram-max-"));
    const gitDir = join(tmpDir, "repo");
    mkdirSync(gitDir, { recursive: true });

    execSync("git init", { cwd: gitDir });
    execSync("git config user.email test@test.com", { cwd: gitDir });
    execSync("git config user.name Test", { cwd: gitDir });

    for (let i = 1; i <= 50; i++) {
      writeFileSync(join(gitDir, `f${i}.ts`), `const v${i} = ${i};\n`);
    }

    execSync("git add .", { cwd: gitDir });
    execSync("git commit -m 'max files commit'", { cwd: gitDir });

    const result = mineGitHistory(gitDir);

    // 50 files at count=1 → no edges (threshold is 3)
    const coChangeEdges = result.edges.filter(
      (e) => e.metadata?.coChangeCount !== undefined
    );
    expect(coChangeEdges.length).toBe(0);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates edges when files co-change 3+ times", () => {
    const tmpDir = mkdtempSync(join(os.tmpdir(), "engram-edge-"));
    const gitDir = join(tmpDir, "repo");
    mkdirSync(gitDir, { recursive: true });

    execSync("git init", { cwd: gitDir });
    execSync("git config user.email test@test.com", { cwd: gitDir });
    execSync("git config user.name Test", { cwd: gitDir });

    // Create 10 files
    for (let i = 1; i <= 10; i++) {
      writeFileSync(join(gitDir, `lib${i}.ts`), "export function fn() {}\n");
    }

    // Commit all files together 3 times (modify ALL files each time)
    for (let commit = 1; commit <= 3; commit++) {
      // Update ALL files to ensure they're included in every commit
      for (let i = 1; i <= 10; i++) {
        writeFileSync(join(gitDir, `lib${i}.ts`), `// commit ${commit}\nexport function fn${i}() {}\n`);
      }
      execSync("git add .", { cwd: gitDir });
      execSync(`git commit -m 'chore: update all libs ${commit}'`, { cwd: gitDir });
    }

    const result = mineGitHistory(gitDir);

    // 10 files at count=3 → C(10,2) = 45 edges
    const coChangeEdges = result.edges.filter(
      (e) => e.metadata?.coChangeCount === 3
    );
    expect(coChangeEdges.length).toBe(45);
    expect(coChangeEdges.every((e) => e.confidenceScore > 0.5)).toBe(true);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips build/dist/node_modules prefixes", () => {
    const tmpDir = mkdtempSync(join(os.tmpdir(), "engram-skip-"));
    const gitDir = join(tmpDir, "repo");
    mkdirSync(gitDir, { recursive: true });

    execSync("git init", { cwd: gitDir });
    execSync("git config user.email test@test.com", { cwd: gitDir });
    execSync("git config user.name Test", { cwd: gitDir });

    mkdirSync(join(gitDir, "src"), { recursive: true });
    writeFileSync(join(gitDir, "src/a.ts"), "export const a = 1;\n");
    mkdirSync(join(gitDir, "dist"), { recursive: true });
    writeFileSync(join(gitDir, "dist/bundle.js"), "// generated");
    mkdirSync(join(gitDir, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(gitDir, "node_modules", "pkg", "index.js"), "// dep");

    execSync("git add .", { cwd: gitDir });
    execSync("git commit -m 'with build artifacts'", { cwd: gitDir });

    const result = mineGitHistory(gitDir);

    // Only src/a.ts should appear in the graph
    const nodeLabels = result.nodes.map((n) => n.label);
    expect(nodeLabels.some((l) => l.includes("dist"))).toBe(false);
    expect(nodeLabels.some((l) => l.includes("node_modules"))).toBe(false);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});