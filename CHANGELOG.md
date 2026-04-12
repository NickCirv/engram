# Changelog

All notable changes to engram are documented here. Format based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] — 2026-04-12 — "Infrastructure"

### Added

- **PreCompact hook** — re-injects god nodes, active landmines, and
  graph stats right before Claude Code compresses the conversation.
  This is the first tool in the ecosystem whose context survives
  compaction. No other tool does this.
- **CwdChanged hook** — auto-switches project context when the user
  navigates to a different directory mid-session. Injects a compact
  brief for the new project so subsequent interceptions route to the
  correct graph.
- **File watcher** (`engram watch`) — incremental re-indexing via
  `fs.watch`. On file save, clears old nodes for that file and
  re-extracts fresh AST nodes. 300ms debounce, ignored directories
  (node_modules, .git, dist, etc.), extension whitelist. Zero native
  dependencies. Eliminates manual `engram init` for graph freshness.
- **Mempalace integration** — SessionStart brief now queries
  `mcp-mempalace` for semantic context about the project and bundles
  top 3 findings alongside the structural brief. Runs in parallel
  with graph queries (async execFile, 1.5s timeout). Graceful
  degradation if mempalace is not installed.
- **`deleteBySourceFile`** method on GraphStore — transactional
  deletion of all nodes and edges for a given source file. Used by
  the file watcher for incremental re-indexing.
- **`edges.source_file` index** — enables fast lookups when the
  watcher deletes by file. Without this, `deleteBySourceFile` would
  do a full table scan.

### Changed

- Hook count: 7 → 9 (added PreCompact, CwdChanged).
- Installer now registers 6 hook events (was 4).
- Test count: 467 → 486 (+19 new tests for PreCompact, CwdChanged,
  file watcher, dispatch routing).

## [0.3.2] — 2026-04-12 — "Cross-Platform"

### Fixed

- **Windows path portability** — Graph `sourceFile` entries now stored
  in POSIX form (`src/auth.ts`, not `src\auth.ts`) via new
  `toPosixPath()` in `src/graph/path-utils.ts`. All lookup sites
  (`getFileContext`, `handleEditOrWrite`, `extractFile`) normalize
  consistently. Without this, Sentinel on Windows would passthrough
  every Read (zero interception). Credit: ultrathink (shahe-dev).
- **CRLF handling in skills-miner YAML parser** — `parseYaml` now
  strips `\r` before splitting, fixing silent failures on Windows
  clones with `core.autocrlf=true` where `description: >` was
  misread as `description: >\r`.
- **libuv assertion crash on Node 25 Windows** — Replaced
  `process.exit(0)` in `engram intercept` with `process.exitCode = 0`
  + natural event-loop drain. The prior code raced against sql.js
  WASM handle cleanup, triggering `UV_HANDLE_CLOSING` assertion
  (`0xC0000409`) on Windows + Node 25.
