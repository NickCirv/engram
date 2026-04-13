<p align="center">
  <img src="assets/banner.png" alt="engram — AI coding memory" width="100%">
</p>

<p align="center">
  <a href="#install"><strong>Install</strong></a> ·
  <a href="#usage"><strong>Usage</strong></a> ·
  <a href="#mcp-server"><strong>MCP Server</strong></a> ·
  <a href="#how-it-works"><strong>How It Works</strong></a> ·
  <a href="docs/INTEGRATION.md"><strong>Integration Guide</strong></a> ·
  <a href="#contributing"><strong>Contributing</strong></a>
</p>

<p align="center">
  <a href="https://github.com/NickCirv/engram/actions"><img src="https://github.com/NickCirv/engram/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/license-Apache%202.0-blue" alt="License">
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node">
  <img src="https://img.shields.io/badge/tests-520%20passing-brightgreen" alt="Tests">
  <img src="https://img.shields.io/badge/LLM%20cost-$0-green" alt="Zero LLM cost">
  <img src="https://img.shields.io/badge/native%20deps-zero-green" alt="Zero native deps">
  <img src="https://img.shields.io/badge/token%20savings-up%20to%2090%25-orange" alt="Up to 90% token savings">
</p>

---

# The context spine for AI coding agents.

**One call replaces five.** engram intercepts file reads and serves rich context packets — structural summaries, decisions, library docs, known issues, and git history — assembled from 6 providers in a single ~500-token response. Your AI agent gets everything it needs without making 5 separate tool calls.

engram installs a hook layer at the Claude Code tool-call boundary. Every `Read`, `Edit`, `Write`, and `Bash cat` gets intercepted. When the graph has confident coverage of a file, it serves a **rich context packet** combining structure, decisions, docs, and history — all pre-assembled, all within budget.

Not a memory tool. Not a RAG layer. **The context spine that connects your knowledge graph, semantic memory, library docs, and project notes into a single context layer your AI agent can't forget to use.**

| What it is | What it isn't |
|---|---|
| Context spine (graph + 6 providers assembled per read) | A single-purpose file summarizer |
| Local SQLite, zero cloud, zero native deps | Vector RAG that phones home |
| Hook-based interception at the tool boundary | A tool the agent has to remember to call |
| Up to 90% session-level token savings | A theoretical benchmark |
| Complements native Claude memory | Competes with native Claude memory |

```bash
npm install -g engramx
cd ~/my-project
engram init             # scan codebase → .engram/graph.db (~40 ms, 0 tokens)
engram install-hook     # wire the Sentinel into Claude Code
```

That's it. The next Claude Code session in that directory automatically:

- **Serves rich context packets** — structure + git changes + decisions + library docs in one response (Context Spine)
- **Warms provider caches at session start** — MemPalace, Context7, Obsidian pre-fetched in background
- **Warns before edits that hit known mistakes** (Edit landmine injection)
- **Pre-loads relevant context when you ask a question** (UserPromptSubmit pre-query)
- **Injects a project brief at session start** with semantic context (SessionStart)
- **Survives context compaction** — re-injects critical nodes before compression (PreCompact)
- **Auto-switches project context** when you navigate to a different repo (CwdChanged)
- **Shows live HUD in Claude Code status bar** — auto-configured on `install-hook`

## Docs

- **[Architecture Diagram](docs/engram-sentinel-ecosystem.pdf)** — 11-page visual walkthrough of the full lifecycle. [HTML version](docs/engram-sentinel-ecosystem.html).
- **[Installation Guide](docs/engram-user-manual.html)** — AAA-designed step-by-step setup guide with experience tiers.
- **[Integration Guide](docs/engram-integration-guide.html)** — how memory tools, compression plugins, and workflow managers integrate with engram. Real token savings numbers + code examples.
- **[INTEGRATION.md](docs/INTEGRATION.md)** — MCP server setup and programmatic API reference.

## The Problem

Every Claude Code session burns ~52,500 tokens on things you already told the agent yesterday. Reading the same files, re-exploring the same modules, re-discovering the same patterns. Even with a great CLAUDE.md, the agent still falls back to `Read` because `Read` is what it knows.

The ceiling isn't the graph's accuracy. It's that the agent has to *remember* to ask. v0.2 of engram was a tool the agent queried ~5 times per session. The other 25 Reads happened uninterrupted.

