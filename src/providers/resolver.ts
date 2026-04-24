/**
 * Context Spine resolver — the core engine that assembles a rich context
 * packet from multiple providers for a single file.
 *
 * On Read interception:
 *   1. Run all available providers in parallel
 *   2. Tier 1 providers resolve directly (graph, mistakes, git)
 *   3. Tier 2 providers check cache first, live-resolve on miss
 *   4. Assemble results in priority order within total token budget
 *   5. Return formatted rich packet
 *
 * The resolver itself never throws — any provider failure is silently
 * skipped. If ALL providers fail, returns null (caller falls through
 * to existing behavior).
 */
import type {
  ContextProvider,
  NodeContext,
  ProviderResult,
} from "./types.js";
import { PROVIDER_PRIORITY } from "./types.js";
import { astProvider } from "./ast.js";
import { structureProvider } from "./engram-structure.js";
import { mistakesProvider } from "./engram-mistakes.js";
import { gitProvider } from "./engram-git.js";
import { mempalaceProvider } from "./mempalace.js";
import { context7Provider } from "./context7.js";
import { obsidianProvider } from "./obsidian.js";
import { lspProvider } from "./lsp.js";
import { readConfig } from "../tuner/config.js";

/** Built-in providers (first-party, always available). */
const BUILTIN_PROVIDERS: readonly ContextProvider[] = [
  astProvider,
  structureProvider,
  mistakesProvider,
  gitProvider,
  mempalaceProvider,
  context7Provider,
  obsidianProvider,
  lspProvider,
];

/** Names of built-in providers. User plugins can't shadow these. */
const BUILTIN_NAMES = new Set(BUILTIN_PROVIDERS.map((p) => p.name));

/**
 * MCP-backed providers loaded from `~/.engram/mcp-providers.json`. Cached
 * across Reads for the session lifetime — config is read once on first
 * call. Test hooks use `_resetMcpProvidersCache()` to force reload.
 */
let mcpProvidersCache: readonly ContextProvider[] | null = null;
async function getMcpProviders(): Promise<readonly ContextProvider[]> {
  if (mcpProvidersCache) return mcpProvidersCache;
  try {
    const [{ loadMcpConfigs }, { createMcpProvider }] = await Promise.all([
      import("./mcp-config.js"),
      import("./mcp-client.js"),
    ]);
    const { configs, failed } = loadMcpConfigs();
    if (failed.length > 0) {
      for (const f of failed) {
        // One-line stderr warning per bad entry — don't crash, don't
        // noop-swallow. Users need to know their config didn't take.
        process.stderr.write(
          `[engram] mcp-providers.json entry ${f.index}: ${f.reason}\n`
        );
      }
    }
    mcpProvidersCache = configs.map(createMcpProvider);
  } catch {
    mcpProvidersCache = [];
  }
  return mcpProvidersCache;
}

/** Test-only: clear the MCP provider cache so config reload picks up changes. */
export function _resetMcpProvidersCache(): void {
  mcpProvidersCache = null;
}

/**
 * Full provider list = built-ins + user plugins + MCP-configured providers
 * (all deduped against built-in names so users can't shadow core providers).
 * Loaded lazily. Safe: a broken plugin or malformed MCP config can never
 * break engram — validation is in plugin-loader.ts / mcp-config.ts.
 */
async function getAllProviders(): Promise<readonly ContextProvider[]> {
  const [{ getLoadedPlugins }, mcpProviders] = await Promise.all([
    import("./plugin-loader.js"),
    getMcpProviders(),
  ]);
  const { loaded } = await getLoadedPlugins();
  const safePlugins = loaded.filter((p) => !BUILTIN_NAMES.has(p.name));
  const safeMcp = mcpProviders.filter((p) => !BUILTIN_NAMES.has(p.name));
  return [...BUILTIN_PROVIDERS, ...safePlugins, ...safeMcp];
}

/** Back-compat alias — built-ins only. Plugins flow through getAllProviders(). */
const ALL_PROVIDERS: readonly ContextProvider[] = BUILTIN_PROVIDERS;

/** Maximum total tokens for the assembled rich packet. */
const TOTAL_TOKEN_BUDGET = 600;

/** Rough token estimate: ~4 chars per token. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface RichPacket {
  /** Assembled text with all provider sections. */
  readonly text: string;
  /** Number of providers that contributed. */
  readonly providerCount: number;
  /** Names of providers that contributed. */
  readonly providers: readonly string[];
  /** Estimated token count. */
  readonly estimatedTokens: number;
  /** Total resolution time in ms. */
  readonly durationMs: number;
}

/**
 * Resolve a rich context packet for a file from all available providers.
 * Returns null if no providers produced results.
 *
 * @param filePath - Relative file path (POSIX)
 * @param context - Node context with project root, imports, etc.
 * @param enabledProviders - Optional: only use these providers (by name)
 */
