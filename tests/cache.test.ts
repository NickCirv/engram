import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GraphStore } from "../src/graph/store.js";
import {
  ContextCache,
  getContextCache,
  _resetContextCache,
} from "../src/intelligence/cache.js";

describe("ContextCache", () => {
  let testDir: string;
  let store: GraphStore;
  let cache: ContextCache;
  let testFile: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `engram-cache-${Date.now()}`);
    mkdirSync(join(testDir, ".engram"), { recursive: true });
    mkdirSync(join(testDir, "src"), { recursive: true });

    testFile = join(testDir, "src", "app.ts");
    writeFileSync(testFile, "export function hello() {}\n");

    store = await GraphStore.open(join(testDir, ".engram", "graph.db"));
    ContextCache.ensureTables(store);

    _resetContextCache();
    cache = getContextCache();
  });

  afterEach(() => {
    store.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("query cache", () => {
    it("returns null on cache miss", () => {
      const result = cache.getQuery(store, "src/app.ts", testFile);
      expect(result).toBeNull();
    });

    it("caches and retrieves a context packet", () => {
      cache.setQuery(store, "src/app.ts", testFile, "cached summary");
      const result = cache.getQuery(store, "src/app.ts", testFile);
      expect(result).toBe("cached summary");
    });

    it("invalidates on file modification", () => {
      cache.setQuery(store, "src/app.ts", testFile, "old summary");

      // Modify the file
      writeFileSync(testFile, "export function updated() {}\n");

      const result = cache.getQuery(store, "src/app.ts", testFile);
      expect(result).toBeNull();
    });

    it("invalidates when file is deleted", () => {
      cache.setQuery(store, "src/app.ts", testFile, "cached");
      rmSync(testFile);

      const result = cache.getQuery(store, "src/app.ts", testFile);
      expect(result).toBeNull();
    });

    it("tracks hit counts", () => {
      cache.setQuery(store, "src/app.ts", testFile, "summary");
      cache.getQuery(store, "src/app.ts", testFile); // hit 1
      cache.getQuery(store, "src/app.ts", testFile); // hit 2

      const stats = cache.getStats(store);
      expect(stats.queryHits).toBe(2);
      expect(stats.queryMisses).toBe(0);
    });
  });

  describe("pattern cache", () => {
    it("returns null on cache miss", () => {
      const result = cache.getPattern(store, "what calls hello?", 1);
      expect(result).toBeNull();
    });

    it("caches and retrieves a pattern result", () => {
      cache.setPattern(store, "what calls hello?", "hello is called by main()", 1);
      const result = cache.getPattern(store, "what calls hello?", 1);
      expect(result).toBe("hello is called by main()");
    });

    it("invalidates when graph version changes", () => {
      cache.setPattern(store, "what calls hello?", "old answer", 1);
      const result = cache.getPattern(store, "what calls hello?", 2);
      expect(result).toBeNull();
    });

    it("tracks hit/miss counts", () => {
      cache.getPattern(store, "miss1", 1); // miss
      cache.setPattern(store, "hit1", "answer", 1);
      cache.getPattern(store, "hit1", 1); // hit

      const stats = cache.getStats(store);
      expect(stats.patternHits).toBe(1);
      expect(stats.patternMisses).toBe(1);
    });
  });

  describe("hot file cache", () => {
    it("warms files from access frequency", () => {
      // Set up a cached file with hits
      cache.setQuery(store, "src/app.ts", testFile, "hot summary");
      // Simulate hits by updating hit_count directly
      store.runSql("UPDATE query_cache SET hit_count = 10 WHERE key = ?", [
        "src/app.ts",
      ]);

      // Create a new cache instance (simulating new session)
      _resetContextCache();
      const freshCache = getContextCache();
      const warmed = freshCache.warmHotFiles(store, testDir);
      expect(warmed).toBe(1);

      // Should be in LRU now (no SQLite hit needed for subsequent reads)
      const stats = freshCache.getStats(store);
      expect(stats.hotFileCount).toBe(1);
    });
  });

  describe("invalidation", () => {
    it("invalidateFile removes query cache entry", () => {
      cache.setQuery(store, "src/app.ts", testFile, "summary");
      cache.invalidateFile(store, "src/app.ts");

      const result = cache.getQuery(store, "src/app.ts", testFile);
      expect(result).toBeNull();
    });

    it("invalidatePatterns clears all pattern entries", () => {
      cache.setPattern(store, "q1", "a1", 1);
      cache.setPattern(store, "q2", "a2", 1);
      cache.invalidatePatterns(store);

      expect(cache.getPattern(store, "q1", 1)).toBeNull();
      expect(cache.getPattern(store, "q2", 1)).toBeNull();
    });

    it("clearAll resets everything", () => {
      cache.setQuery(store, "src/app.ts", testFile, "summary");
      cache.setPattern(store, "q1", "a1", 1);
      cache.clearAll(store);

      const stats = cache.getStats(store);
      expect(stats.queryEntries).toBe(0);
      expect(stats.patternEntries).toBe(0);
      expect(stats.totalHits).toBe(0);
      expect(stats.totalMisses).toBe(0);
    });
  });

  describe("stats", () => {
    it("reports correct entry counts", () => {
      cache.setQuery(store, "src/app.ts", testFile, "s1");
      cache.setPattern(store, "q1", "a1", 1);
      cache.setPattern(store, "q2", "a2", 1);

      const stats = cache.getStats(store);
      expect(stats.queryEntries).toBe(1);
      expect(stats.patternEntries).toBe(2);
    });

    it("computes hit rate correctly", () => {
      cache.setQuery(store, "src/app.ts", testFile, "s1");
      cache.getQuery(store, "src/app.ts", testFile); // hit
      cache.getQuery(store, "src/missing.ts", "/nonexistent"); // miss

      const stats = cache.getStats(store);
      expect(stats.hitRate).toBeCloseTo(0.5);
    });
  });

  describe("singleton", () => {
    it("returns same instance across calls", () => {
      const a = getContextCache();
      const b = getContextCache();
      expect(a).toBe(b);
    });

    it("resets on _resetContextCache", () => {
      const a = getContextCache();
      _resetContextCache();
      const b = getContextCache();
      expect(a).not.toBe(b);
    });
  });
});