v0.3 flips this. The hook intercepts at the tool-call boundary, not at the agent's discretion.

```
v0.2: agent → (remembers to call query_graph) → engram returns summary
v0.3: agent → Read → Claude Code hook → engram intercepts → summary delivered
```

**Projected savings: -42,500 tokens per session** (~80% reduction vs v0.2.1 baseline).
Every number is arithmetic on empirically verified hook mechanisms — not estimates.

## Install

```bash
npm install -g engramx
```

Requires Node.js 20+. Zero native dependencies. No build tools needed.

## Quickstart (v0.3 Sentinel)

```bash
cd ~/my-project
engram init                    # scan codebase, build knowledge graph
engram install-hook            # install Sentinel hooks into .claude/settings.local.json
engram hook-preview src/auth.ts  # dry-run: see what the hook would do
```

Open a Claude Code session in that project. When it reads a well-covered file, you'll see a system-reminder with engram's structural summary instead of the full file contents. Run `engram hook-stats` afterwards to see how many reads were intercepted.

```bash
engram hook-stats              # summarize hook-log.jsonl
engram hook-disable            # kill switch (keeps install, disables intercepts)
engram hook-enable             # re-enable
engram uninstall-hook          # surgical removal, preserves other hooks
```

## Experience Tiers

Each tier builds on the previous. You can stop at any level — each one works standalone.

| Tier | What you run | What you get | Token savings |
|---|---|---|---|
| **1. Graph only** | `engram init` | CLI queries, MCP server, `engram gen` for CLAUDE.md | ~6x per query vs reading files |
| **2. + Sentinel hooks** | `engram install-hook` | Automatic Read interception, Edit warnings, session briefs, HUD | ~80% per session |
| **3. + Context Spine** | Configure providers.json | Rich packets: structure + decisions + docs + git in one response | Up to 90% session-level |
| **4. + Skills index** | `engram init --with-skills` | Graph includes your `~/.claude/skills/` — queries surface relevant skills | ~23% overhead on graph size |
| **5. + Git hooks** | `engram hooks install` | Auto-rebuild graph on every `git commit` — graph never goes stale | Zero token cost |

**Recommended full setup** (one-time, per project):

```bash
npm install -g engramx         # install globally
cd ~/my-project
engram init --with-skills      # build graph + index skills
engram install-hook            # wire Sentinel into Claude Code
engram hooks install           # auto-rebuild on commit
```

After this, every Claude Code session in the project automatically gets structural context, landmine warnings, and session briefs — with no manual queries needed.

**Optional — MEMORY.md integration** (v0.3.1+):

```bash
engram gen --memory-md         # write structural facts into Claude's native MEMORY.md
```

This writes a marker-bounded block into `~/.claude/projects/.../memory/MEMORY.md` with your project's core entities and structure. Claude's Auto-Dream owns the prose; engram owns the structure. They complement each other — engram never touches content outside its markers.

## All Commands

### Core (v0.1/v0.2 — unchanged)

```bash
engram init [path]              # Scan codebase, build knowledge graph
engram init --with-skills       # Also index ~/.claude/skills/ (v0.2)
engram query "how does auth"    # Query the graph (BFS, token-budgeted)
engram query "auth" --dfs       # DFS traversal
engram gods                     # Show most connected entities
engram stats                    # Node/edge counts, token savings
engram bench                    # Token reduction benchmark
engram path "auth" "database"   # Shortest path between concepts
engram learn "chose JWT..."     # Teach a decision or pattern
engram mistakes                 # List known landmines
engram gen                      # Generate CLAUDE.md section from graph
engram gen --task bug-fix       # Task-aware view (general|bug-fix|feature|refactor)
engram hooks install            # Auto-rebuild graph on git commit
```

### Sentinel (v0.3+)

```bash
engram intercept                        # Hook entry point (called by Claude Code, reads stdin)
engram install-hook [--scope <s>]       # Install hooks into Claude Code settings
                                        #   --scope local (default, gitignored)
                                        #   --scope project (committed)
                                        #   --scope user (global ~/.claude/settings.json)
engram install-hook --dry-run           # Preview changes without writing
engram uninstall-hook                   # Remove engram entries (preserves other hooks)
engram hook-stats                       # Summarize .engram/hook-log.jsonl
engram hook-stats --json                # Machine-readable output
engram hook-preview <file>              # Dry-run Read handler for a specific file
engram hook-disable                     # Kill switch (touch .engram/hook-disabled)
engram hook-enable                      # Remove kill switch
```

