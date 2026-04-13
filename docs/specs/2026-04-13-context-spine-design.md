# engram Context Spine — Design Spec
**Date:** 2026-04-13
**Status:** Approved for implementation
**Author:** Nick Ashkar + Claude
**Version:** 1.0

---

## Problem

AI coding agents assemble context from 5+ sources per file: structural reads, semantic memory (MemPalace), library docs (Context7), project notes (Obsidian), git history, and test status. Each source is a separate tool call costing 500-2000 tokens. A typical file investigation costs ~5,300 tokens across 5 calls.

engram currently intercepts Read calls and serves structural summaries — saving ~80% on individual reads. But the agent still makes 4+ follow-up calls to assemble full context. The net session savings is ~20-25%.

## Solution

**Context Spine:** engram becomes the central context routing layer. On Read interception, it resolves context from multiple providers in parallel and serves a single rich packet. One call replaces five.

**Target:** 90%+ session-level token savings by eliminating redundant tool calls entirely.

## Architecture

```
SessionStart (runs once, async):
  1. Detect imports -> Context7 bulk fetch
  2. Project name -> MemPalace bulk search
  3. Project path -> Obsidian relevant notes
  4. Write ALL results to provider_cache table
  Time: 3-8s (acceptable, no strict timeout)

PreToolUse:Read (runs per file, target <200ms):
  1. Graph lookup: <50ms (existing)
  2. SELECT FROM provider_cache: <5ms per provider
  3. Cache HIT -> assemble rich packet
  4. Cache MISS -> 200ms live-resolve timeout
     -> resolved? cache + serve
     -> timeout? degrade to hint (Approach B fallback)
  Total: ~65ms cached, ~275ms cold
```

## Provider Cache Schema

New table in existing `.engram/graph.db`:

```sql
CREATE TABLE IF NOT EXISTS provider_cache (
  provider TEXT NOT NULL,      -- 'mempalace' | 'context7' | 'obsidian'
  file_path TEXT NOT NULL,     -- relative path this context applies to
  content TEXT NOT NULL,        -- resolved context (<=150 tokens)
  query_used TEXT,             -- the query that produced this result
  cached_at INTEGER NOT NULL,  -- unix timestamp ms
  ttl INTEGER NOT NULL,        -- seconds until stale (default 3600)
  PRIMARY KEY (provider, file_path)
);

CREATE INDEX IF NOT EXISTS idx_cache_file ON provider_cache(file_path);
CREATE INDEX IF NOT EXISTS idx_cache_stale ON provider_cache(cached_at);
```

Operations:
- `getCachedContext(filePath)` -> all provider results for a file
- `setCachedContext(provider, filePath, content, ttl)` -> upsert
- `pruneStaleCache()` -> DELETE WHERE cached_at + ttl < now()
- `warmCache(provider, entries[])` -> bulk INSERT OR REPLACE

## Providers

### Tier 1: Internal (zero external calls, always available)

| Provider | Source | Latency | Budget |
|----------|--------|---------|--------|
| `engram:structure` | Graph SQLite | <50ms | 250 tokens |
| `engram:mistakes` | Graph SQLite | <10ms | 50 tokens |
| `engram:git` | Cached git data | <5ms | 50 tokens |

### Tier 2: External (cached in SQLite, resolved at SessionStart)

| Provider | Source | Cache Latency | Live Latency | Budget |
|----------|--------|--------------|-------------|--------|
| `mempalace` | ChromaDB via execFile | <5ms | ~400ms | 100 tokens |
| `context7` | HTTP API via mcp-context7 | <5ms | ~500ms | 100 tokens |
| `obsidian` | HTTP localhost:27124 | <5ms | ~50ms | 50 tokens |

### Total token budget per Read interception: ~600 tokens max

Priority ordering (if budget exceeded): structure > mistakes > mempalace > context7 > git > obsidian

## Provider Interface

