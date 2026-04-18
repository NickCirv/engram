/**
 * Tests for the file watcher — incremental re-indexing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  renameSync,
  existsSync,
  mkdtempSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { init, getStore } from "../src/core.js";
import {
  watchProject,
  formatReindexLine,
  runReindexHook,
  type SyncResult,
} from "../src/watcher.js";

// fileURLToPath is required on Windows — `new URL(...).pathname` returns
// `/C:/Users/...` which then gets a second drive letter prepended by
// resolve(), producing `C:\C:\Users\...` and an ENOENT.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI_PATH = join(REPO_ROOT, "dist", "cli.js");

function runReindexCli(
  args: string[],
  cwd: string
): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync("node", [CLI_PATH, "reindex", ...args], {
    cwd,
    encoding: "utf-8",
    timeout: 15_000,
  });
  return {
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    status: r.status,
  };
}

function runReindexCliAsync(
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; status: number | null }> {
  return new Promise((resolve) => {
    const child = spawn("node", [CLI_PATH, "reindex", ...args], { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("close", (code) => resolve({ stdout, stderr, status: code }));
  });
}

const rootDir = join(tmpdir(), `engram-watcher-test-${Date.now()}`);
const projectRoot = join(rootDir, "watchtest");
const srcDir = join(projectRoot, "src");

beforeAll(async () => {
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(
    join(srcDir, "main.ts"),
    'export function greet() { return "hello"; }\n'
  );
  await init(projectRoot);
});

afterAll(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

describe("watchProject", () => {
  it("requires an initialized project", () => {
    const emptyDir = join(rootDir, "empty-watch");
    mkdirSync(emptyDir, { recursive: true });
    expect(() => watchProject(emptyDir)).toThrow("no graph found");
  });

  it("starts and can be aborted", async () => {
    const controller = watchProject(projectRoot, {
      onReady: () => {},
    });
    expect(controller).toBeDefined();
    expect(controller instanceof AbortController).toBe(true);
    controller.abort();
  });

  it("detects file changes and re-indexes", async () => {
    const reindexed: string[] = [];
    const controller = watchProject(projectRoot, {
      onReindex: (filePath, nodeCount) => {
        reindexed.push(filePath);
      },
    });

    // Small delay to let the watcher fully initialize before writing.
    await new Promise((r) => setTimeout(r, 200));

    // Write a new file
    writeFileSync(
      join(srcDir, "helper.ts"),
      'export function add(a: number, b: number) { return a + b; }\n'
    );

    // Poll-based wait — retry assertion until success or hard timeout.
    // fs.watch timing varies across platforms and CI environments.
    const deadline = Date.now() + 5000;
    while (reindexed.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
    }

    controller.abort();

    // Check that the file was re-indexed
    expect(reindexed).toContain("src/helper.ts");

    // Verify the node exists in the graph
    const store = await getStore(projectRoot);
    try {
      const nodes = store.getAllNodes();
      const helperNodes = nodes.filter(
        (n) => n.sourceFile === "src/helper.ts"
      );
      expect(helperNodes.length).toBeGreaterThan(0);
    } finally {
      store.close();
    }
  });

  it("ignores node_modules and .git changes", async () => {
    const reindexed: string[] = [];
    const controller = watchProject(projectRoot, {
      onReindex: (filePath) => {
        reindexed.push(filePath);
      },
    });

    // Create files in ignored directories
    mkdirSync(join(projectRoot, "node_modules", "foo"), { recursive: true });
    writeFileSync(
      join(projectRoot, "node_modules", "foo", "index.ts"),
      "export const x = 1;\n"
    );

    await new Promise((resolve) => setTimeout(resolve, 600));
    controller.abort();

    // Should not have re-indexed anything in node_modules
    const nodeModHits = reindexed.filter((p) => p.includes("node_modules"));
    expect(nodeModHits).toHaveLength(0);
  });

  it("prunes graph nodes when a watched file is deleted", { timeout: 15000 }, async () => {
    const reindexed: Array<{ filePath: string; nodeCount: number }> = [];
    const deleted: Array<{ filePath: string; prunedCount: number }> = [];

    const controller = watchProject(projectRoot, {
      onReindex: (filePath, nodeCount) => {
        reindexed.push({ filePath, nodeCount });
      },
      onDelete: (filePath, prunedCount) => {
        deleted.push({ filePath, prunedCount });
      },
    });

    // Let the watcher initialize.
    await new Promise((r) => setTimeout(r, 200));

    // Index a file we will then delete.
    const target = join(srcDir, "to-prune.ts");
    writeFileSync(
      target,
      "export function pruneMe() { return 1; }\nexport class PruneMeToo { x = 0; }\n"
    );

    // Wait until the watcher reports it.
    let deadline = Date.now() + 5000;
    while (
      !reindexed.some((r) => r.filePath === "src/to-prune.ts") &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(reindexed.some((r) => r.filePath === "src/to-prune.ts")).toBe(true);

    // Delete it.
    rmSync(target);

    // Wait until onDelete fires.
    deadline = Date.now() + 5000;
    while (
      !deleted.some((d) => d.filePath === "src/to-prune.ts") &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 200));
    }
    controller.abort();

    const pruneEvent = deleted.find((d) => d.filePath === "src/to-prune.ts");
    expect(pruneEvent).toBeDefined();
    expect(pruneEvent!.prunedCount).toBeGreaterThan(0);

    // Graph should no longer carry this file's nodes.
    const store = await getStore(projectRoot);
    try {
      expect(store.countBySourceFile("src/to-prune.ts")).toBe(0);
    } finally {
      store.close();
    }
  });

  it("leaves no nodes under the old sourceFile after a rename", { timeout: 15000 }, async () => {
    const reindexed: string[] = [];
    const deleted: string[] = [];

    const controller = watchProject(projectRoot, {
      onReindex: (filePath) => reindexed.push(filePath),
      onDelete: (filePath) => deleted.push(filePath),
    });

    await new Promise((r) => setTimeout(r, 200));

    const oldPath = join(srcDir, "before-rename.ts");
    const newPath = join(srcDir, "after-rename.ts");
    writeFileSync(
      oldPath,
      "export function renameSubject() { return 'before'; }\n"
    );

    let deadline = Date.now() + 5000;
    while (
      !reindexed.includes("src/before-rename.ts") &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(reindexed).toContain("src/before-rename.ts");

    // Rename: old path becomes missing, new path appears.
    renameSync(oldPath, newPath);

    // Wait until both the prune of the old path and reindex of the new
    // path have been observed.
    deadline = Date.now() + 5000;
    while (
      (!deleted.includes("src/before-rename.ts") ||
        !reindexed.includes("src/after-rename.ts")) &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 200));
    }
    controller.abort();

    expect(deleted).toContain("src/before-rename.ts");
    expect(reindexed).toContain("src/after-rename.ts");

    const store = await getStore(projectRoot);
    try {
      expect(store.countBySourceFile("src/before-rename.ts")).toBe(0);
      expect(store.countBySourceFile("src/after-rename.ts")).toBeGreaterThan(0);
    } finally {
      store.close();
    }
  });
});

describe("formatReindexLine", () => {
  it("formats an indexed result as 'engram: reindexed <path> (<N> nodes)'", () => {
    const result: SyncResult = { action: "indexed", count: 12 };
    expect(formatReindexLine(result, "src/foo.ts")).toBe(
      "engram: reindexed src/foo.ts (12 nodes)"
    );
  });

  it("formats a pruned result as 'engram: pruned <path> (<N> nodes)'", () => {
    const result: SyncResult = { action: "pruned", count: 7 };
    expect(formatReindexLine(result, "src/gone.ts")).toBe(
      "engram: pruned src/gone.ts (7 nodes)"
    );
  });

  it("returns null for a skipped result so the caller stays silent", () => {
    const result: SyncResult = { action: "skipped", count: 0 };
    expect(formatReindexLine(result, "README.md")).toBeNull();
  });

  it("formats large counts with comma thousands separators (locale-stable)", () => {
    const result: SyncResult = { action: "indexed", count: 1234567 };
    expect(formatReindexLine(result, "src/huge.ts")).toBe(
      "engram: reindexed src/huge.ts (1,234,567 nodes)"
    );
  });
});

describe("engram reindex — end-to-end CLI", () => {
  let rxRoot: string;

  beforeAll(async () => {
    if (!existsSync(CLI_PATH)) {
      const r = spawnSync("npm", ["run", "build"], {
        cwd: REPO_ROOT,
        stdio: "ignore",
        timeout: 60_000,
        shell: process.platform === "win32",
      });
      if (r.status !== 0) {
        throw new Error(`npm run build failed with status ${r.status}`);
      }
    }
    rxRoot = mkdtempSync(join(tmpdir(), "engram-reindex-cli-"));
    mkdirSync(join(rxRoot, "src"), { recursive: true });
    writeFileSync(
      join(rxRoot, "src", "seed.ts"),
      "export function seed() { return 1; }\n"
    );
    await init(rxRoot);
  }, 90_000);

  afterAll(() => {
    if (rxRoot) rmSync(rxRoot, { recursive: true, force: true });
  });

  it("exits 0 and prints 'engram: reindexed <file> (N nodes)' after a real edit", () => {
    const target = join(rxRoot, "src", "added.ts");
    writeFileSync(
      target,
      "export function addedFn() { return 42; }\n"
    );

    const r = runReindexCli([target, "-p", rxRoot], rxRoot);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^engram: reindexed .+ \(\d+ nodes\)\n?$/);
    expect(r.stderr).toBe("");
  });

  it("updates the graph when a file is modified (new function in, old out)", async () => {
    const target = join(rxRoot, "src", "evolve.ts");
    writeFileSync(
      target,
      "export function originalFn() { return 1; }\n"
    );
    // First reindex: original function indexed.
    expect(runReindexCli([target, "-p", rxRoot], rxRoot).status).toBe(0);

    const storeBefore = await getStore(rxRoot);
    const beforeLabels = storeBefore
      .getAllNodes()
      .filter((n) => n.sourceFile === "src/evolve.ts")
      .map((n) => n.label);
    storeBefore.close();
    expect(beforeLabels).toContain("originalFn()");
    expect(beforeLabels).not.toContain("replacementFn()");

    // Edit: swap the function out.
    writeFileSync(
      target,
      "export function replacementFn() { return 2; }\n"
    );
    expect(runReindexCli([target, "-p", rxRoot], rxRoot).status).toBe(0);

    const storeAfter = await getStore(rxRoot);
    const afterLabels = storeAfter
      .getAllNodes()
      .filter((n) => n.sourceFile === "src/evolve.ts")
      .map((n) => n.label);
    storeAfter.close();
    expect(afterLabels).toContain("replacementFn()");
    expect(afterLabels).not.toContain("originalFn()");
  });

  it("two parallel subprocess reindex calls leave a coherent graph (AC 6, multi-process)", async () => {
    const a = join(rxRoot, "src", "conc-a.ts");
    const b = join(rxRoot, "src", "conc-b.ts");
    writeFileSync(a, "export function concA() { return 'a'; }\n");
    writeFileSync(b, "export function concB() { return 'b'; }\n");

    const [rA, rB] = await Promise.all([
      runReindexCliAsync([a, "-p", rxRoot], rxRoot),
      runReindexCliAsync([b, "-p", rxRoot], rxRoot),
    ]);
    // Neither invocation should crash; both must exit 0.
    expect(rA.status).toBe(0);
    expect(rB.status).toBe(0);

    // Both files' nodes must be readable after the dust settles —
    // opening the store asserts the DB file is not corrupted.
    const store = await getStore(rxRoot);
    try {
      const aNodes = store.getAllNodes().filter((n) => n.sourceFile === "src/conc-a.ts");
      const bNodes = store.getAllNodes().filter((n) => n.sourceFile === "src/conc-b.ts");
      // At least one of the two must have persisted — SQLite's last-
      // writer-wins semantics mean one write may clobber the other when
      // two sql.js processes save concurrently, but the DB must remain
      // openable and at least one set must be present.
      expect(aNodes.length + bNodes.length).toBeGreaterThan(0);
    } finally {
      store.close();
    }
  }, 30_000);

  it("exits 1 with a single stderr line when the project has no graph", () => {
    const unInitRoot = mkdtempSync(join(tmpdir(), "engram-reindex-nograph-"));
    try {
      const target = join(unInitRoot, "src", "x.ts");
      mkdirSync(join(unInitRoot, "src"), { recursive: true });
      writeFileSync(target, "export const x = 1;\n");

      const r = runReindexCli([target, "-p", unInitRoot], unInitRoot);
      expect(r.status).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("no graph found");
      expect(r.stderr.split("\n").filter((l) => l.length > 0).length).toBe(1);
    } finally {
      rmSync(unInitRoot, { recursive: true, force: true });
    }
  });

  it("exits 0 silently for a non-code file (safe for PostToolUse hook)", async () => {
    const target = join(rxRoot, "notes.md");
    writeFileSync(target, "# Notes\n");

    const storeBefore = await getStore(rxRoot);
    const countBefore = storeBefore.getAllNodes().length;
    storeBefore.close();

    const r = runReindexCli([target, "-p", rxRoot], rxRoot);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("");

    const storeAfter = await getStore(rxRoot);
    const countAfter = storeAfter.getAllNodes().length;
    storeAfter.close();
    expect(countAfter).toBe(countBefore);
  });
});

describe("runReindexHook — Claude Code PostToolUse stdin handler (#8)", () => {
  let hookRoot: string;

  beforeAll(async () => {
    hookRoot = mkdtempSync(join(tmpdir(), "engram-reindex-hook-"));
    mkdirSync(join(hookRoot, "src"), { recursive: true });
    writeFileSync(
      join(hookRoot, "src", "base.ts"),
      "export function base() { return 0; }\n"
    );
    await init(hookRoot);
  });

  afterAll(() => {
    if (hookRoot) rmSync(hookRoot, { recursive: true, force: true });
  });

  it("reindexes tool_input.file_path from a well-formed PostToolUse payload", async () => {
    const target = join(hookRoot, "src", "hook-added.ts");
    writeFileSync(target, "export function hookAdded() { return 7; }\n");

    await runReindexHook({
      hook_event_name: "PostToolUse",
      cwd: hookRoot,
      tool_name: "Edit",
      tool_input: { file_path: target },
    });

    const store = await getStore(hookRoot);
    try {
      const labels = store
        .getAllNodes()
        .filter((n) => n.sourceFile === "src/hook-added.ts")
        .map((n) => n.label);
      expect(labels).toContain("hookAdded()");
    } finally {
      store.close();
    }
  });

  it("resolves relative file_path against cwd (Claude Code sometimes sends relative paths)", async () => {
    const target = join(hookRoot, "src", "relative-path.ts");
    writeFileSync(target, "export function relPath() { return 'rp'; }\n");

    await runReindexHook({
      hook_event_name: "PostToolUse",
      cwd: hookRoot,
      tool_name: "Write",
      tool_input: { file_path: "src/relative-path.ts" },
    });

    const store = await getStore(hookRoot);
    try {
      const labels = store
        .getAllNodes()
        .filter((n) => n.sourceFile === "src/relative-path.ts")
        .map((n) => n.label);
      expect(labels).toContain("relPath()");
    } finally {
      store.close();
    }
  });

  it("is a silent no-op for every malformed payload shape", async () => {
    // None of these should throw or mutate the graph.
    await expect(runReindexHook(null)).resolves.toBeUndefined();
    await expect(runReindexHook(undefined)).resolves.toBeUndefined();
    await expect(runReindexHook("not an object")).resolves.toBeUndefined();
    await expect(runReindexHook(42)).resolves.toBeUndefined();
    await expect(runReindexHook({})).resolves.toBeUndefined();
    await expect(runReindexHook({ cwd: hookRoot })).resolves.toBeUndefined();
    await expect(
      runReindexHook({ cwd: hookRoot, tool_input: "wrong type" })
    ).resolves.toBeUndefined();
    await expect(
      runReindexHook({ cwd: hookRoot, tool_input: {} })
    ).resolves.toBeUndefined();
    await expect(
      runReindexHook({ cwd: hookRoot, tool_input: { file_path: 42 } })
    ).resolves.toBeUndefined();
    await expect(
      runReindexHook({ cwd: hookRoot, tool_input: { file_path: "" } })
    ).resolves.toBeUndefined();
  });

  it("walks up from the FILE path, not cwd — finds the project even when cwd sits above it", async () => {
    // Real-world shape: Claude Code session cwd is a parent of the
    // engram-initialized project (e.g. a monorepo or a parent folder
    // containing multiple sub-projects). The hook must still resolve
    // the correct graph by walking from the edited file's path.
    const parentCwd = dirname(hookRoot);
    const target = join(hookRoot, "src", "nested-proj.ts");
    writeFileSync(target, "export function nestedProj() { return 'np'; }\n");

    // Fresh cache so the lookup actually walks (per-invocation cache
    // lives inside intercept/context.ts).
    const { _resetCacheForTests } = await import(
      "../src/intercept/context.js"
    );
    _resetCacheForTests();

    await runReindexHook({
      hook_event_name: "PostToolUse",
      cwd: parentCwd,
      tool_name: "Edit",
      tool_input: { file_path: target },
    });

    const store = await getStore(hookRoot);
    try {
      const labels = store
        .getAllNodes()
        .filter((n) => n.sourceFile === "src/nested-proj.ts")
        .map((n) => n.label);
      expect(labels).toContain("nestedProj()");
    } finally {
      store.close();
    }
  });

  it("is a silent no-op when cwd is outside any engram-initialized project", async () => {
    const nonProject = mkdtempSync(join(tmpdir(), "engram-reindex-hook-nop-"));
    try {
      await expect(
        runReindexHook({
          hook_event_name: "PostToolUse",
          cwd: nonProject,
          tool_name: "Edit",
          tool_input: { file_path: join(nonProject, "foo.ts") },
        })
      ).resolves.toBeUndefined();
    } finally {
      rmSync(nonProject, { recursive: true, force: true });
    }
  });

  it("the `engram reindex-hook` subprocess always exits 0 (stdin happy path + malformed JSON + no stdin)", async () => {
    if (!existsSync(CLI_PATH)) {
      const r = spawnSync("npm", ["run", "build"], {
        cwd: REPO_ROOT,
        stdio: "ignore",
        timeout: 60_000,
        shell: process.platform === "win32",
      });
      if (r.status !== 0) {
        throw new Error(`npm run build failed with status ${r.status}`);
      }
    }

    // Helper: spawn `engram reindex-hook` with stdin input, assert exit 0 silent.
    const runHookCli = (stdin: string | undefined) =>
      new Promise<{ status: number | null; stdout: string; stderr: string }>(
        (resolveP) => {
          const child = spawn("node", [CLI_PATH, "reindex-hook"], {
            cwd: hookRoot,
          });
          let stdout = "";
          let stderr = "";
          child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
          child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
          child.on("close", (code) =>
            resolveP({ status: code, stdout, stderr })
          );
          if (stdin !== undefined) {
            child.stdin.end(stdin);
          } else {
            child.stdin.end();
          }
        }
      );

    const target = join(hookRoot, "src", "subproc.ts");
    writeFileSync(target, "export function subproc() { return 9; }\n");
    const happy = await runHookCli(
      JSON.stringify({
        hook_event_name: "PostToolUse",
        cwd: hookRoot,
        tool_name: "Edit",
        tool_input: { file_path: target },
      })
    );
    expect(happy.status).toBe(0);
    expect(happy.stdout).toBe("");
    expect(happy.stderr).toBe("");

    const malformed = await runHookCli("not valid json");
    expect(malformed.status).toBe(0);
    expect(malformed.stdout).toBe("");

    const empty = await runHookCli("");
    expect(empty.status).toBe(0);
    expect(empty.stdout).toBe("");

    // And the happy-path subprocess actually updated the graph.
    const store = await getStore(hookRoot);
    try {
      const labels = store
        .getAllNodes()
        .filter((n) => n.sourceFile === "src/subproc.ts")
        .map((n) => n.label);
      expect(labels).toContain("subproc()");
    } finally {
      store.close();
    }
  }, 30_000);
});