### Infrastructure (v0.4 — new)

```bash
engram watch [path]                     # Live file watcher — incremental re-index on save
engram dashboard [path]                 # Live terminal dashboard (token savings, hit rate, top files)
engram hud [path]                       # Alias for dashboard
engram hud-label [path]                 # JSON label for Claude HUD --extra-cmd integration
```

**Claude HUD integration** — add `--extra-cmd="engram hud-label"` to your Claude HUD statusLine command and see live savings in your Claude Code status bar:

```
⚡engram 48.5K saved ▰▰▰▰▰▰▰▰▱▱ 75%
```

## Context Spine (v0.5 — new)

The Context Spine assembles rich context from 6 providers into a single response per file read:

| Provider | Tier | What it adds | Latency |
|----------|------|-------------|---------|
| `engram:structure` | Internal | Functions, classes, imports, edges | <50ms |
| `engram:mistakes` | Internal | Known bugs and past failures | <10ms |
| `engram:git` | Internal | Last modified, author, churn rate | <100ms |
| `mempalace` | External (cached) | Decisions, learnings, project context | <5ms cached |
| `context7` | External (cached) | Library API docs for imports | <5ms cached |
| `obsidian` | External (cached) | Project notes, architecture docs | <5ms cached |

External providers cache results in SQLite at SessionStart. Per-Read resolution is a cache lookup (<5ms), not a live query. If any provider is unavailable, it's silently skipped — you always get at least the structural summary.

Configure providers in `.engram/providers.json` (optional — auto-detection works for most setups):

```json
{
  "providers": {
    "mempalace": { "enabled": true },
    "context7": { "enabled": true },
    "obsidian": { "enabled": true, "vault": "~/vault" }
  }
}
```

## How the Sentinel Layer Works

Nine hook handlers compose the interception stack:

| Hook | Mechanism | What it does |
|---|---|---|
| **`PreToolUse:Read`** | `deny + permissionDecisionReason` | If the file is in the graph with ≥0.7 confidence, blocks the Read and delivers a ~300-token structural summary as the block reason. Claude sees the reason as a system-reminder and uses it as context. The file is never actually read. |
| **`PreToolUse:Edit`** | `allow + additionalContext` | Never blocks writes. If the file has known past mistakes, injects them as a landmine warning alongside the edit. |
| **`PreToolUse:Write`** | Same as Edit | Advisory landmine injection. |
| **`PreToolUse:Bash`** | Parse + delegate | Detects `cat|head|tail|less|more <single-file>` invocations (strict parser, rejects any shell metacharacter) and delegates to the Read handler. Closes the Bash workaround loophole. |
| **`SessionStart`** | `additionalContext` | Injects a compact project brief (god nodes + graph stats + top landmines + git branch) on source=startup/clear/compact. Bundles mempalace semantic context in parallel if available. Passes through on resume. |
| **`UserPromptSubmit`** | `additionalContext` | Extracts keywords from the user's message, runs a ≤500-token pre-query, injects results. Skipped for short or generic prompts. Raw prompt content is never logged. |
| **`PostToolUse`** | Observer | Pure logger. Writes tool/path/outputSize/success/decision to `.engram/hook-log.jsonl` for `hook-stats`. |
| **`PreCompact`** | `additionalContext` | Re-injects god nodes + active landmines right before Claude compresses the conversation. First tool in the ecosystem whose context survives compaction. |
| **`CwdChanged`** | `additionalContext` | Auto-switches project context when the user navigates to a different repo mid-session. Injects a compact brief for the new project. |

### Ten safety invariants, enforced at runtime

1. Any handler error → passthrough (never block Claude Code)
2. 2-second per-handler timeout
3. Kill switch (`.engram/hook-disabled`) respected by every handler
4. Atomic settings.json writes with timestamped backups
5. Never intercept outside the project root
6. Never intercept binary files or secrets (.env, .pem, .key, credentials, id_rsa, ...)
7. Never log user prompt content (privacy invariant asserted in tests)
8. Never inject >8000 chars per hook response
9. Stale graph detection (file mtime > graph mtime → passthrough)
10. Partial-read bypass (Read with explicit `offset` or `limit` → passthrough)

