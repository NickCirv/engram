/**
 * Provider cache tests — verifies the SQLite cache layer that makes
 * the Context Spine fast. All operations must be <5ms on a warm DB.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GraphStore } from "../src/graph/store.js";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

describe("provider cache", () => {
  let store: GraphStore;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `engram-cache-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    store = await GraphStore.open(join(tmpDir, "graph.db"));
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("setCachedContext + getCachedContext", () => {
    it("stores and retrieves cached context for a file", () => {
      store.setCachedContext(
        "mempalace",
        "src/auth.ts",
        "JWT chosen over session cookies",
        3600,
        "auth decisions"
      );

      const results = store.getCachedContext("src/auth.ts");
      expect(results).toHaveLength(1);
      expect(results[0].provider).toBe("mempalace");
      expect(results[0].filePath).toBe("src/auth.ts");
      expect(results[0].content).toBe("JWT chosen over session cookies");
      expect(results[0].queryUsed).toBe("auth decisions");
      expect(results[0].ttl).toBe(3600);
    });

    it("returns multiple providers for the same file", () => {
      store.setCachedContext("mempalace", "src/auth.ts", "decision 1", 3600);
      store.setCachedContext("context7", "src/auth.ts", "jwt.verify docs", 3600);
      store.setCachedContext("obsidian", "src/auth.ts", "auth notes", 3600);

      const results = store.getCachedContext("src/auth.ts");
      expect(results).toHaveLength(3);
      const providers = results.map((r) => r.provider).sort();
      expect(providers).toEqual(["context7", "mempalace", "obsidian"]);
    });

    it("returns empty array for unknown file", () => {
      expect(store.getCachedContext("nonexistent.ts")).toEqual([]);
    });
  });

  describe("getCachedContextForProvider", () => {
    it("returns specific provider result", () => {
      store.setCachedContext("mempalace", "src/auth.ts", "decision 1", 3600);
      store.setCachedContext("context7", "src/auth.ts", "jwt docs", 3600);

      const result = store.getCachedContextForProvider("context7", "src/auth.ts");
      expect(result).not.toBeNull();
      expect(result!.content).toBe("jwt docs");
    });

    it("returns null for missing provider", () => {
      store.setCachedContext("mempalace", "src/auth.ts", "decision 1", 3600);
      expect(
        store.getCachedContextForProvider("obsidian", "src/auth.ts")
      ).toBeNull();
    });
  });

  describe("staleness", () => {
    it("excludes stale entries from getCachedContext", () => {
      // Insert with TTL=0 (immediately stale)
      store.setCachedContext("mempalace", "src/auth.ts", "old decision", 0);

      const results = store.getCachedContext("src/auth.ts");
      expect(results).toHaveLength(0);
    });

    it("includes fresh entries", () => {
      store.setCachedContext("mempalace", "src/auth.ts", "fresh", 3600);

      const results = store.getCachedContext("src/auth.ts");
      expect(results).toHaveLength(1);
    });

    it("getCachedContextForProvider returns null for stale entry", () => {
      store.setCachedContext("mempalace", "src/auth.ts", "old", 0);
      expect(
        store.getCachedContextForProvider("mempalace", "src/auth.ts")
      ).toBeNull();
    });
  });

  describe("upsert behavior", () => {
    it("overwrites existing entry for same provider+file", () => {
      store.setCachedContext("mempalace", "src/auth.ts", "old content", 3600);
      store.setCachedContext("mempalace", "src/auth.ts", "new content", 7200);

      const results = store.getCachedContext("src/auth.ts");
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe("new content");
      expect(results[0].ttl).toBe(7200);
    });
  });

  describe("warmCache", () => {
    it("bulk inserts multiple entries in a transaction", () => {
      store.warmCache("context7", [
        { filePath: "src/auth.ts", content: "jwt docs" },
        { filePath: "src/db.ts", content: "postgres docs" },
        { filePath: "src/cache.ts", content: "redis docs" },
      ], 3600, "library docs");

      expect(store.getCachedContext("src/auth.ts")).toHaveLength(1);
      expect(store.getCachedContext("src/db.ts")).toHaveLength(1);
      expect(store.getCachedContext("src/cache.ts")).toHaveLength(1);
      expect(store.getCachedContext("src/auth.ts")[0].queryUsed).toBe("library docs");
    });

    it("handles empty entries array", () => {
      store.warmCache("context7", [], 3600);
      // Should not throw
    });

    it("overwrites existing entries", () => {
      store.setCachedContext("context7", "src/auth.ts", "old docs", 3600);
      store.warmCache("context7", [
        { filePath: "src/auth.ts", content: "new docs" },
      ], 7200);

      const results = store.getCachedContext("src/auth.ts");
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe("new docs");
    });
  });

  describe("pruneStaleCache", () => {
    it("removes stale entries and returns count", () => {
      // Insert entries with TTL=0 (immediately stale)
      store.setCachedContext("mempalace", "src/a.ts", "stale1", 0);
      store.setCachedContext("context7", "src/b.ts", "stale2", 0);
      store.setCachedContext("obsidian", "src/c.ts", "fresh", 3600);

      const pruned = store.pruneStaleCache();
      expect(pruned).toBe(2);

      // Fresh entry should survive
      expect(store.getCachedContext("src/c.ts")).toHaveLength(1);
      // Stale entries should be gone (they'd return empty even without prune,
      // but prune physically deletes them)
    });

    it("returns 0 when nothing to prune", () => {
      store.setCachedContext("mempalace", "src/a.ts", "fresh", 3600);
      expect(store.pruneStaleCache()).toBe(0);
    });
  });

  describe("clearProviderCache", () => {
    it("removes all entries for a specific provider", () => {
      store.setCachedContext("mempalace", "src/a.ts", "decision", 3600);
      store.setCachedContext("mempalace", "src/b.ts", "decision2", 3600);
      store.setCachedContext("context7", "src/a.ts", "docs", 3600);

      store.clearProviderCache("mempalace");

      // mempalace entries gone
      expect(
        store.getCachedContextForProvider("mempalace", "src/a.ts")
      ).toBeNull();
      // context7 entries preserved
      expect(
        store.getCachedContextForProvider("context7", "src/a.ts")
      ).not.toBeNull();
    });
  });

  describe("getCacheStats", () => {
    it("returns per-provider counts", () => {
      store.setCachedContext("mempalace", "src/a.ts", "d1", 3600);
      store.setCachedContext("mempalace", "src/b.ts", "d2", 3600);
      store.setCachedContext("context7", "src/a.ts", "docs", 3600);
      store.setCachedContext("obsidian", "src/a.ts", "notes", 0); // stale

      const stats = store.getCacheStats();
      const mp = stats.find((s) => s.provider === "mempalace");
      const c7 = stats.find((s) => s.provider === "context7");
      const ob = stats.find((s) => s.provider === "obsidian");

      expect(mp?.count).toBe(2);
      expect(mp?.stale).toBe(0);
      expect(c7?.count).toBe(1);
      expect(ob?.stale).toBe(1);
    });
  });

  describe("clearAll includes cache", () => {
    it("clearAll removes cache entries too", () => {
      store.setCachedContext("mempalace", "src/a.ts", "decision", 3600);
      store.clearAll();
      expect(store.getCachedContext("src/a.ts")).toEqual([]);
    });
  });
});