```typescript
interface ContextProvider {
  readonly name: string;
  readonly tier: 1 | 2;

  // Resolve context for a specific file. Returns null if nothing relevant.
  resolve(
    filePath: string,
    nodeContext: NodeContext
  ): Promise<ProviderResult | null>;

  // Bulk warmup: resolve context for all files in the project.
  // Called at SessionStart. Only Tier 2 providers implement this.
  warmup?(projectRoot: string): Promise<WarmupResult>;

  // Token budget for this provider's output.
  readonly tokenBudget: number;

  // Timeout for live resolution (cache miss path).
  readonly timeoutMs: number;
}

interface ProviderResult {
  provider: string;
  content: string;      // formatted text, within tokenBudget
  confidence: number;   // 0-1, used for priority ordering
  cached: boolean;
}

interface WarmupResult {
  entries: Array<{ filePath: string; content: string }>;
  durationMs: number;
}

interface NodeContext {
  filePath: string;
  projectRoot: string;
  nodeIds: string[];      // nodes in this file
  imports: string[];      // detected import packages
  hasTests: boolean;      // whether test file exists
  churnRate: number;      // from git miner
}
```

## Auto-Link Detection

Context links are auto-generated at mine time (zero user effort):

| Source Code Pattern | Provider Link |
|--------------------|--------------|
| `import X from 'package'` | context7 -> `package` docs |
| `require('package')` | context7 -> `package` docs |
| Package in `package.json` deps | context7 -> all deps (bulk at SessionStart) |
| `TODO:`, `FIXME:`, `HACK:` comments | mempalace -> search comment text |
| File path matches vault project | obsidian -> project notes |
| Function has mistake memory entry | engram:mistakes (already linked) |
| File in git history | engram:git (already available) |

Detection runs during `engram init` / re-mine. Results stored as metadata on graph nodes:

```sql
-- New column on nodes table
ALTER TABLE nodes ADD COLUMN context_links TEXT;
-- JSON array: [{"provider":"context7","query":"jsonwebtoken"}]
```

## Manual Override

`.engram/providers.json` (optional, created by user):

```json
{
  "providers": {
    "mempalace": { "enabled": true },
    "context7": { "enabled": true },
    "obsidian": { "enabled": true, "vault": "~/vault" }
  },
  "rules": [
    {
      "pattern": "src/billing/**",
      "mempalace_query": "billing architecture decisions"
    },
    {
      "pattern": "*.test.ts",
      "context7_library": "vitest"
    }
  ],
  "disabled_providers": [],
  "token_budget": 600
}
```

## Rich Packet Format

Example output for `src/auth/middleware.ts`:

```
[engram] Rich context for src/auth/middleware.ts (6 providers, 487 tokens)

STRUCTURE (5 nodes, confidence 0.85):
  NODE validateToken() [function] L42-67
  NODE checkPermissions() [function] L70-95
  NODE rateLimiter [variable] L12
  EDGE validateToken --calls--> jwt.verify (jsonwebtoken)
  EDGE validateToken --calls--> checkPermissions

DECISIONS (mempalace, cached 2h ago):
  - JWT chosen over session cookies (2026-01-20, security + stateless)
  - Refresh token rotation added (2026-03-05, compliance)

LIBRARY (context7: jsonwebtoken@9.0.0):
  jwt.verify(token, secretOrPublicKey, [options]): decoded payload
  options.algorithms: ['HS256'] recommended
  Throws: JsonWebTokenError, TokenExpiredError, NotBeforeError

KNOWN ISSUES (engram:mistakes):
  ! Doesn't handle expired refresh tokens (flagged 2026-03-15)

CHANGES (engram:git):
  Last modified: 3d ago by nick (added rate limiting)
  Churn: 0.12 (stable) | 4 changes in 30d

PROJECT (obsidian):
  Related: vault/03-PROJECTS/myapp/auth-design.md
```

## Cache Warmup Strategy

### SessionStart Flow

```typescript
async function warmProviderCache(projectRoot: string): Promise<void> {
  const store = getStore(projectRoot);
  const allNodes = store.getNodesByKind("file");
  const allImports = store.getAllImportEdges();

  // Phase 1: Detect what we need (sync, fast)
  const context7Queries = dedupeImports(allImports); // unique packages
  const mempalaceQuery = store.getProjectName();
  const obsidianVault = getObsidianVault(); // from providers.json or default

  // Phase 2: Resolve in parallel with per-provider timeouts
  const results = await Promise.allSettled([
    warmMempalace(mempalaceQuery, projectRoot),    // 200ms timeout
    warmContext7(context7Queries, projectRoot),      // 500ms timeout
    warmObsidian(obsidianVault, projectRoot),        // 200ms timeout
  ]);

  // Phase 3: Cache results (failures silently skipped)
  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      store.warmCache(result.value.provider, result.value.entries);
    }
  }

  // Phase 4: Prune stale entries
  store.pruneStaleCache();
}
```

