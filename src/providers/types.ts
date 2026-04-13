/**
 * Context Spine provider types.
 *
 * A ContextProvider resolves external context for a file — decisions from
 * MemPalace, library docs from Context7, project notes from Obsidian, or
 * internal data like git history and mistake memory.
 *
 * Providers are queried during Read interception. Tier 1 (internal) providers
 * resolve from the local SQLite graph. Tier 2 (external) providers cache
 * results in the provider_cache table and resolve via execFile or HTTP.
 *
 * The cache-in-SQLite pattern keeps per-Read latency under 100ms even with
 * 6 providers. Expensive work happens at SessionStart (cache warmup).
 */

/** Context about the file being read, passed to providers. */
export interface NodeContext {
  /** Relative file path (POSIX format). */
  readonly filePath: string;
  /** Absolute project root. */
  readonly projectRoot: string;
  /** Node IDs in this file (from the graph). */
  readonly nodeIds: readonly string[];
  /** Detected import package names (e.g., ['jsonwebtoken', 'express']). */
  readonly imports: readonly string[];
  /** Whether a corresponding test file exists. */
  readonly hasTests: boolean;
  /** Git churn rate (0-1, from git miner). */
  readonly churnRate: number;
}

/** Result from a single provider. */
export interface ProviderResult {
  /** Provider name (e.g., 'mempalace', 'context7'). */
  readonly provider: string;
  /** Formatted text content, within tokenBudget. */
  readonly content: string;
  /** Relevance confidence 0-1. Used for priority ordering when budget is tight. */
  readonly confidence: number;
  /** Whether this result came from cache. */
  readonly cached: boolean;
}

/** Result from a bulk warmup operation. */
export interface WarmupEntry {
  readonly filePath: string;
  readonly content: string;
}

export interface WarmupResult {
  readonly provider: string;
  readonly entries: readonly WarmupEntry[];
  readonly durationMs: number;
}

/** A cached provider result as stored in SQLite. */
export interface CachedContext {
  readonly provider: string;
  readonly filePath: string;
  readonly content: string;
  readonly queryUsed: string;
  readonly cachedAt: number; // unix ms
  readonly ttl: number; // seconds
}

/**
 * Context provider interface. All providers — internal and external —
 * implement this. The contract:
 *
 * - `resolve()` returns context for a single file, or null if nothing relevant
 * - `warmup()` (optional, Tier 2 only) bulk-fetches context for all files
 * - Providers MUST respect their tokenBudget
 * - Providers MUST complete within timeoutMs or be skipped
 * - Providers MUST NOT throw — return null on any error
 */
export interface ContextProvider {
  /** Provider identifier (e.g., 'mempalace', 'engram:structure'). */
  readonly name: string;
  /** Display label for the rich packet section header. */
  readonly label: string;
  /** 1 = internal (graph-local), 2 = external (cached). */
  readonly tier: 1 | 2;
  /** Maximum tokens this provider may emit per file. */
  readonly tokenBudget: number;
  /** Timeout for live resolution (cache miss) in milliseconds. */
  readonly timeoutMs: number;

  /**
   * Resolve context for a specific file. Returns null if nothing relevant.
   * MUST NOT throw — catch all errors internally and return null.
   */
  resolve(
    filePath: string,
    context: NodeContext
  ): Promise<ProviderResult | null>;

  /**
   * Bulk warmup: resolve context for all project files. Called at
   * SessionStart. Tier 1 providers typically skip this (they're fast
   * enough to resolve on demand). Tier 2 providers use this to
   * pre-fill the cache.
   */
  warmup?(projectRoot: string): Promise<WarmupResult>;

  /**
   * Whether this provider is available in the current environment.
   * Called once at startup. If false, the provider is silently skipped.
   * Examples: obsidian returns false if Obsidian isn't running.
   */
  isAvailable(): Promise<boolean>;
}

/** Provider priority order (highest first). Used when total output exceeds budget. */
export const PROVIDER_PRIORITY: readonly string[] = [
  "engram:structure",
  "engram:mistakes",
  "mempalace",
  "context7",
  "engram:git",
  "obsidian",
];

/** Default TTL for cached provider results (1 hour). */
export const DEFAULT_CACHE_TTL_SEC = 3600;