export async function resolveRichPacket(
  filePath: string,
  context: NodeContext,
  enabledProviders?: readonly string[]
): Promise<RichPacket | null> {
  const start = Date.now();

  // Filter to enabled + available providers.
  // Use getAllProviders() so installed plugins participate; falls back to
  // BUILTIN_PROVIDERS silently if plugin loading fails.
  let allProviders: readonly ContextProvider[];
  try {
    allProviders = await getAllProviders();
  } catch {
    allProviders = BUILTIN_PROVIDERS;
  }

  const providers = allProviders.filter((p) => {
    if (enabledProviders && !enabledProviders.includes(p.name)) return false;
    return true;
  });

  // Check availability (fast — cached after first call)
  const available = await filterAvailable(providers);
  if (available.length === 0) return null;

  // Resolve all providers in parallel with per-provider timeouts
  const settled = await Promise.allSettled(
    available.map((p) => resolveWithTimeout(p, filePath, context))
  );

  // Collect successful results
  const results: ProviderResult[] = [];
  for (const outcome of settled) {
    if (outcome.status === "fulfilled" && outcome.value) {
      results.push(outcome.value);
    }
  }

  if (results.length === 0) return null;

  // When engram:ast succeeds (confidence 1.0), drop the lower-confidence
  // engram:structure result to avoid duplicate structural content.
  const hasAst = results.some((r) => r.provider === "engram:ast");
  const deduped = hasAst
    ? results.filter((r) => r.provider !== "engram:structure")
    : results;

  // v3.0 — per-provider budget backstop. Providers are supposed to
  // self-truncate to their `tokenBudget`, but a bad plugin or a server
  // that ignores its contract shouldn't be able to spend our whole
  // total budget on one section. Truncate here before assembly.
  const budgetedResults = enforcePerProviderBudget(deduped, allProviders);

  // v3.0 — mistakes-boost reranking. Results that mention a label from
  // the engram:mistakes provider get their confidence boosted (capped
  // at 1.0) so they sort up within their priority tier. This surfaces
  // structural context that touches known-broken areas ahead of other
  // structural context of equal priority.
  const boosted = boostByMistakes(budgetedResults);

  // Sort by (priority index, boosted confidence desc). Priority is the
  // primary axis — boost only breaks ties within the same priority tier.
  // Unknown providers sort last (priority index 99).
  const sorted = [...boosted].sort((a, b) => {
    const aIdx = PROVIDER_PRIORITY.indexOf(a.provider);
    const bIdx = PROVIDER_PRIORITY.indexOf(b.provider);
    const pa = aIdx === -1 ? 99 : aIdx;
    const pb = bIdx === -1 ? 99 : bIdx;
    if (pa !== pb) return pa - pb;
    return b.confidence - a.confidence;
  });

  // Assemble within budget (config-driven, falls back to compile-time constant)
  const config = readConfig(context.projectRoot);
  const budget = config.totalTokenBudget;
  const sections: string[] = [];
  let totalTokens = 0;

  for (const result of sorted) {
    const sectionTokens = estimateTokens(result.content);
    if (totalTokens + sectionTokens > budget) {
      // Budget exceeded — skip remaining providers
      break;
    }

    // Find the provider's label — look up in the full list (built-ins + plugins)
    const provider = allProviders.find((p) => p.name === result.provider);
    const label = provider?.label ?? result.provider.toUpperCase();
    const cacheTag = result.cached ? ", cached" : "";

    sections.push(`${label} (${result.provider}${cacheTag}):\n${result.content}`);
    totalTokens += sectionTokens;
  }

  if (sections.length === 0) return null;

  const providerNames = sorted
    .filter((_, i) => i < sections.length)
    .map((r) => r.provider);

  // When called as enrichment (structure excluded), use a lighter header
  const isEnrichment = enabledProviders && !enabledProviders.includes("engram:structure");
  const header = isEnrichment
    ? `[engram] Additional context (${providerNames.length} providers, ~${totalTokens} tokens)`
    : `[engram] Rich context for ${filePath} (${providerNames.length} providers, ~${totalTokens} tokens)`;
  const text = `${header}\n\n${sections.join("\n\n")}`;

  return {
    text,
    providerCount: providerNames.length,
    providers: providerNames,
    estimatedTokens: totalTokens + estimateTokens(header),
    durationMs: Date.now() - start,
  };
}

/**
 * Warm all Tier 2 provider caches. Called at SessionStart.
 */
