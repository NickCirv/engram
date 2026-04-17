/**
 * Multi-layer context cache — the compound savings engine.
 *
 * Layer 1: Query result cache  — resolved context packets per file path
 * Layer 2: Pattern cache       — structural query answers ("what calls X?")
 * Layer 3: Hot file cache      — top-N most-accessed files pre-warmed in memory
 *
 * All layers backed by SQLite (via the existing graph DB) for cross-session
 * persistence. In-memory LRU for sub-millisecond hot-path lookups.
 *
 * Invalidation:
 *   - File edit → invalidate query cache entry for that file
 *   - Graph mutation → invalidate all pattern cache entries
 *   - Session start → refresh hot file cache from access frequency
 */
import { statSync } from "node:fs";
import { join } from "node:path";
import type { GraphStore } from "../graph/store.js";

// ─── Types ──────────────────────────────────────────────────────────

export interface CacheEntry {
  readonly key: string;
  readonly result: string;
  readonly filePath: string;
  readonly fileMtime: number;
  readonly createdAt: number;
  readonly hitCount: number;
}

export interface PatternEntry {
  readonly pattern: string;
  readonly result: string;
  readonly graphVersion: number;
  readonly hitCount: number;
}

export interface CacheStats {
  readonly queryEntries: number;
  readonly queryHits: number;
  readonly queryMisses: number;
  readonly patternEntries: number;
  readonly patternHits: number;
  readonly patternMisses: number;
  readonly hotFileCount: number;
  readonly totalHits: number;
  readonly totalMisses: number;
  readonly hitRate: number;
}

// ─── In-memory LRU ──────────────────────────────────────────────────

class LRUCache<V> {
  private readonly map = new Map<string, V>();
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: string): V | undefined {
    const val = this.map.get(key);
    if (val !== undefined) {
      // Move to end (most recently used)
      this.map.delete(key);
      this.map.set(key, val);
    }
    return val;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    if (this.map.size >= this.maxSize) {
      // Evict oldest (first entry)
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) this.map.delete(firstKey);
    }
    this.map.set(key, value);
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

// ─── Context Cache ──────────────────────────────────────────────────

interface VersionedResult {
  readonly result: string;
  readonly graphVersion: number;
}

export class ContextCache {
  private readonly queryLRU = new LRUCache<string>(100);
  private readonly patternLRU = new LRUCache<VersionedResult>(50);
  private readonly hotFiles = new Set<string>();

  private queryHits = 0;
  private queryMisses = 0;
  private patternHits = 0;
  private patternMisses = 0;

  /**
   * Initialize cache tables in the store. Call once when the store opens.
   * Safe to call multiple times (uses IF NOT EXISTS).
   */
  static ensureTables(store: GraphStore): void {
    store.runSql(`
      CREATE TABLE IF NOT EXISTS query_cache (
        key TEXT PRIMARY KEY,
        result TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_mtime REAL NOT NULL,
        created_at INTEGER NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 0
      )
    `);
    store.runSql(`
      CREATE TABLE IF NOT EXISTS pattern_cache (
        pattern TEXT PRIMARY KEY,
        result TEXT NOT NULL,
        graph_version INTEGER NOT NULL,
        hit_count INTEGER NOT NULL DEFAULT 0
      )
    `);
    store.runSql(
      "CREATE INDEX IF NOT EXISTS idx_query_cache_file ON query_cache(file_path)"
    );
  }

  // ─── Query Cache (per-file context packets) ─────────────────────

  /**
   * Get a cached context packet for a file. Returns null on miss or if
   * the file has been modified since caching.
   */
  getQuery(store: GraphStore, filePath: string, absPath: string): string | null {
    // Check in-memory LRU first
    const memResult = this.queryLRU.get(filePath);
    if (memResult !== undefined) {
      // Validate mtime
      try {
        const currentMtime = statSync(absPath).mtimeMs;
        const cached = this.getQueryEntry(store, filePath);
        if (cached && cached.fileMtime === currentMtime) {
          this.queryHits++;
          this.incrementQueryHitCount(store, filePath);
          return memResult;
        }
      } catch {
        // File gone or unreadable — invalidate
      }
      this.queryLRU.delete(filePath);
    }

    // Check SQLite
    const entry = this.getQueryEntry(store, filePath);
    if (!entry) {
      this.queryMisses++;
      return null;
    }

    // Validate mtime against current file
    try {
      const currentMtime = statSync(absPath).mtimeMs;
      if (entry.fileMtime !== currentMtime) {
        // Stale — remove and miss
        this.invalidateFile(store, filePath);
        this.queryMisses++;
        return null;
      }
    } catch {
      this.invalidateFile(store, filePath);
      this.queryMisses++;
      return null;
    }

    // Cache hit — promote to LRU
    this.queryLRU.set(filePath, entry.result);
    this.queryHits++;
    this.incrementQueryHitCount(store, filePath);
    return entry.result;
  }