- **`isHardSystemPath` now platform-aware** — Detects Windows UNC
  device paths (`//./`, `//?/`), `C:\Windows\`, and `C:\Program Files`
  in addition to POSIX `/dev/`, `/proc/`, `/sys/`. Tests no longer
  skip on win32.
- **Double drive-letter bug** — Test files using
  `new URL(".", import.meta.url).pathname` now use `fileURLToPath()`
  which prevents `/C:/Users/...` → `C:\C:\Users\...` on Windows.

### Added

- **Experience Tiers in README** — New section showing the 4 tiers of
  value (graph → Sentinel → skills → git hooks) with token savings per
  tier and a recommended full-setup block.
- **Post-init nudge** — `engram init` now detects whether Sentinel hooks
  are installed and suggests `engram install-hook` if not, closing the
  silent drop-off gap where users get 6x savings instead of 82%.
- **Windows CI matrix** — GitHub Actions now runs on both
  `ubuntu-latest` and `windows-latest` with Node 20 + 22.

### Changed

- Test count: 466 → 467 (added Windows system-path test cases).

## [0.3.1] — 2026-04-12 — "Structural"

### Added

- **TF-IDF keyword filter on `UserPromptSubmit` hook.** The pre-query
  path now computes inverse document frequency against graph node
  labels and requires at least one keyword with IDF ≥ 1.386 (25%
  cutoff) before injecting context. Kills the "76-node noise bug"
  where common-term prompts poisoned sessions on mature graphs.
  New `computeKeywordIDF` helper in `src/core.ts`. Falls back to
  raw keywords if IDF computation returns empty. 3 new tests.
- **`engram memory-sync` CLI command.** Writes engram's structural
  facts (god nodes, landmines, graph stats, branch) into a
  marker-bounded block inside Anthropic's native `MEMORY.md` file.
  Uses `<!-- engram:structural-facts:start/end -->` markers so
  Auto-Dream owns prose memory and engram owns structure —
  complementary, not competitive. New `src/intercept/memory-md.ts`
  module (pure builder + upsert + atomic write). 16 new tests.
  Supports `--dry-run` and `--project`.
- **Cursor adapter scaffold** (`src/intercept/cursor-adapter.ts`).
  New `engram cursor-intercept` CLI command wraps the existing
  `handleRead` logic in Cursor 1.7's `beforeReadFile` response
  shape (`{ permission, user_message }`). Experimental — full
  Cursor wire-up lands in v0.3.2. 8 new tests.
- **EngramBench v0.1** — reproducible benchmark scaffold in
  `bench/`. Ten structural tasks (find caller, parent class,
  import graph, refactor scope, cross-file flow, etc.) defined as
  YAML files with prompts, scoring rubrics, and expected tokens
  per setup (baseline / cursor-memory / anthropic-memorymd /
  engram). `bench/run.sh` runner + `bench/results/TEMPLATE.csv`.
  v0.2 will automate the runner and publish a leaderboard.
- **Rebrand to "the structural code graph"** — package description,
  keywords, and README hero rewritten to lead with structural
  memory rather than the generic "memory" framing.

### Fixed

- False-positive context injections on large graphs where prompts
  contained common graph terms (the "76-node noise bug" from
  v0.3.0 real-session data).

### Tests

- 466 tests passing (up from 442 in v0.3.0).
- 27 new tests across 3 files (TF-IDF, MEMORY.md, Cursor adapter).

### Notes

- Zero new runtime dependencies.
- Schema unchanged from v0.3.0.
- No breaking changes. v0.3.0 users upgrade cleanly.

## [0.3.0] — 2026-04-11 — "Sentinel"

### Added — The Claude Code Hook Interception Layer

**The big change:** engram is no longer just a tool your agent queries.
It's now a Claude Code hook layer that intercepts file reads, edits,
prompts, and session starts — automatically replacing full file reads
with ~300-token structural graph summaries when confidence is high.

Empirically verified on 2026-04-11 against a live Claude Code session.
The hook mechanism is `PreToolUse deny + permissionDecisionReason`,
which Claude Code delivers to the agent as a system-reminder containing
the engram summary. File is never actually read, so savings materialize
at the agent-turn layer, not just when the agent remembers to ask.

**Seven new CLI commands:**

- `engram intercept` — hook entry point. Reads JSON from stdin,
  dispatches through the handler registry, writes response JSON to
  stdout. ALWAYS exits 0 — the process boundary enforces the "never
  block Claude Code" invariant.
- `engram install-hook [--scope local|project|user] [--dry-run]` —
  adds engram's entries to a Claude Code settings file. Default scope
  is `local` (project-local, gitignored). Preserves existing non-engram
  hooks. Idempotent. Atomic write with timestamped backup.
- `engram uninstall-hook` — surgical removal.
- `engram hook-stats [--json]` — summarize `.engram/hook-log.jsonl`
  with per-event / per-tool / per-decision breakdowns and estimated
  token savings.
- `engram hook-preview <file>` — dry-run the Read handler for a file
  without installing. Shows deny+summary, allow+landmines, or
  passthrough with explanation.
- `engram hook-disable` / `engram hook-enable` — toggle
  `.engram/hook-disabled` kill switch.

**Seven new hook handlers:**

- `PreToolUse:Read` — deny + reason with engram's structural summary.
  60% hit rate × ~1,200 tokens saved per hit. Projected: -18,000
  tokens per session.
- `PreToolUse:Edit` / `PreToolUse:Write` — allow + additionalContext
  with landmine warnings for files with past mistakes. NEVER blocks
  writes — advisory injection only. Projected: -10,000 tokens by
  preventing bug re-loops.
- `PreToolUse:Bash` — strict parser for single-argument `cat|head|tail
  |less|more <file>` invocations, delegating to the Read handler. Any
  shell metacharacter rejects the parse. Closes the Bash workaround
  loophole without risking shell misinterpretation.
- `SessionStart` — injects a project brief (god nodes + graph stats
  + top landmines + git branch) on source=startup/clear/compact.
  Passes through on source=resume. Replaces 3-5 initial exploration
  reads. Projected: -5,000 tokens per session.
- `UserPromptSubmit` — keyword-gated pre-query injection. Extracts
  significant terms (≥3 chars, non-stopword), requires ≥2 terms AND
  ≥3 graph matches before injecting. Budget 500 tokens per injection.
  **PRIVACY:** raw prompt text is never logged. Projected: -8,000
  tokens per session.
- `PostToolUse` — pure observer. Logs tool/path/outputSize/success
  to `.engram/hook-log.jsonl` for `engram hook-stats` and v0.3.1
  self-tuning.

**Total projected savings: -42,500 tokens per session** (on ~52,500
baseline ≈ 80% session reduction). Every number is arithmetic on
empirically verified hook mechanisms.

### Added — Infrastructure

- **`src/intercept/` module (14 files):** safety.ts (error/timeout
  wrappers, PASSTHROUGH sentinel, kill-switch check), context.ts
  (path normalization, project detection, content safety, cwd guard),
  formatter.ts (verified JSON response builders with 8000-char
  truncation), dispatch.ts (event routing + PreToolUse decision
  logging), installer.ts (pure settings.json transforms), stats.ts
  (pure log aggregation), and 7 handlers under `handlers/`.

- **`src/intelligence/hook-log.ts`:** append-only JSONL logger with
  10MB rotation. Atomic appends (safe for <4KB writes on POSIX
  without locking). `readHookLog` for stats queries. Never throws.

- **10 safety invariants, all enforced at runtime:**
  1. Any handler error → passthrough (never block Claude Code)
  2. 2-second per-handler timeout
  3. Kill switch respected by all handlers
  4. Atomic settings.json writes with backups
  5. Never intercept outside project root
  6. Never intercept binary files or secrets (.env/.pem/.key)
  7. Never log user prompt content
  8. Never inject >8000 chars per hook response
  9. Stale graph detection (file mtime > graph mtime → passthrough)
  10. Partial-read bypass (offset/limit → passthrough)

### Changed

- `core.ts::mistakes()` now accepts an optional `sourceFile` filter for
  per-file landmine lookup.
- `getFileContext()` added — the bridge from absolute file paths (as
  hooks receive them) to graph queries. Never throws.
- `renderFileStructure()` added to `graph/query.ts` — file-scoped
  summary renderer. Exposes `codeNodeCount` for accurate confidence.
- Confidence formula: `min(codeNodeCount / 3, 1) × avgNodeConfidence`.
  Conservative 0.7 threshold for interception.
- Dispatcher logs PreToolUse decisions to hook-log for `hook-stats`.
- Minor terminology: user-facing comments and docs now say "landmines"
  instead of "regret buffer" (internal API unchanged — `mistakes()`,
  `list_mistakes` MCP tool, `kind: "mistake"` schema all stable).

### Test coverage

- **+225 tests** across Days 1-5 (total 439, up from 214 in v0.2.1).
- Full suite time: ~1.5 seconds.
- 7 end-to-end subprocess tests that actually spawn
  `node dist/cli.js intercept` and pipe JSON payloads.
- 4 regression fixtures captured from the 2026-04-11 live spike.
- NEVER-deny invariant asserted for Edit/Write handler in tests.
- PRIVACY invariant asserted for UserPromptSubmit handler in tests.

### Deferred to v0.3.1

- **Grep interception.** Regex metacharacters + string-literal searches
  mean engram can't correctly handle every grep.
- **Per-user confidence threshold config.** v0.3.0 hardcodes 0.7.
- **Self-tuning from hook-log data.** Will tune 2.5x mistake boost,
  0.5x keyword downweight, 0.7 confidence threshold, coverage ceiling.

### Migration

**No migration needed.** v0.3.0 is purely additive. All v0.2.1 CLI
commands work identically. MCP tools (`query_graph`, `god_nodes`,
`graph_stats`, `shortest_path`, `benchmark`, `list_mistakes`) are
unchanged. The hook layer is opt-in via `engram install-hook`.

Existing engram projects continue to work without reinstalling.

## [0.2.1] — 2026-04-10

### Fixed

- **`--with-skills` query token regression.** v0.2.0 shipped with a
  silent 5x token cost when `engram init --with-skills` was used —
  query avg went from 406 tokens (without skills) to 1,978 tokens
  (with skills), and the `vs relevant files` savings metric collapsed
  from 4.8x to 0x. The regression was discovered during post-release
  real-world benchmarking on 6 indexed projects.

  Root cause: `scoreNodes` treated keyword concept nodes (trigger-
  phrase routing intermediaries created by the skills-miner) equally
  with code nodes when picking BFS start seeds. A query like "how
  does auth work" would seed BFS from ~30 keyword concepts (auth
  flow, auth header, auth token, etc.), and BFS then pulled in the
  entire skill subgraph via `triggered_by` edges, rendering 2,700+
  nodes worth of noise.

  Three-part fix in `src/graph/query.ts`:
  1. `scoreNodes` downweights keyword concepts by 0.5× so code nodes
     dominate seeding whenever they exist. Keywords remain seed-
     eligible when NO code matches, preserving skill discovery.
  2. `renderSubgraph` filters keyword concepts out of visible output
     entirely (they stay as BFS traversal intermediaries, just
     invisible in the rendered text). Edges touching keyword nodes
     are also skipped to avoid exposing keyword labels via EDGE lines.
  3. **BFS/DFS traversal filter:** `triggered_by` edges are only
     walked when the current frontier node is itself a keyword. This
     prevents skill concepts from pulling in their 30+ inbound
     keyword neighbors via reverse edge expansion — the core
     mechanism of the original bloat. Keywords remain reachable via
     direct text-match seeding; they just stop acting as "inbound
     attractors" for non-keyword traversal.

  Plus a companion filter: `similar_to` edges between skill concepts
  are suppressed from EDGE rendering — skill cross-reference
  metadata adds noise to code-focused queries without structural
  value. Skill NODE lines are still rendered so users asking for
  skill suggestions still see them.

  **Verified real-world impact:**

  | Project | v0.2.0 broken | v0.2.1 fixed | No-skills baseline |
  |---------|---------------|--------------|---------------------|
  | engram  | 1,978 tok / 0x rel | **499 tok / 5.0x rel** | 406 tok / 4.8x rel |
  | scripts | (N/A — not benched with skills in v0.2.0) | **272 tok / 2.4x rel** | 311 tok / 3.7x rel |

  On engram itself, `--with-skills` now costs only ~23% more tokens
  than pure code mode and the `vs relevant` savings is actually
  _slightly better_ (5.0x vs 4.8x). On `scripts`, a code-heavy
  project, there's still a modest ~35% cost for skill awareness but
  the absolute savings are restored.

  Pure code mode (`engram init` without `--with-skills`) is
  unchanged and continues to deliver 3-11x savings vs relevant files.

### Added

- **6 new regression tests** in `tests/stress.test.ts`:
  - Code query on a seeded graph with 20 keyword concepts — verifies
    zero keyword labels in rendered output
  - Token budget stays under 800 tokens on the same seeded graph
  - Skill discovery via keyword bridges still works when no code
    matches exist
  - Direct skill-name query returns the skill
  - Score downweight verified: code nodes outrank keywords when both
    text-match
  - No keyword labels leak through edge rendering (triggered_by
    edges correctly skipped)

### Tests

- 132 → 138 tests passing across 8 test files. No regressions.

---

## [0.2.0] — 2026-04-10

### Added

- **Skills miner** (`src/miners/skills-miner.ts`). Walks
  `~/.claude/skills/*/SKILL.md` (or a custom path) and indexes skills as
  graph nodes. Extracts trigger phrases via line-safe regex that survives
  `Node.js` / `React.js` style periods and Unicode curly quotes. Hand-rolled
  YAML parser — no new dependency. Handles anomalous files (missing
  frontmatter, corrupted YAML, broken symlinks) gracefully. Real-world
  benchmark: 140 skills + 2,690 keyword nodes indexed in 27ms.
- **Opt-in skills indexing** via `engram init --with-skills [dir]` or
  programmatic `init(root, { withSkills: true })`. Default is OFF —
  existing v0.1 users see no behavior change.
- **Adaptive `gen --task <name>`** driven by a data-driven `VIEWS` table.
  Four presets: `general` (default), `bug-fix`, `feature`, `refactor`.
  Each view specifies which sections render and at what limits. Adding a
  new task is adding a row to the VIEWS table — no branching logic.
- **Mistake memory activation** (regret buffer). The session miner
  already extracted mistakes in v0.1 — v0.2 wires them into the query
  path. Mistake nodes get a 2.5x score boost in `scoreNodes`, and matching
  mistakes are surfaced at the TOP of query output in a ⚠️ PAST MISTAKES
  warning block. Layering: promotion happens in scoring, presentation in
  rendering (per Hickey panel review guidance).
- **New `mistakes()` public API** in `src/core.ts` + `MistakeEntry`
  interface. Sorts by most-recently-verified, supports `limit` and
  `sinceDays` options.
- **New `engram mistakes` CLI command** with `-l/--limit`, `--since DAYS`,
  `-p/--project` flags.
- **New `list_mistakes` MCP tool** (6 tools total now). Explicit JSON
  Schema. Labels truncated surrogate-safely at 500 chars to prevent UTF-16
  corruption of the JSON-RPC response when mistakes contain emoji.
- **Atomic lockfile guard** on `init()` via `.engram/init.lock` (`wx`
  exclusive-create flag). Prevents two concurrent init calls from silently
  corrupting the graph. Descriptive error on contention.
- **Surrogate-safe string helpers** in new `src/graph/render-utils.ts`:
  `sliceGraphemeSafe()` and `truncateGraphemeSafe()`. Prevents lone high
  surrogates at cut boundaries that would corrupt JSON round-trip.
- **Data-driven View types** exported publicly: `View`, `SectionSpec`,
  `SectionKind`, `VIEWS`. Consumers can define custom views.
- **New EdgeRelation:** `triggered_by` (keyword concept → skill concept).
- **Integration guide updated** at `docs/INTEGRATION.md` with new
  `--with-skills`, `--task`, and `mistakes` sections.
- **Reference MCP shell wrapper** at `scripts/mcp-engram` (introduced in
  v0.1.1, documented in v0.2).

### Changed

- **`writeToFile` is now marker-state-aware** in `src/autogen.ts`. Walks
  the target file line-by-line tracking code-fence depth; markers inside
  fenced code blocks are correctly ignored. Unbalanced markers now throw
  a descriptive error instead of silently corrupting user content. This
  closes a v0.1 latent bug where CLAUDE.md files with orphaned markers
  could lose data between the orphaned pair.
- **`renderSubgraph` output uses surrogate-safe truncation** instead of
  raw `string.slice`. Emoji in mistake labels no longer corrupt the MCP
  JSON response.
- **`generateSummary(store)` signature** now accepts an optional
  `view: View` parameter; defaults to `VIEWS.general` for backwards
  compatibility. Legacy callers passing no view continue to work.
- **`autogen(root, target?)` signature** gained an optional third
  positional argument `task?: string`. Unknown task names throw with a
  descriptive error listing valid keys.
- **`init(root)` signature** now accepts optional `options: InitOptions`
  for `withSkills`. Unchanged default behavior.
- **`getGodNodes` SQL exclusion list** now includes `concept`. In v0.1
  this kind was unused; v0.2 uses it for skills and keywords, which
  should not dominate god-node results with hundreds of `triggered_by`
  edges.
- **MCP server numeric argument hardening.** All numeric tool args
  (`depth`, `token_budget`, `top_n`, `limit`, `since_days`) are now
  clamped via `clampInt()` with explicit min/max bounds. Prevents
  Infinity/NaN/negative values from DOSing the server on unbounded
  graph traversal or string construction.
- **MCP server error handling.** `handleRequest()` promise chain now
  has a `.catch()` that returns a generic `-32000` error response. Tool
  implementations that throw no longer produce unhandled rejections
  (which crash the process under Node's strict mode). Error messages
  from sql.js (which contain absolute filesystem paths) are never
  relayed to the client.
- **MCP server parse error response.** Malformed JSON on stdin now gets
  a proper JSON-RPC `-32700 Parse error` response with `id: null` per
  spec, instead of being silently dropped.
- **Engines requirement** remains `node >= 20` (unchanged from v0.1.1).

### Security

- **M1 (MCP unhandled rejection → process crash)** — fixed. See
  "Changed" above.
- **M2 (MCP numeric arg DOS)** — fixed. See "Changed" above.
- Both findings surfaced by the security-reviewer agent during the
  Phase 3 review gate.

### Tests

- **132 tests passing** (up from 63 in v0.1.1) across 8 test files.
- New test files: `tests/render-utils.test.ts` (13 tests),
  `tests/autogen.test.ts` (18 tests: writeToFile state machine + Views
  + autogen task flag), `tests/skills-miner.test.ts` (11 tests),
  `tests/mistake-memory.test.ts` (10 tests).
- New fixtures: `tests/fixtures/skills/{normal,anomaly,multiline,unicode,empty-body,corrupted}/SKILL.md`
  and `tests/fixtures/mistake-corpus-readme.md` (frozen README for
  false-positive regression).
- 8 new `tests/stress.test.ts` scenarios: v0.1 backwards compat,
  1000-node graph view performance, 100-mistake query, 200-mistake API
  slicing, MCP stdio smoke (list_tools + list_mistakes + parse error),
  MCP numeric arg hardening smoke, 2000-file + 100-skill init under 10s,
  empty-graph view rendering.

### Review gates

All 4 feature phases passed `code-reviewer` with APPROVED-WITH-NITS
verdicts; Phase 3 MCP boundary surface additionally passed
`security-reviewer`. Nits from reviewers are captured inline in commit
messages for follow-up tracking.

---

## [0.1.1] — 2026-04-09

### Added

- Published to npm as `engramx@0.1.1`.
- `engram-serve` bin alias for the MCP server binary.
- `engramx` bin alias matching the npm package name.
- Banner + social preview image.
- Comparison table vs Mem0, Graphify, aider, CLAUDE.md.
- GitHub Actions CI with Node 20 + 22 matrix.
- `docs/INTEGRATION.md` multi-machine setup guide.
- `scripts/mcp-engram` — portable reference shell wrapper.

### Changed

- Dropped Node 18 support — `vitest@4` requires `node:util.styleText`
  which is Node 20+.
- Removed `web-tree-sitter` dependency (was experimental, unused in
  v0.1; planned for v0.3).
- Package name from `engram` to `engramx` on npm after discovering
  the original name was taken by a dormant 2013 package.

---

## [0.1.0] — 2026-04-09

### Added

- Initial release. Knowledge graph for AI coding memory.
- **AST miner** — regex-based structural extraction across 10 languages
  (TypeScript, JavaScript, Python, Go, Rust, Java, C, C++, Ruby, PHP).
  Zero LLM cost, deterministic.
- **Git miner** — co-change pattern extraction from git log. Hot file
  detection (5+ changes).
- **Session miner** — decision/pattern/mistake extraction from CLAUDE.md,
  `.cursorrules`, AGENTS.md, and `.engram/sessions/` directories.
- **SQLite graph store** via `sql.js` — zero native dependencies.
- **CLI:** `init`, `query`, `path`, `gods`, `stats`, `bench`, `learn`,
  `gen`, `hooks`.
- **MCP stdio server** with 5 tools: `query_graph`, `god_nodes`,
  `graph_stats`, `shortest_path`, `benchmark`.
- **Auto-generated CLAUDE.md sections** via `engram gen`. Marker-scoped
  replacement.
- **Git hooks** — post-commit and post-checkout auto-rebuild in <50ms.
- **Confidence tagging** on every node and edge: EXTRACTED / INFERRED /
  AMBIGUOUS.
- **Honest benchmark** reporting two baselines: vs relevant files
  (3-11x) and vs full corpus (30-70x).
- Apache 2.0 licensed.

[0.2.0]: https://github.com/NickCirv/engram/releases/tag/v0.2.0
[0.1.1]: https://github.com/NickCirv/engram/releases/tag/v0.1.1
[0.1.0]: https://github.com/NickCirv/engram/releases/tag/v0.1.0