### Lazy Resolution (Cache Miss on Read)

```typescript
async function resolveProviderLive(
  provider: ContextProvider,
  filePath: string,
  context: NodeContext
): Promise<ProviderResult | null> {
  try {
    const result = await withTimeout(
      provider.resolve(filePath, context),
      provider.timeoutMs
    );
    if (result) {
      // Cache for next time
      store.setCachedContext(provider.name, filePath, result.content, 3600);
    }
    return result;
  } catch {
    // Timeout or error -> return null (Approach B: hint only)
    return null;
  }
}
```

## Implementation Plan

### Wave 1: Foundation (this session)
- [x] Remove phantom graphology dependency
- [ ] Fix getAllNodes() full scan in renderFileStructure
- [ ] Fix getAllNodes() full scan in scoreNodes
- [ ] Fix Go import false positives
- [ ] Fix TS arrow function false positives
- [ ] Exclude comment lines from patterns
- [ ] Sort edges by degree before slice
- [ ] Escape LIKE wildcards
- [ ] Calibrate confidence to 0.85

### Wave 2: Provider Cache (next session, ~6 hours)
- [ ] Add provider_cache table to store.ts
- [ ] Implement getCachedContext / setCachedContext / pruneStaleCache / warmCache
- [ ] Add context_links column to nodes table
- [ ] Tests for cache operations

### Wave 3: Provider Implementations (~8 hours)
- [ ] ContextProvider interface in src/providers/types.ts
- [ ] engram:structure provider (refactor existing renderFileStructure)
- [ ] engram:mistakes provider (refactor existing mistake lookup)
- [ ] engram:git provider (new — extract recent changes, blame)
- [ ] mempalace provider (execFile mcp-mempalace + cache)
- [ ] context7 provider (execFile mcp-context7 + cache)
- [ ] obsidian provider (HTTP fetch + cache)
- [ ] Tests for each provider

### Wave 4: Integration (~6 hours)
- [ ] Auto-link detection in ast-miner (import -> context7, TODO -> mempalace)
- [ ] Rich packet formatter (assemble from all providers)
- [ ] SessionStart cache warmup integration
- [ ] Read handler: resolve from cache, fallback to live, fallback to hint
- [ ] .engram/providers.json config loading
- [ ] Integration tests

### Wave 5: Ship (~4 hours)
- [ ] Benchmark harness (before/after Context Spine comparison)
- [ ] ECP spec v0.1 (markdown RFC)
- [ ] Continue.dev Context Provider adapter
- [ ] `engram gen cursor` MDC generation
- [ ] v1.0.0 tag + CHANGELOG
- [ ] README rewrite with Context Spine story

## Token Savings Projection

| Scenario | Calls/File | Tokens/File | Session (50 files) | vs Baseline |
|----------|-----------|-------------|--------------------|-----------| 
| No engram | 5 | ~5,300 | ~265,000 | — |
| engram v0.4 (graph only) | 4 | ~4,300 | ~215,000 | -19% |
| **engram v1.0 (Context Spine)** | **1** | **~550** | **~27,500** | **-90%** |

## Success Criteria

- [ ] Cached Read interception completes in <100ms (p95)
- [ ] Cold Read interception completes in <500ms (p95)
- [ ] SessionStart warmup completes in <10s for a 5k-node project
- [ ] Token savings >= 85% session-level on benchmark suite
- [ ] Zero regression in existing test suite
- [ ] Graceful degradation: all providers down = existing behavior (graph only)
- [ ] Zero new native dependencies (pure JS/WASM only)

## Non-Negotiables

1. **Local-first always** — providers that need network (Context7) cache locally and work offline from cache
2. **Errors never block** — any provider failure = skip that section, passthrough safety invariant intact
3. **Privacy invariant** — user prompt content never transmitted to providers. Only file paths and symbol names.
4. **Zero native deps** — no NAPI modules. MemPalace via execFile, Context7 via execFile, Obsidian via HTTP.
5. **Backward compatible** — users without providers.json get existing behavior plus auto-detected links
