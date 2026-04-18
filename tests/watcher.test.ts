/**
 * Tests for the file watcher — incremental re-indexing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { init, getStore } from "../src/core.js";
import { watchProject } from "../src/watcher.js";

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