export async function warmAllProviders(
  projectRoot: string,
  enabledProviders?: readonly string[]
): Promise<{ warmed: string[]; durationMs: number }> {
  const start = Date.now();
  const warmed: string[] = [];

  const tier2 = ALL_PROVIDERS.filter(
    (p) =>
      p.tier === 2 &&
      p.warmup &&
      (!enabledProviders || enabledProviders.includes(p.name))
  );

  const available = await filterAvailable(tier2);

  // Warm in parallel with per-provider timeouts
  const settled = await Promise.allSettled(
    available.map(async (p) => {
      try {
        const result = await withTimeout(p.warmup!(projectRoot), 5000);
        if (result && result.entries.length > 0) {
          // Write to cache
          const { getStore } = await import("../core.js");
          const store = await getStore(projectRoot);
          try {
            store.warmCache(
              result.provider,
              [...result.entries],
              result.provider === "context7" ? 4 * 3600 : 3600
            );
            store.save();
          } finally {
            store.close();
          }
          warmed.push(p.name);
        }
      } catch {
        // Silent failure
      }
    })
  );

  return { warmed, durationMs: Date.now() - start };
}

// ─── Internals ──────────────────────────────────────────────────

/**
 * Truncate every result's content to its provider's declared tokenBudget.
 * Providers are supposed to self-truncate; this is a backstop so a bad
 * plugin or a non-conforming MCP server can't spend the whole total
 * budget on one section. Truncates by whole lines when possible so we
 * don't cut mid-word.
 */
export function enforcePerProviderBudget(
  results: readonly ProviderResult[],
  providers: readonly ContextProvider[]
): ProviderResult[] {
  const out: ProviderResult[] = [];
  for (const r of results) {
    const provider = providers.find((p) => p.name === r.provider);
    const budget = provider?.tokenBudget ?? 200;
    if (estimateTokens(r.content) <= budget) {
      out.push(r);
      continue;
    }
    // Over budget — truncate by lines, then hard-cap by chars as last resort
    const lines = r.content.split("\n");
    const kept: string[] = [];
    let used = 0;
    for (const line of lines) {
      const lineTokens = estimateTokens(line) + 1;
      if (used + lineTokens > budget) break;
      kept.push(line);
      used += lineTokens;
    }
    const truncated =
      kept.length > 0
        ? kept.join("\n") + "\n… [truncated]"
        : r.content.slice(0, budget * 4 - 20) + "… [truncated]";
    out.push({ ...r, content: truncated });
  }
  return out;
}

/**
 * Extract mistake labels from an engram:mistakes provider result. The
 * provider formats mistakes as `  ! <label> (flagged <age>)` — one per
 * line. Returns the labels only, trimmed, lowercased for case-insensitive
 * matching.
 */
function extractMistakeLabels(mistakesContent: string): string[] {
  const labels: string[] = [];
  for (const line of mistakesContent.split("\n")) {
    const match = line.match(/^\s*!\s+(.+?)\s+\(flagged/);
    if (match && match[1]) {
      labels.push(match[1].trim().toLowerCase());
    }
  }
  return labels;
}

/**
 * Boost the confidence of results whose content mentions a known-mistake
 * label from the engram:mistakes provider. Boost = 1.5x, capped at 1.0.
 * The mistakes result itself is NOT boosted (it's already at confidence
 * 0.95 — boosting would flatten the distinction between the signal and
 * the signal-holders).
 *
 * Runs BEFORE the priority sort so the boosted confidence participates
 * in the secondary-sort tie-breaker. Priority still wins across tiers.
 */
export function boostByMistakes(
  results: readonly ProviderResult[]
): ProviderResult[] {
  const mistakesResult = results.find((r) => r.provider === "engram:mistakes");
  if (!mistakesResult) return [...results];

  const labels = extractMistakeLabels(mistakesResult.content);
  if (labels.length === 0) return [...results];

  return results.map((r) => {
    if (r.provider === "engram:mistakes") return r;
    const lower = r.content.toLowerCase();
    const matched = labels.some((label) => lower.includes(label));
    if (!matched) return r;
    return {
      ...r,
      confidence: Math.min(1.0, r.confidence * 1.5),
    };
  });
}

const availabilityCache = new Map<string, boolean>();

/** Reset availability cache. Used in tests. */
export function _resetAvailabilityCache(): void {
  availabilityCache.clear();
}

async function filterAvailable(
  providers: readonly ContextProvider[]
): Promise<ContextProvider[]> {
  // Check all providers in PARALLEL — sequential checks would let
  // unavailable Tier 2 providers (500ms timeout each) eat the entire
  // enrichment budget before any Tier 1 provider gets a chance.
  const checks = providers.map(async (p) => {
    let available = availabilityCache.get(p.name);
    if (available === undefined) {
      try {
        const timeout = p.tier === 1 ? 200 : 500;
        available = await withTimeout(p.isAvailable(), timeout);
      } catch {
        available = false;
      }
      availabilityCache.set(p.name, available);
    }
    return { provider: p, available };
  });

  const settled = await Promise.all(checks);
  return settled.filter((c) => c.available).map((c) => c.provider);
}

async function resolveWithTimeout(
  provider: ContextProvider,
  filePath: string,
  context: NodeContext
): Promise<ProviderResult | null> {
  try {
    return await withTimeout(
      provider.resolve(filePath, context),
      provider.timeoutMs
    );
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