### What you can safely install

Default scope is `.claude/settings.local.json` — gitignored, project-local, zero risk of committing hook config to a shared repo. Idempotent install. Non-destructive uninstall. `--dry-run` shows the diff before writing.

If anything goes wrong, `engram hook-disable` flips the kill switch without uninstalling.

## How It Works

engram runs three miners on your codebase. None of them use an LLM.

**Heuristic Code Miner** — Extracts code structure (classes, functions, imports, exports, call patterns) using regex heuristics across 10 languages: TypeScript, JavaScript, Python, Go, Rust, Java, C, C++, Ruby, PHP. Confidence-scored (0.85 for regex extraction, 1.0 reserved for future tree-sitter). Zero tokens, deterministic, cached.

**Git Miner** — Reads `git log` for co-change patterns (files that change together), hot files (most frequently modified), and authorship. Creates INFERRED edges between structurally coupled files.

**Session Miner** — Scans CLAUDE.md, .cursorrules, AGENTS.md, and `.engram/sessions/` for decisions, patterns, and mistakes your team has documented. Stores these as queryable graph nodes.

Results are stored in a local SQLite database (`.engram/graph.db`) and queryable via CLI, MCP server, or programmatic API.

## MCP Server

Connect engram to Claude Code, Windsurf, or any MCP client:

```json
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": ["-y", "engramx", "serve", "/path/to/your/project"]
    }
  }
}
```

Or if installed globally:

```json
{
  "mcpServers": {
    "engram": {
      "command": "engram-serve",
      "args": ["/path/to/your/project"]
    }
  }
}
```

**MCP Tools** (6 total):
- `query_graph` — Search the knowledge graph with natural language
- `god_nodes` — Core abstractions (most connected entities)
- `graph_stats` — Node/edge counts, confidence breakdown
- `shortest_path` — Trace connections between two concepts
- `benchmark` — Token reduction measurement
- `list_mistakes` — Known failure modes from past sessions (v0.2)

### Shell Wrapper (for Bash-based agents)

If your agent stack runs shell commands instead of JSON-RPC MCP, use the reference wrapper at [`scripts/mcp-engram`](scripts/mcp-engram). One command handles all projects via `-p <path>` — no per-project MCP server needed.

```bash
cp scripts/mcp-engram ~/bin/mcp-engram && chmod +x ~/bin/mcp-engram
mcp-engram query "how does auth work" -p ~/myrepo
```

See [`docs/INTEGRATION.md`](docs/INTEGRATION.md) for multi-machine setups, rule-file integration, and gotchas.

## Auto-Generated AI Instructions

After building a graph, run:

```bash
engram gen                    # Auto-detect CLAUDE.md / .cursorrules / AGENTS.md
engram gen --target claude    # Write to CLAUDE.md
engram gen --target cursor    # Write to .cursorrules
engram gen --target agents    # Write to AGENTS.md
```

This writes a structured codebase summary — god nodes, file structure, key dependencies, decisions — so your AI assistant navigates by structure instead of grepping.

### Task-Aware Views (v0.2)

`engram gen --task <name>` emits different content based on what you're about to do. The four preset views are defined in `src/autogen.ts` as a data table — no branching logic — so you can add your own task modes without touching the renderer.

```bash
engram gen --task general     # default — balanced mix of sections
engram gen --task bug-fix     # emphasizes hot files + past mistakes
engram gen --task feature     # emphasizes architecture + decisions
engram gen --task refactor    # emphasizes god nodes + dependency graph
```

Each view picks a different set of sections with different limits. For example, `bug-fix` omits `## Decisions` and `## Key dependencies` entirely (they'd just be noise when you're chasing a regression) and leads with `🔥 Hot files` and `⚠️ Past mistakes`.

## How engram Compares