  /**
   * Store a resolved context packet for a file.
   */
  setQuery(store: GraphStore, filePath: string, absPath: string, result: string): void {
    let mtime = 0;
    try {
      mtime = statSync(absPath).mtimeMs;
    } catch {
      return; // Don't cache if we can't read mtime
    }

    store.runSql(
      `INSERT OR REPLACE INTO query_cache (key, result, file_path, file_mtime, created_at, hit_count)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [filePath, result, filePath, mtime, Date.now()]
    );
    this.queryLRU.set(filePath, result);
  }

  // ─── Pattern Cache (structural queries) ─────────────────────────

  /**
   * Get a cached answer for a structural query pattern.
   */
  getPattern(store: GraphStore, pattern: string, graphVersion: number): string | null {
    // In-memory first
    const memResult = this.patternLRU.get(pattern);
    if (memResult !== undefined) {
      if (memResult.graphVersion === graphVersion) {
        this.patternHits++;
        // Persist the hit so cross-session stats reflect this access.
        // LRU hit would otherwise skip the SQLite hit_count update.
        try {
          store.runSql(
            "UPDATE pattern_cache SET hit_count = hit_count + 1 WHERE pattern = ?",
            [pattern]
          );
        } catch {
          // Non-critical
        }
        return memResult.result;
      }
      // Graph version changed — evict stale entry
      this.patternLRU.delete(pattern);
    }

    // SQLite
    const stmt = store.prepare(
      "SELECT result, graph_version, hit_count FROM pattern_cache WHERE pattern = ?"
    );
    stmt.bind([pattern]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      const cachedVersion = row.graph_version as number;
      if (cachedVersion !== graphVersion) {
        // Graph has changed — invalidate
        store.runSql("DELETE FROM pattern_cache WHERE pattern = ?", [pattern]);
        this.patternMisses++;
        return null;
      }
      const result = row.result as string;
      this.patternLRU.set(pattern, { result, graphVersion: cachedVersion });
      this.patternHits++;
      store.runSql(
        "UPDATE pattern_cache SET hit_count = hit_count + 1 WHERE pattern = ?",
        [pattern]
      );
      return result;
    }
    stmt.free();
    this.patternMisses++;
    return null;
  }

  /**
   * Cache a structural query result.
   */
  setPattern(store: GraphStore, pattern: string, result: string, graphVersion: number): void {
    store.runSql(
      `INSERT OR REPLACE INTO pattern_cache (pattern, result, graph_version, hit_count)
       VALUES (?, ?, ?, 0)`,
      [pattern, result, graphVersion]
    );
    this.patternLRU.set(pattern, { result, graphVersion });
  }

  // ─── Hot File Cache ─────────────────────────────────────────────

  /**
   * Pre-warm hot files from access frequency data.
   * Call at SessionStart to eliminate first-hit latency.
   */
  warmHotFiles(store: GraphStore, projectRoot: string, topN = 20): number {
    const stmt = store.prepare(
      "SELECT file_path, result FROM query_cache ORDER BY hit_count DESC LIMIT ?"
    );
    stmt.bind([topN]);
    let count = 0;
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const filePath = row.file_path as string;
      const result = row.result as string;

      // Validate mtime before warming
      try {
        const absPath = join(projectRoot, filePath);
        const currentMtime = statSync(absPath).mtimeMs;
        const entry = this.getQueryEntry(store, filePath);
        if (entry && entry.fileMtime === currentMtime) {
          this.queryLRU.set(filePath, result);
          this.hotFiles.add(filePath);
          count++;
        }
      } catch {
        // File gone — skip
      }
    }
    stmt.free();
    return count;
  }

  // ─── Invalidation ───────────────────────────────────────────────

  /** Invalidate all cache entries for a specific file. */
  invalidateFile(store: GraphStore, filePath: string): void {
    store.runSql("DELETE FROM query_cache WHERE file_path = ?", [filePath]);
    this.queryLRU.delete(filePath);
    this.hotFiles.delete(filePath);
  }

  /** Invalidate all pattern cache entries (on graph mutation). */
  invalidatePatterns(store: GraphStore): void {
    store.runSql("DELETE FROM pattern_cache");
    this.patternLRU.clear();
  }

  /** Clear all caches completely. */
  clearAll(store: GraphStore): void {
    store.runSql("DELETE FROM query_cache");
    store.runSql("DELETE FROM pattern_cache");
    this.queryLRU.clear();
    this.patternLRU.clear();
    this.hotFiles.clear();
    this.queryHits = 0;
    this.queryMisses = 0;
    this.patternHits = 0;
    this.patternMisses = 0;
  }

  // ─── Stats ──────────────────────────────────────────────────────

  getStats(store: GraphStore): CacheStats {
    let queryEntries = 0;
    let patternEntries = 0;
    let persistedQueryHits = 0;
    let persistedPatternHits = 0;

    try {
      const stmt1 = store.prepare(
        "SELECT COUNT(*) as cnt, COALESCE(SUM(hit_count), 0) as hits FROM query_cache"
      );
      if (stmt1.step()) {
        const row = stmt1.getAsObject();
        queryEntries = row.cnt as number;
        persistedQueryHits = row.hits as number;
      }
      stmt1.free();
    } catch {
      // Table may not exist yet
    }

    try {
      const stmt2 = store.prepare(
        "SELECT COUNT(*) as cnt, COALESCE(SUM(hit_count), 0) as hits FROM pattern_cache"
      );
      if (stmt2.step()) {
        const row = stmt2.getAsObject();
        patternEntries = row.cnt as number;
        persistedPatternHits = row.hits as number;
      }
      stmt2.free();
    } catch {
      // Table may not exist yet
    }

    // Merge in-process (this session) counters with persisted totals.
    // SQLite `hit_count` accumulates across all sessions; we prefer the
    // larger of the two to show cross-session activity without
    // double-counting the current session's hits.
    const queryHits = Math.max(this.queryHits, persistedQueryHits);
    const patternHits = Math.max(this.patternHits, persistedPatternHits);

    const totalHits = queryHits + patternHits;
    const totalMisses = this.queryMisses + this.patternMisses;
    const total = totalHits + totalMisses;

    return {
      queryEntries,
      queryHits,
      queryMisses: this.queryMisses,
      patternEntries,
      patternHits,
      patternMisses: this.patternMisses,
      hotFileCount: this.hotFiles.size,
      totalHits,
      totalMisses,
      hitRate: total > 0 ? totalHits / total : 0,
    };
  }

  // ─── Private helpers ────────────────────────────────────────────

  private getQueryEntry(store: GraphStore, filePath: string): CacheEntry | null {
    try {
      const stmt = store.prepare(
        "SELECT * FROM query_cache WHERE key = ?"
      );
      stmt.bind([filePath]);
      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        return {
          key: row.key as string,
          result: row.result as string,
          filePath: row.file_path as string,
          fileMtime: row.file_mtime as number,
          createdAt: row.created_at as number,
          hitCount: row.hit_count as number,
        };
      }
      stmt.free();
    } catch {
      // Table may not exist yet
    }
    return null;
  }

  private incrementQueryHitCount(store: GraphStore, filePath: string): void {
    try {
      store.runSql(
        "UPDATE query_cache SET hit_count = hit_count + 1 WHERE key = ?",
        [filePath]
      );
    } catch {
      // Non-critical
    }
  }
}

/** Singleton cache instance shared across the session. */
let _instance: ContextCache | null = null;

export function getContextCache(): ContextCache {
  if (!_instance) {
    _instance = new ContextCache();
  }
  return _instance;
}

/** Reset the singleton (for tests). */
export function _resetContextCache(): void {
  _instance = null;
}
