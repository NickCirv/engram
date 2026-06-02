# engramx — domain glossary

Canonical vocabulary for the engramx codebase. Adopt these terms verbatim; do not invent synonyms once a term is defined here.

## Core terms

**engramx**
The npm package and CLI binary. Published as `engramx` on npm. The repo is `NickCirv/engram` on GitHub. Always refer to the package as "engramx" in user-facing docs; "engram" is acceptable for the broader project/concept.
_Avoid:_ engram-cli, engrammer

**graph.db**
The local SQLite knowledge graph at `<project>/.engram/graph.db`. Holds entities, relationships, mistakes, telemetry. Schema version is in PRAGMA `user_version`; current is v9.
_Avoid:_ engram database, the index

**Mistake**
A bi-temporal record (since schema v9) representing a past failure that should be surfaced as a ⚠️ warning in queries. Has `valid_from` (when learned) and `invalid_at` (when superseded/forgiven). NULL `invalid_at` = still active.
_Avoid:_ bug, failure record

**Provider**
A context source pluggable into engramx that resolves a packet on demand (structure, mistakes, git, mempalace, context7, obsidian). NOT an LLM provider.
_Avoid:_ source, plugin (provider is the load-bearing word)

**Spine**
The universal-bridge architecture as of v3.4+. The single engramx daemon (or stateless CLI calls) services every IDE: Anthropic Claude Code, Cursor, Cline, VS Code, OpenVSX. JSON-over-WebSocket per RFC-0001, ed25519-signed, ~150 LoC pure-JS JCS, append-only audit log.
_Avoid:_ bridge (too generic), the integration

**Hook**
A Claude Code / IDE-side process spawned on PreToolUse / SessionStart / CwdChanged / PreCompact that calls engramx. Six default hooks are auto-installed by `engram init`. Stored in `.claude/settings.json` or per-IDE equivalent.
_Avoid:_ middleware (Vercel/web term), interceptor (ambiguous with `engram intercept`)

**Mesh**
Multi-machine distribution layer (Phase 1 merged 2026-05-02). Append-only audit log, ed25519 signatures, JCS canonicalisation. Three CLI commands: `mesh init / status / audit`.
_Avoid:_ federation (we use the word "federated" only for the older single-machine cluster mode)

**MCP plugin contract**
The engramx interface exposed via the official Model Context Protocol. Generic aggregator across multiple MCP clients. NOT a custom protocol — strict MCP compliance.
_Avoid:_ MCP server (we ARE a server, but the term "contract" emphasises the schema)

## Relationships

- A **graph.db** holds many **Mistakes** and many entities/relations
- **Providers** read from many sources, write to **provider_cache** (SQLite)
- **Hooks** invoke engramx; engramx writes telemetry to `.engram/hook-log.jsonl`
- The **Spine** services all IDE-side **Hooks** uniformly
- **Mesh** propagates **Mistakes** + commits across machines

## Flagged ambiguities (resolved)

- "engram" (npm 0.x squatted package) vs "engramx" (our package): always "engramx" in docs, "engram" only when referring to the CLI command (`engram init`).
- "Hook" vs "Plugin" vs "Provider": Hook = client-side event handler; Plugin = MCP plugin in claude-code; Provider = engramx-internal context source.
- "Index" (rebuilds graph.db) vs "Init" (creates and indexes for the first time): `engram init` is one-shot; `engram index --incremental` is the warm path.

## See also

- `docs/adr/` — versioned decision records (Architecture Decision Records). Read titles before touching the relevant area.
- `README.md` — public-facing pitch and install
- `CHANGELOG.md` — version history with rationale