| | engram | Mem0 | Graphify | aider repo-map | CLAUDE.md |
|---|---|---|---|---|---|
| **Code structure** | AST extraction (10 langs) | No | Yes (tree-sitter) | Yes (tree-sitter) | No |
| **Persistent memory** | SQLite graph, survives sessions | Yes (vector + graph) | Static snapshot | Per-session only | Manual text file |
| **Session learning** | Mines decisions, patterns, mistakes | Generic facts | No | No | You write it by hand |
| **Universal** | MCP + CLI + auto-gen | API only | Claude Code only | aider only | Claude Code only |
| **LLM cost** | $0 | $0 (self-host) / paid cloud | Tokens for docs/images | Per-session | $0 |
| **Code-specific** | Built for codebases | Generic AI memory | Yes | Yes | No |
| **Temporal** | Git history mining | No | No | No | No |

**The gap nobody fills:** Code-structural understanding + persistent cross-session learning + temporal awareness + works with every AI tool. engram is the first to combine all four.

## Confidence System

Every relationship in the graph is tagged:

| Tag | Meaning | Score |
|-----|---------|-------|
| **EXTRACTED** | Found directly in source code (import, function definition) | 1.0 |
| **INFERRED** | Reasoned from patterns (git co-changes, session decisions) | 0.4-0.9 |
| **AMBIGUOUS** | Uncertain, flagged for review | 0.1-0.3 |

You always know what was found vs guessed.

## Token Savings

engram reports two honest baselines:

- **vs relevant files** — compared to reading only the files that match your query. This is the fair comparison. Typical: **3-11x** fewer tokens.
- **vs full corpus** — compared to sending your entire codebase. This is the worst case you're avoiding. Typical: **30-400x** fewer tokens.

Both are reported transparently. No inflated claims.

## Git Hooks

Auto-rebuild the graph on every commit:

```bash
engram hooks install     # Install post-commit + post-checkout hooks
engram hooks status      # Check installation
engram hooks uninstall   # Remove hooks
```

Code changes trigger an instant AST rebuild (no LLM, <50ms). The graph stays fresh without manual re-runs.

## Programmatic API

```typescript
import { init, query, godNodes, stats } from "engram";

// Build the graph
const result = await init("./my-project");
console.log(`${result.nodes} nodes, ${result.edges} edges`);

// Query it
const answer = await query("./my-project", "how does auth work");
console.log(answer.text);

// Get god nodes
const gods = await godNodes("./my-project");
for (const g of gods) {
  console.log(`${g.label} — ${g.degree} connections`);
}
```

## Architecture

```
src/
├── cli.ts                 CLI entry point
├── core.ts                API surface (init, query, stats, learn)
├── serve.ts               MCP server (5 tools, JSON-RPC stdio)
├── hooks.ts               Git hook install/uninstall
├── autogen.ts             CLAUDE.md / .cursorrules generation
├── graph/
│   ├── schema.ts          Types: nodes, edges, confidence
│   ├── store.ts           SQLite persistence (sql.js, zero native deps)
│   └── query.ts           BFS/DFS traversal, shortest path
├── miners/
│   ├── ast-miner.ts       Code structure extraction (10 languages)
│   ├── git-miner.ts       Change patterns from git history
│   └── session-miner.ts   Decisions/patterns from AI session docs
└── intelligence/
    └── token-tracker.ts   Cumulative token savings measurement
```

## Supported Languages

TypeScript, JavaScript, Python, Go, Rust, Java, C, C++, Ruby, PHP.

## Roadmap

### v0.2 (current) — **shipped April 2026**
- ✅ Skills miner — index `~/.claude/skills/` into the graph
- ✅ Adaptive gen — task-aware views (`--task general|bug-fix|feature|refactor`)
- ✅ Regret buffer — surface past mistakes at the top of query results
- ✅ `list_mistakes` MCP tool
- ✅ Atomic init lockfile
- ✅ Marker-safe `writeToFile` + surrogate-safe truncation

### v0.3
- Tree-sitter WASM (20+ languages with full call-graph precision)
- Cross-project graph (query patterns across *all* your projects)
- Temporal graph (commit-snapshot deltas — "what changed in auth this week?")
- Token enforcement PreToolUse hook for Claude Code

### v0.4+
- LLM-free semantic search (locality-sensitive hashing over n-grams)
- Graph-as-IR experimental spike
- Team memory sync (paid tier)

## Privacy

Everything runs locally. No data leaves your machine. No telemetry. No cloud. The only network call is `npm install`.

## License

Apache 2.0

## Contributing

Issues and PRs welcome. Run `engram init` on a real codebase and share what it got right and wrong.
