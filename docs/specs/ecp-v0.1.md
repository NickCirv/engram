# Engram Context Protocol (ECP) v0.1

> **Status:** Draft RFC
> **Version:** 0.1
> **Date:** 2026-04-17
> **License:** CC-BY 4.0
> **Reference Implementation:** [engramx](https://github.com/NickCirv/engram)

## Abstract

The Engram Context Protocol (ECP) defines a vendor-neutral standard for
hook-based context enrichment in AI coding agents. It specifies how a
context spine intercepts tool calls (Read, Edit, Write, Bash) and replaces
raw file content with a structured context packet assembled from multiple
providers. The goal: reduce session-level token consumption by 85%+ while
increasing context relevance.

## 1. Motivation

AI coding agents spend the majority of their token budget on raw file reads.
A typical 50-file session consumes ~265,000 tokens reading files, of which
>80% is irrelevant to the current task. Current approaches have fundamental
limitations:

| Approach | Limitation |
|----------|-----------|
| System prompts | Static. Stale within minutes of a codebase change. |
| `.cursorrules` / `CLAUDE.md` | Manual. Developer must maintain. No semantic awareness. |
| RAG / embeddings | Retrieval-only. No consolidation. No cross-provider assembly. |
| `@`-mention context | Requires user action. Breaks flow. Per-mention latency. |

**Per-Read interception** solves all four: context enriches every file read
automatically, assembled from multiple providers in parallel, cached at
session start, served in <5ms.

## 2. Architecture

```
Agent Request: Read("src/auth.ts")
         │
         ▼
┌─────────────────────────┐
│   Hook Interceptor      │
│   (PreToolUse:Read)     │
│                         │
│  ┌───────────────────┐  │
│  │  Context Spine    │  │
│  │  Resolver Engine  │  │
│  └───────┬───────────┘  │
│          │              │
│    ┌─────┴─────┐       │
│    ▼     ▼     ▼       │
│  ┌───┐ ┌───┐ ┌───┐    │
│  │T1 │ │T1 │ │T2 │    │  T1 = internal (graph-local)
│  │   │ │   │ │   │    │  T2 = external (cached)
│  └───┘ └───┘ └───┘    │
│                         │
│  Assemble within budget │
│  Return ContextPacket   │
└─────────────────────────┘
         │
         ▼
Agent receives: enriched structural summary
(not raw file content)
```

## 3. ContextPacket Schema

A ContextPacket is the output of the resolver engine for a single file read.

```typescript
interface ContextPacket {
  /** Assembled text with all provider sections. */
  readonly text: string;
  /** Number of providers that contributed. */
  readonly providerCount: number;
  /** Names of providers that contributed. */
  readonly providers: readonly string[];
  /** Estimated token count of the assembled packet. */
  readonly estimatedTokens: number;
  /** Total resolution time in milliseconds. */
  readonly durationMs: number;
}
```

**Token estimation:** `Math.ceil(text.length / 4)` — rough chars-per-token
approximation. Implementations MAY use a proper tokenizer for precision.

## 4. ContextProvider Interface

Every provider — internal or external — implements this interface:

```typescript
interface ContextProvider {
  /** Provider identifier (e.g., 'mempalace', 'engram:structure'). */
  readonly name: string;
  /** Display label for the packet section header. */
  readonly label: string;
  /** 1 = internal (graph-local), 2 = external (cached). */
  readonly tier: 1 | 2;
  /** Maximum tokens this provider may emit per file. */
  readonly tokenBudget: number;
  /** Timeout for live resolution in milliseconds. */
  readonly timeoutMs: number;

  /**
   * Resolve context for a specific file. Returns null if nothing relevant.
   * MUST NOT throw — catch all errors internally and return null.
   */
  resolve(filePath: string, context: NodeContext): Promise<ProviderResult | null>;

  /**
   * Bulk warmup: resolve context for all project files.
   * Called at session start. Tier 1 providers typically skip this.
   * Tier 2 providers use this to pre-fill the cache.
   */
  warmup?(projectRoot: string): Promise<WarmupResult>;

  /**
   * Whether this provider is available in the current environment.
   * Called once at startup. If false, the provider is silently skipped.
   */
  isAvailable(): Promise<boolean>;
}

interface NodeContext {
  readonly filePath: string;
  readonly projectRoot: string;
  readonly nodeIds: readonly string[];
  readonly imports: readonly string[];
  readonly hasTests: boolean;
  readonly churnRate: number;
}

interface ProviderResult {
  readonly provider: string;
  readonly content: string;
  readonly confidence: number;
  readonly cached: boolean;
}

interface WarmupResult {
  readonly provider: string;
  readonly entries: readonly WarmupEntry[];
  readonly durationMs: number;
}

interface WarmupEntry {
  readonly filePath: string;
  readonly content: string;
}
```

### Provider Contract

1. `resolve()` MUST complete within `timeoutMs`. Violations are silently skipped.
2. `resolve()` MUST NOT throw. Any error returns `null`.
3. `resolve()` output MUST fit within `tokenBudget` tokens.
4. `warmup()` is optional. Tier 1 providers (fast, local) typically skip it.
5. `isAvailable()` is called once per session. If `false`, provider is never invoked.

### Provider Priority

When the total assembled packet exceeds the global token budget, providers
are included in priority order. Lower index = higher priority:

```typescript
const PROVIDER_PRIORITY: readonly string[] = [
  "engram:structure",    // Structural summary (functions, classes, edges)
  "engram:mistakes",     // Known landmines in this file
  "mempalace",           // Decisions from semantic memory
  "context7",            // Library/framework documentation
  "engram:git",          // Recent changes and churn
  "obsidian",            // Project notes from knowledge base
];
```

Implementers MAY define custom priority orders. The resolver MUST respect
the total budget regardless of priority.

## 5. Cache Contract

Tier 2 providers (external) MUST cache results to keep per-Read latency
under 100ms. The cache contract:

```typescript
interface CachedContext {
  readonly provider: string;
  readonly filePath: string;
  readonly content: string;
  readonly queryUsed: string;
  readonly cachedAt: number;    // Unix milliseconds
  readonly ttl: number;         // Seconds
}
```

- **Default TTL:** 3600 seconds (1 hour)
- **Warmup:** `SessionStart` event triggers bulk cache fill for all Tier 2 providers
- **Cache miss:** Live-resolve with per-provider timeout. Fallback to stale cache if available.
- **Cache storage:** Local SQLite `provider_cache` table (recommended). Implementers MAY use alternative stores.

## 6. Hook Event Model

ECP defines interception points for the following tool events:

| Event | Hook | Behavior |
|-------|------|----------|
| `PreToolUse:Read` | **Primary** — replace raw file with ContextPacket | Deny with reason (packet as reason text) |
| `PreToolUse:Edit` | Passthrough (allow edit, log for graph update) | Allow |
| `PreToolUse:Write` | Passthrough (allow write, log for graph update) | Allow |
| `PreToolUse:Bash` | Passthrough (allow, log command for session context) | Allow |
| `SessionStart` | Warm caches, inject god nodes and landmines | Inject via additionalContext |
| `UserPromptSubmit` | Inject per-prompt context (task-aware) | Inject via additionalContext |
| `PostToolUse:Edit` | Update graph with edit metadata | No user-visible output |
| `PreCompact` | Re-inject critical context before conversation compression | Inject via additionalContext |
| `CwdChanged` | Switch project context when working directory changes | Internal only |

### Hook Response Format

For `PreToolUse:Read` interception (the primary mechanism):

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "<ContextPacket.text>"
  }
}
```

The agent receives `permissionDecisionReason` as the file's content,
which is the assembled ContextPacket — a structural summary instead of
raw file bytes.

### Passthrough

When the interceptor decides NOT to enrich a read (partial read, binary
file, low-confidence graph coverage, kill switch active), it exits with
no output. The agent tool proceeds normally.

## 7. Safety Invariants

These are NON-NEGOTIABLE. Any ECP implementation MUST enforce all of them:

1. **Fail-open always.** Any error in the hook → passthrough. Never block the agent.
2. **2-second timeout.** Every hook handler completes within 2000ms or falls through.
3. **Kill switch.** `.engram/hook-disabled` file → all hooks exit immediately (no computation).
4. **No prompt leakage.** User prompt content never leaves the process. Only file paths and symbol names are sent to providers.
5. **Partial reads pass through.** If `offset` or `limit` is set, the Read proceeds unchanged — the agent asked for specific lines.
6. **Binary files pass through.** Image, PDF, compiled files are never intercepted.
7. **Errors never propagate.** Every handler is wrapped in try/catch. Errors are logged, never thrown.
8. **No mutation.** Hooks never modify files, graph, or agent state. Read-only enrichment only.
9. **Cache-safe.** Stale cache is better than no response. Cache corruption → clear and rebuild.
10. **Backward compatible.** Agents without ECP support see standard file reads. ECP adds, never removes.

## 8. Token Budget Model

| Level | Budget | Scope |
|-------|--------|-------|
| **Global packet** | 600 tokens | Total assembled ContextPacket per Read |
| **Per-provider** | 50-250 tokens | Individual provider contribution |
| **Per-session** | Configurable | Total tokens injected via SessionStart + prompts |

Budget allocation (reference implementation):

| Provider | Budget | Rationale |
|----------|--------|-----------|
| `engram:structure` | 250 | Structural summary is the primary value |
| `engram:mistakes` | 50 | Landmine warnings are brief but critical |
| `engram:git` | 50 | Recent changes context |
| `mempalace` | 100 | Decision/pattern context from semantic memory |
| `context7` | 100 | Library/framework documentation |
| `obsidian` | 50 | Project notes |

## 9. Conformance Levels

### Level 1: Basic (minimum viable)
- Implements `PreToolUse:Read` interception with at least 1 provider
- Enforces safety invariants 1-3 (fail-open, timeout, kill switch)
- Returns valid ContextPacket schema

### Level 2: Standard
- Implements all Level 1 requirements
- At least 3 providers with priority ordering
- Cache layer with TTL for external providers
- `SessionStart` warmup

### Level 3: Full
- Implements all Level 2 requirements
- All 9 hook events
- `PreCompact` context survival
- Provider auto-tuning from hook-log analysis
- Schema versioning for the graph store

## 10. Reference Implementation

The reference implementation is `engramx` (npm), available at
[github.com/NickCirv/engram](https://github.com/NickCirv/engram).

- **Conformance level:** 3 (Full)
- **Providers:** 6 (structure, mistakes, git, mempalace, context7, obsidian)
- **Hook events:** 9 (all defined in this spec)
- **Measured savings:** See `bench/` for reproducible benchmark results
- **License:** Apache 2.0

## Appendix A: Comparison with Existing Approaches

| Approach | Per-Read? | Multi-provider? | Cached? | Auto? | Standard? |
|----------|-----------|-----------------|---------|-------|-----------|
| `.cursorrules` | No | No | N/A | No | Cursor-only |
| `CLAUDE.md` | No | No | N/A | No | Claude-only |
| Continue `@mention` | No | Yes | No | No | Continue-only |
| Cody semantic search | No | No | Yes | Semi | Cody-only |
| **ECP** | **Yes** | **Yes** | **Yes** | **Yes** | **Vendor-neutral** |

## Appendix B: Extending with Custom Providers

To add a custom provider, implement the `ContextProvider` interface and
register it in the resolver's provider list. Example:

```typescript
const myProvider: ContextProvider = {
  name: "custom:jira",
  label: "TICKETS",
  tier: 2,
  tokenBudget: 80,
  timeoutMs: 200,

  async resolve(filePath, context) {
    // Query JIRA for tickets mentioning this file
    const tickets = await queryJira(filePath);
    if (!tickets.length) return null;
    return {
      provider: "custom:jira",
      content: tickets.map(t => `${t.key}: ${t.summary}`).join("\n"),
      confidence: 0.8,
      cached: false,
    };
  },

  async warmup(projectRoot) {
    // Bulk-fetch all tickets at session start
    const all = await fetchAllTickets(projectRoot);
    return {
      provider: "custom:jira",
      entries: all.map(t => ({ filePath: t.file, content: `${t.key}: ${t.summary}` })),
      durationMs: Date.now() - start,
    };
  },

  async isAvailable() {
    return !!process.env.JIRA_API_TOKEN;
  },
};
```

## Changelog

- **v0.1** (2026-04-17): Initial draft. Schema, provider interface, safety invariants, cache contract, conformance levels.
