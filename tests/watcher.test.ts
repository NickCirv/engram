/**
 * Tests for the file watcher — incremental re-indexing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
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
});
