import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { learn, getStore } from "../src/core.js";

describe("memory scope recording and retrieval", () => {
  let tmpDir: string;
  let projectRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "engram-test-"));
    projectRoot = tmpDir;
    // Ensure project root exists
    mkdirSync(projectRoot, { recursive: true });
    // Use an isolated global DB for this test run
    process.env.ENGRAM_GLOBAL_DB_PATH = join(tmpDir, "memory.db");
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    delete process.env.ENGRAM_GLOBAL_DB_PATH;
  });

  it("records ~100 memories for each scope and retrieves them by memoryScope", async () => {
    const scopes = ["project", "global", "entity"];
    // Insert 100 decision-like statements per scope in a single learn call per scope
    for (const scope of scopes) {
      const lines: string[] = [];
      for (let i = 0; i < 100; i++) {
        lines.push(`We chose ${scope}Choice${i} over legacy for testing`);
      }
      const text = lines.join("\n");
      await learn(projectRoot, text, "test", scope);
    }

    const store = await getStore(projectRoot);
    try {
      const all = store.getAllNodes(projectRoot);
      // Count by metadata.memoryScope
      const counts: Record<string, number> = { project: 0, global: 0, entity: 0 };
      for (const n of all) {
        const ms = (n.metadata && (n.metadata as any).memoryScope) || "project";
        if (counts[ms] !== undefined) counts[ms]++;
      }

      // Expect approx 100 entries per scope (some miners may produce extra nodes,
      // but at least 100 per scope should be present)
      expect(counts.project).toBeGreaterThanOrEqual(100);
      expect(counts.global).toBeGreaterThanOrEqual(100);
      expect(counts.entity).toBeGreaterThanOrEqual(100);
    } finally {
      store.close();
    }
  });
});
