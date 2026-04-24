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

/**
 * Third-party provider plugin. Extends ContextProvider with metadata
 * so the CLI can list installed plugins and the resolver can tell them
 * apart from built-ins.
 *
 * Plugins live at `~/.engram/plugins/<name>.mjs` and default-export an
 * object matching this interface.
 *
 * v3.0 — plugins can now declare an `mcpConfig` instead of writing their
 * own `resolve()` / `isAvailable()`. The plugin loader auto-wraps such
 * plugins via `createMcpProvider()` so wrapping an MCP server is a ~10-
 * line file. If both `mcpConfig` AND a custom `resolve()` are provided,
 * the custom `resolve()` wins (author opted in to hand-rolled logic).
 */
export interface ContextProviderPlugin extends ContextProvider {
  /** Semver string for compatibility tracking. */
  readonly version: string;
  /** One-line description shown by `engram plugin list`. */
  readonly description?: string;
  /** Optional author attribution. */
  readonly author?: string;
  /**
   * v3.0 — original MCP declaration the plugin file used (if any).
   * Retained after auto-wrap so `engram plugin list` can show
   * 'mcp-backed' plugins distinctly and tests can verify wrap behavior.
   * The loader validates the shape at load-time; from the resolver's
   * perspective this field is informational only.
   */
  readonly mcpConfig?: unknown;
}

/**
 * Raw plugin file shape — what authors write in `~/.engram/plugins/*.mjs`.
 * Fields that the MCP auto-wrap fills in (resolve, isAvailable, tier,
 * tokenBudget, timeoutMs) are optional here so a plugin that only
 * declares `mcpConfig` is a valid raw plugin file. The loader's
 * `validatePlugin()` upgrades this to a full `ContextProviderPlugin`
 * by running the classic-path validation OR auto-wrapping via
 * `createMcpProvider()`.
 */
export type RawPluginShape = Partial<ContextProvider> & {
  readonly name: string;
  readonly label: string;
  readonly version: string;
  readonly description?: string;
  readonly author?: string;
  readonly mcpConfig?: unknown;
};

/** Provider priority order (highest first). Used when total output exceeds budget. */
export const PROVIDER_PRIORITY: readonly string[] = [
  "engram:ast",
  "engram:structure",
  "engram:mistakes",
  // anthropic:memory sits between mistakes and mempalace — it's cheap
  // (tier 1, single local file read), strictly relevant when present,
  // and complements mistakes (mistakes = 'this broke'; anthropic:memory
  // = 'here's what we learned about this area'). Placing it above
  // mempalace keeps Claude Code users' own curated memory first.
  "anthropic:memory",
  "mempalace",
  "context7",
  "engram:git",
  "obsidian",
  "engram:lsp",
];

/** Default TTL for cached provider results (1 hour). */
export const DEFAULT_CACHE_TTL_SEC = 3600;
