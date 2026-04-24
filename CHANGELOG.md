# Changelog

All notable changes to engram are documented here. Format based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.0.2] — 2026-04-24 — "MCP Registry"

Chore release. No runtime changes. Adds the `mcpName` field to `package.json`
required by the Official MCP Registry (`registry.modelcontextprotocol.io`)
for namespace-ownership proof.

### Added
- `package.json` → top-level `"mcpName": "io.github.NickCirv/engram"`. Registry-side check reads the published npm tarball's `package.json` and verifies the field matches the server name in `server.json`. Without it, `mcp-publisher publish` returns HTTP 400 with the guidance message.
- Also tightened `server.json` description fields to the registry's 100-char limit (top-level description + 5 environment-variable descriptions).

### Why not bundled into 3.0.1
The `preuninstall` fix needed to ship ASAP to stop new users hitting the orphaned-hooks bug. MCP Registry integration was a separate problem surfaced during the submission flow.

## [3.0.1] — 2026-04-24 — "Clean Uninstall"

**Patch release fixing the orphaned-hooks bug reported by @freenow82 within
hours of 3.0.0 going live on npm. No feature changes — this release is
purely about not leaving users stranded when they uninstall.**

### The bug (what 3.0.0 shipped with)

`npm uninstall -g engramx` removed the binary from PATH but left the hook
entries in `~/.claude/settings.json` pointing at a `engram intercept`
command that no longer existed. Claude Code fires those hooks on every
tool call — the hook commands failed with ENOENT — and user-visible
behaviour was "Claude Code stopped executing anything." Recovery required
reinstalling engramx just to run `engram uninstall-hook` before
uninstalling again.

That is a bad experience. Sorry to anyone who hit it.

### Fixed

- **`scripts/preuninstall.mjs`** now runs automatically before `npm uninstall -g engramx`. It reads `~/.claude/settings.json`, strips every hook entry that references engram (case-insensitive match on the command string), drops engram's statusLine/HUD, backs up the original to a timestamped `.bak` file, and writes the result atomically via rename. It NEVER fails the uninstall — if the settings file is missing, unparseable, or unwritable, it logs a single-line hint and exits 0. Contract: the user's `npm uninstall` always succeeds, with or without hook cleanup.
- **`scripts/postinstall.mjs`** prints a one-time info banner on `npm install -g engramx` showing the recommended next step (`engram setup`) and the clean-uninstall flow. Respects `$CI` and `$ENGRAM_NO_POSTINSTALL=1`.
- **New `engram repair-hooks` alias** — literally the same as `engram uninstall-hook`, but named so users who ended up with orphaned hooks after a bad uninstall can find it by the word they'd actually search for. No code duplication — `commander.alias()`.
- Both scripts included in the `files` allowlist of `package.json` so they ship in the tarball.

### For users still stranded on 3.0.0

If you ran `npm uninstall -g engramx` before this patch shipped and Claude Code is still broken, you have two paths:

1. **Fast, no reinstall:** edit `~/.claude/settings.json` manually (or run the one-line `jq` filter posted in the 3.0.1 announcement thread) to strip every entry whose `command` contains the word `engram`.
2. **Works from 3.0.1:** `npm install -g engramx@3.0.1 && engram repair-hooks --scope user` — the install no longer stops execution (hooks are in place), run repair-hooks, then `npm uninstall -g engramx` again if you want engramx gone. This time the preuninstall cleans up automatically.

### Tests

- New regression test: the preuninstall script on a fixture with a mix of engram hooks + unrelated hooks + a custom statusLine verifies 3 engram entries removed, unrelated keys preserved byte-for-byte, backup written, atomic rename completed.

### Thanks

[@freenow82](https://www.reddit.com/user/freenow82) for the bug report and the transparency about the pain it caused. That feedback is the entire point of a public launch — the tool is measurably better for it.

## [3.0.0] — 2026-04-24 — "Spine"

The biggest engramx release since v1.0. One meticulous release, not a
staircase — per the decision log at `~/Desktop/Projects/Engram/00-strategy/decisions/`
(single-release-vs-staircase + engramx-canonical-brand).

Headline: engramx becomes the **extensible context spine**. Any MCP
server plugs in via a 10-line plugin file; every provider's output is
budget-weighted, mistake-boosted, and streamed progressively via SSE;
the mistakes moat grows two new capabilities (bi-temporal validity +
pre-mortem warnings); `engram gen` emits both `CLAUDE.md` AND `AGENTS.md`
by default. **Real-world benchmark: 89.1% measured savings** on engramx's
own 87-file sample (committed report in `bench/results/`).

Contributor credit: [@mechtar-ru](https://github.com/mechtar-ru) for PR #6
(OOM fixes on large codebases — cherry-picked with preserved authorship).

### Added — v3.0 "Spine" track

**Pillar 1 — Capabilities to add to it (extensibility foundation)**
- **Generic MCP-client aggregator** (`src/providers/mcp-client.ts`). Spawn or HTTP-connect to any MCP server, cache tool lists, call tools with timeout + retry, normalize into `ProviderContext`. Config at `~/.engram/mcp-providers.json`. Per-provider budgets, graceful degradation, process shutdown hooks. Uses `@modelcontextprotocol/sdk` v1.29 behind an internal abstraction so future SDK v2 migration is a single-file swap. Stdio transport ships; HTTP path stubbed pending post-3.0 Host/Origin hardening integration.
- **Provider plugin contract v2** (`src/providers/plugin-loader.ts`). Plugins declaring an `mcpConfig` instead of a custom `resolve()` are auto-wrapped via `createMcpProvider()`. Classic plugins with hand-rolled `resolve()` still work unchanged. Custom `resolve()` wins if both are present. 10-line plugins are now possible.
- **Budget-weighted resolver + mistakes-boost reranking** (`src/providers/resolver.ts`). Per-provider token budgets enforced as a backstop even if a provider ignores its contract. Results whose content mentions a known-mistake label get confidence × 1.5 (capped at 1.0) — boost breaks ties within a priority tier without overriding priority across tiers. Case-insensitive label matching.

**Pillar 2 — Save proper context**
- **Anthropic Auto-Memory bridge** (`src/providers/anthropic-memory.ts`). Reads Claude Code's auto-managed `~/.claude/projects/<encoded>/memory/MEMORY.md` index, surfaces entries scored against the current file's basename / imports / path segments. Tier 1, runs under 10 ms, max 1 MB hard-cap on index size. Override via `ENGRAM_ANTHROPIC_MEMORY_PATH` for tests + advanced users. Inserted at `PROVIDER_PRIORITY[3]` between mistakes and mempalace.
- **Streaming partial context packets via SSE** (`/context/stream?file=<path>` endpoint + `resolveRichPacketStreaming()` generator). Emit one SSE frame per provider as it resolves. Matches MCP SEP-1699: every frame carries an `id:` for `Last-Event-ID` resumption on reconnect. Client disconnect mid-stream aborts the generator cleanly. Inherits existing auth + Host + Origin guards.
- **Serena plugin reference** at `docs/plugins/examples/serena-plugin.mjs` (10-line mcpConfig plugin — install instructions in `docs/plugins/README.md`).

**Pillar 3 — Really help users (mistakes moat)**
- **Bi-temporal validity on mistake nodes**: schema migration 8 adds `valid_until` and `invalidated_by_commit` columns plus a partial index `idx_nodes_validity`. Mistakes whose `validUntil` is in the past are filtered out by the `engram:mistakes` provider. Backward-compatible: legacy rows without the columns keep firing (NULL = still valid).
- **Pre-mortem mistake-guard** (`src/intercept/handlers/mistake-guard.ts`). Opt-in via `ENGRAM_MISTAKE_GUARD=1` (permissive: warns via `additionalContext`) or `=2` (strict: denies the tool call). Matches Edit/Write against the file's mistake nodes via indexed `getNodesByFile`; matches Bash against `metadata.commandPattern` substrings and `sourceFile` mentions in the command. Respects the bi-temporal filter. Zero overhead when unset.

**Hygiene / ecosystem**
- `engram gen` emits BOTH `CLAUDE.md` AND `AGENTS.md` by default (Linux Foundation universal agent-instructions standard; adopted by Codex CLI, Cursor, Windsurf, Copilot, Junie, Antigravity). Explicit `--target=claude|cursor|agents` preserves single-file behavior.
- README opens with **"What engramx is not"** section — disarms collision with Go-Engram (Gentleman-Programming/engram), DeepSeek's "Engram" paper (Jan 2026), and MemPalace in the first 30 seconds of any new visitor read.
- PR #6 (`@mechtar-ru`) cherry-picked ourselves with preserved authorship: `MAX_DEPTH=100` in ast-miner's directory walk, `MAX_FILES_PER_COMMIT=50` in git-miner's co-change analysis, expanded default skip dirs. Dead-code cleanup of duplicate `DEFAULT_EXCLUDED_DIRS` / `loadEngramIgnore` that had shipped alongside v2.1's newer `DEFAULT_SKIP_DIRS` / `loadIgnorePatterns`. Closes issue #5.

### Proof — real-world benchmark (new, committed)

`bench/real-world.ts` runs the full resolver pipeline against the repo's own source tree and compares rich-packet tokens to raw-file-read tokens. Latest run (2026-04-24, 100-file scale-out, 87 files actually sampled after skip rules):

| Metric | Value |
|---|---|
| Baseline tokens (raw Read of every file) | 163,122 |
| engramx tokens (rich packets) | 17,722 |
| Aggregate savings | **89.1%** |
| Median per-file savings | 84.2% |
| Files where engramx saved tokens | 85 of 87 |
| Best case (`src/cli.ts`) | 98.4% (18,820 → 306) |

Reproducible by anyone, on any project: `npx tsx bench/real-world.ts --project . --files 50`.

### Changed

- `autogen()` return type: `{ file: string }` → `{ files: string[] }` (single caller in `cli.ts` updated). Consumers of the programmatic API who called `result.file` must read `result.files[0]` instead (or use `--target` to keep single-file semantics).
- `PROVIDER_PRIORITY` gains `anthropic:memory` at index 3 — downstream test that hard-coded the array order was updated.
- `MIGRATIONS` (src/db/migrate.ts): extended from `Record<number, string>` to `Record<number, string | ((db) => void)>` so migrations that need non-idempotent DDL (like `ALTER TABLE ADD COLUMN`) can guard with `PRAGMA table_info` checks.
- README badge updates: tests 640 → 876, providers 8 → 9, savings 88.1% → 90.8%.

### Migration

**v2.1 → v3.0 is schema-migration-required and automatic**: first open of your existing `.engram/graph.db` triggers migration 8. A `.bak-v7` backup is written alongside. Legacy mistake rows survive unchanged (NULL `validUntil` = still valid). Verified on a simulated v2.1 DB during release audit.

**API consumers of `autogen()`** must update call sites: `result.file` (single string) → `result.files` (array). CLI callers are unaffected.

### Tests

771 → 876 passing (+105 new). CI green Ubuntu+Windows × Node 20+22. TypeScript `--noEmit` clean, lint clean.

## [2.1.0] — 2026-04-21 — "Reliability + Zero-Friction Install"

First release in the v2.1 / v2.2 / v3.0 elevation trilogy. Design spec
at `docs/superpowers/specs/2026-04-20-engram-elevation-trilogy-design.md`.

Headline: `engram setup` is the new one-command first-run flow. Users
go from `npm install -g engramx` to a working Sentinel hook + indexed
graph in under 30 seconds. `engram doctor` reports component health
with remediation hints. `engram update` ships future hotfixes to every
install without surprise — passive notify, zero telemetry, one-command
upgrade. Plus fixes for issue #11 (AST/LSP path bug in flattened
bundles) and issue #14's Bash-ops half (auto-reindex on `rm`/`mv`/
`git rm` via an opt-in PostToolUse gate).

Contributor credit this release: [@gabiudrescu](https://github.com/gabiudrescu)
for PR #13 (reindex CLI + `install-hook --auto-reindex`), PR #12
(watcher prune on delete/rename), and the original v2.0.2 security
disclosure. [@ttessarolo](https://github.com/ttessarolo) for precise
forensics + suggested fix on issue #11.

### Added — v2.1 "Reliability + Zero-Friction Install" track

- **`engram update`** — one-command self-upgrade.
  Passive notify on every `engram *` invocation when a newer version is
  available (cached, at most one line on stderr, throttled to a 7-day
  registry check). Manual trigger detects the package manager that owns
  the engram install (npm / pnpm / yarn / bun via install-path markers)
  and shells out to its global-upgrade command. `--check` for dry-probe,
  `--force` to bypass the 7-day throttle, `--dry-run` to print the
  upgrade command without executing it, `--manager <mgr>` override.
  Zero telemetry: the only network call is an anonymous GET to
  `registry.npmjs.org/engramx/latest`. `ENGRAM_NO_UPDATE_CHECK=1` and
  `$CI` disable the entire subsystem. Addresses the "1,300 weekly
  downloads, 10/day organic, near-zero hotfix reach" problem.

- **`engram doctor`** — component health report with remediation hints.
  Wraps existing probes (HTTP, LSP, AST, IDE adapters) plus four new
  checks: engram version freshness, `.engram/graph.db` presence,
  Sentinel hook installation, IDE adapter count. Each check emits
  severity (ok / warn / fail) + detail + optional remediation. Exit
  code reflects overall severity (0 ok, 1 warn, 2 fail) so `doctor`
  is CI-friendly. `--verbose` shows remediation hints; `--json` /
  `--export` emits redacted JSON for bug-report attachment
  (`projectRoot` intentionally omitted — can contain usernames).

- **`engram setup`** — zero-friction first-run wizard. One command for
  "go from cloned repo to working engram in under 30 seconds."
  Runs `init` (if `.engram/graph.db` missing) → `install-hook` (with
  prompted scope, `local` default) → detects IDE adapters (Cursor,
  Windsurf, Continue.dev, Aider) and suggests the matching `gen-*`
  command for each → finishes with a `doctor` summary. Each step is
  idempotent. `--yes` runs with defaults; `--dry-run` prints intent
  without acting; `--scope` controls the install-hook scope. Drops
  install-to-first-value from 4 commands to 1.

- **`engram init --with-hook`** — shorthand for `init` followed by
  `install-hook` (local scope, idempotent). The #1 thing every user
  does after `init` was `install-hook`; now it's one step.

- **First-run hint.** On any `engram` subcommand invoked in a repo
  lacking `.engram/graph.db`, print one line on stderr:
  `💡 First time in this repo? Run 'engram setup' for a zero-friction install.`
  Throttled via `~/.engram/first-run-shown` (fires once per machine,
  not per repo). Silenced in `$CI`, under `ENGRAM_NO_UPDATE_CHECK=1`,
  and under the JSON-stdout commands (`intercept`, `cursor-intercept`,
  `hud-label`, `setup`, `init`, `update`, `doctor`) so neither
  pollutes the hook protocol.

- **Bash PostToolUse parser for auto-reindex** — closes half of
  [#14](https://github.com/NickCirv/engram/issues/14).
  `src/intercept/handlers/bash-postool.ts` parses file-mutating Bash
  commands (`rm`, `mv`, `cp`, `git rm`, `git mv`, single-redirect
  `<cmd> > <dst>`) into `FileOp { action, path }` records. Strict
  parser: globs, pipes, subshells, command-substitution, directory
  ops, and `touch` all pass through untouched. Wired into the
  PostToolUse observer path in `handlers/post-tool.ts` — on Bash
  PostToolUse events, each op is handed to `syncFile()` fire-and-forget.
  Gated by `ENGRAM_AUTO_REINDEX=1` opt-in until
  [#13](https://github.com/NickCirv/engram/pull/13)'s install-hook
  `--auto-reindex` flag lands; that flag will toggle the env gate
  implicitly.

### Fixed — v2.1 reliability

- **AST grammar detection in flattened bundles**
  ([#11](https://github.com/NickCirv/engram/issues/11) partial).
  When `tsup`/`esbuild` flattens chunks to `engramx/dist/chunk-*.js`,
  `import.meta.url` resolves to `engramx/dist` and the previous
  candidates (`../grammars` and `../../dist/grammars`) both missed the
  actual grammar dir. Added `join(here, "grammars")` as the first
  candidate; dev-time layout (`src/intercept/`) still works via the
  third candidate. Thanks [@ttessarolo](https://github.com/ttessarolo).

- **LSP socket candidate coverage**
  ([#11](https://github.com/NickCirv/engram/issues/11) partial).
  `checkLsp` was looking for two socket names while
  `lsp-connection.ts::candidateSockets()` probes six. Synced the list
  so HUD availability matches actual provider availability. Kept
  `.engram/lsp-available` as an explicit user opt-in marker for
  back-compat.

### Fixed

- **Locale-independent number formatting across the codebase.** All 10
  `Number.prototype.toLocaleString()` callsites in `src/cli.ts`,
  `src/serve.ts`, `src/dashboard.ts`, and `src/intercept/stats.ts` have
  been migrated to a shared `formatThousands()` helper in
  `src/graph/render-utils.ts`. Two wins:

  1. **Deterministic performance.** First-call ICU init on Windows Node
     has been observed to take multiple seconds in GitHub Actions VMs,
     flaking tests at the 5000ms default timeout (seen on
     `tests/intercept/stats.test.ts > formatStatsSummary` post-merge on
     `9f99f5b`). The regex-based helper runs in microseconds with no
     ICU dependency.
  2. **Locale independence.** `toLocaleString()` emits `"1,234"` on
     en-US but `"1.234"` on de-DE and `"1 234"` on fr-FR, giving users
     running engram in non-US shells inconsistent output. All CLI +
     MCP server + dashboard numbers now render with commas regardless
     of system locale.

  Added `tests/render-utils.test.ts > formatThousands` — 6 tests
  covering single-digit, multi-group, negative, and locale-stable cases.
  Also added `vitest.config.ts` with CI-only `retry: 1` +
  `testTimeout: 15000ms` as defense-in-depth against other cold-worker
  flakes.

- **`engram watch` now prunes graph nodes when watched files are deleted
  or renamed** ([#9](https://github.com/NickCirv/engram/issues/9),
  [#12](https://github.com/NickCirv/engram/pull/12)). Previously the
  watcher only subscribed to `change` events, silently ignoring the
  `rename` events that `fs.watch` fires for create/unlink across all
  platforms. Deletions left stale nodes in the graph until the next
  `engram init`; renames produced duplicate nodes under the old and new
  `sourceFile` paths. Thanks [@gabiudrescu](https://github.com/gabiudrescu).

### Added

- **`syncFile(absPath, root)`** exported from `src/watcher.ts` — the shared
  "exists → reindex; gone (and was indexed) → prune" primitive reused by
  the upcoming `engram reindex` CLI subcommand ([#8](https://github.com/NickCirv/engram/issues/8)).
  Returns a discriminated `SyncResult` (`indexed` | `pruned` | `skipped`).
- **`GraphStore.countBySourceFile(relPath)`** — noise-reduction gate so
  `onDelete` only fires for files the graph actually indexed.
- **`onDelete` callback on `WatchOptions`** — fires with `(filePath, prunedCount)`
  when the watcher prunes a deleted file's nodes.
- **`× <path> pruned (N nodes)`** log line in `engram watch`, distinct from
  the existing green `↻` reindex line.
- **`gen-cursor --watch`, `gen-aider --watch`, `gen-windsurfrules --watch`**
  now regenerate their output files on source-file delete (not just on
  reindex), so generated artifacts no longer keep stale references to
  deleted sources.
- **`engram reindex <file>` CLI subcommand**
  ([#8](https://github.com/NickCirv/engram/issues/8)) — re-indexes a
  single file into the knowledge graph. The missing primitive for per-
  edit freshness: Claude Code PostToolUse hooks, editor plugins, and CI
  can now keep the graph in sync without running a long-lived watcher.
  Reuses `syncFile()` so semantics match `engram watch`: exists →
  reindex; missing-but-previously-indexed → prune; unsupported ext or
  ignored directory → silent exit 0 (safe to fire on every edit). On
  success prints a single line `engram: reindexed <file> (<N> nodes)`
  (or `pruned`) using locale-stable `formatThousands`. `--verbose`
  surfaces stack traces; default error output is a single stderr line.
  Missing graph exits 1 with `engram: no graph found at <root>. Run
  'engram init' first.`, matching `engram watch`.
- **`formatReindexLine(result, displayPath)`** exported from
  `src/watcher.ts` — pure formatter shared by the new subcommand. Returns
  `null` for skipped results so callers stay silent.
- **`engram reindex-hook` subcommand + `engram install-hook --auto-reindex`**
  ([#8](https://github.com/NickCirv/engram/issues/8), opt-in auto-wire).
  `reindex-hook` reads Claude Code's PostToolUse payload from stdin and
  re-indexes `tool_input.file_path` via the shared `syncFile()` primitive.
  Contract: ALWAYS exits 0 — malformed JSON, missing fields, non-project
  `cwd`, and all internal errors resolve to a silent no-op so the hook
  can never fail Claude Code's tool cycle. `install-hook --auto-reindex`
  appends a second PostToolUse entry with matcher `Edit|Write|MultiEdit`
  calling `engram reindex-hook`; off by default so existing users aren't
  surprised. The new entry is recognized by `isEngramHookEntry()` so
  `engram uninstall-hook` strips it alongside the primary intercept
  entries. Idempotent — reinstalling with `--auto-reindex` is a no-op
  when the entry already exists.
- **`runReindexHook(payload)`** exported from `src/watcher.ts` — the
  pure async handler behind the `reindex-hook` subcommand. Validates
  payload shape, resolves project root from `cwd`, delegates to
  `syncFile`. Swallows every error.
- **`buildReindexHookEntry()` + `ENGRAM_REINDEX_HOOK_MATCHER`
  (`"Edit|Write|MultiEdit"`) + `DEFAULT_ENGRAM_REINDEX_HOOK_COMMAND`
  (`"engram reindex-hook"`)** exported from `src/intercept/installer.ts`
  — the data primitives for the optional entry. Added
  `InstallOptions.autoReindex` and `InstallResult.autoReindexAdded` to
  thread the opt-in through the existing installer surface.

### Notes

- Directory deletion (`rm -rf src/foo`) is intentionally not handled by the
  watcher — `fs.watch` fires a single rename event on the directory path
  with no per-file information. A full `engram init` handles that case
  today; per-file directory-prefix pruning is tracked for v2.2.

## [2.0.2] — 2026-04-18 — Security hotfix: HTTP server auth & CORS

**This is a security release. Upgrade immediately if you run `engram server`
or `engram ui`.** Credit: [@gabiudrescu](https://github.com/gabiudrescu) for
responsible disclosure ([#7](https://github.com/NickCirv/engram/issues/7)).

### Security — fixed

- **Graph exfiltration + persistent prompt injection via cross-origin browser
  tabs.** The HTTP server previously shipped with `Access-Control-Allow-Origin: *`
  on every response and defaulted to no authentication. A malicious page the
  developer visited could `fetch('http://127.0.0.1:7337/query')` to steal the
  local graph, then `POST /learn` (with `Content-Type: text/plain`, a
  CORS-safelisted content type) to persist `bug:` / `fix:` patterns that the
  v2 Sentinel handlers later re-injected into the user's coding agent on
  SessionStart and on every Edit/Write of the named file. Severity: High —
  confidentiality + persistent indirect prompt injection.

  **Fix (four stacked defenses):**
  1. **Fail-closed auth.** Every route except `/health` and `/favicon.ico`
     now requires `Authorization: Bearer <token>` or an HttpOnly
     `engram_token` cookie. A random 64-character token is auto-generated
     on first server start and persisted to `~/.engram/http-server.token`
     with mode `0600`. `ENGRAM_API_TOKEN` env var still overrides.
  2. **No wildcard CORS.** `Access-Control-Allow-Origin: *` has been removed
     from every response. By default no CORS headers are emitted — the
     dashboard is same-origin. Additional origins opt in via
     `ENGRAM_ALLOWED_ORIGINS=a.com,b.com`.
  3. **Host + Origin validation** (DNS-rebinding defense). Requests with a
     `Host` header other than `127.0.0.1|localhost|::1` on the bound port
     return 400. Requests with an `Origin` not in the same-origin or env
     allowlist return 403.
  4. **`Content-Type: application/json` enforced on mutations.** POST / PUT /
     DELETE without `application/json` return 415. This blocks the
     `text/plain` CSRF vector from the PoC and forces CORS preflight for
     any cross-origin writer.

- **Timing side-channel on token comparison.** The previous
  `header === \`Bearer ${token}\`` comparison was not constant-time.
  Replaced with a length-first, constant-time `safeEqual()`.

### Added

- `src/server/auth.ts` — token management (get-or-create, safeEqual, cookie
  parsing, Host/Origin validators).
- `tests/server/security.test.ts` — PoC-style tests covering fail-closed
  auth (including empty Bearer / empty cookie guards), env-downgrade
  rejection (token is snapshot at start), cookie auth, wildcard-CORS
  absence, same-origin echo, foreign-origin 403, Host header validation
  (including no-port rejection + case-insensitive hostname), `text/plain`
  rejection on `/learn`, the `/ui?token=` cross-site oracle defence via
  `Sec-Fetch-Site` gating, and the end-to-end exploit chain from #7.
- `SECURITY.md` at repo root with disclosure policy and scope.
- `GET /ui?token=<t>` bootstrap path for the browser dashboard. The CLI
  passes the token once; the server exchanges it for an HttpOnly cookie via
  a 302 redirect and strips the token from the URL. Dashboard JS never sees
  the raw token.

### Changed

- `createHttpServer(projectRoot, port)` now resolves to `Promise<TokenInfo>`
  (previously `Promise<void>`). The returned object exposes the token source
  (env / file / generated) and the token file path. The CLI uses this to
  print a one-time banner pointing users at `~/.engram/http-server.token`
  when a fresh token is minted.
- `checkAuth` rewritten as fail-closed, accepts Bearer header OR
  `engram_token` cookie, uses constant-time comparison.
- Server-Sent Events endpoint (`/api/sse`) no longer emits wildcard CORS and
  inherits the same origin-allowlist behavior as every other route.

### Breaking

- **External callers (curl, scripts, CI probes) must now send the token.**
  Fix the one-liner on each caller:
  ```bash
  curl -H "Authorization: Bearer $(cat ~/.engram/http-server.token)" \
       http://127.0.0.1:7337/stats
  ```
- Requests with `Host: something-else.com` are rejected 400 even if they
  resolve to 127.0.0.1 locally. DNS rebinding defense — intended behavior.
- Cross-origin requests (`Origin: https://example.com`) are rejected 403
  unless the origin is in `ENGRAM_ALLOWED_ORIGINS`. No legitimate caller
  should be affected.
- `/ui` navigation from the browser now requires `?token=<t>` on first visit
  (set automatically when you run `engram ui`) or a pre-existing
  `engram_token` cookie.

## [2.0.1] — 2026-04-17 — Windows CI + favicon route

Patch release fixing two issues caught immediately after v2.0.0 shipped.

### Fixed

- **Windows cross-platform bug in the plugin loader.** `PLUGINS_DIR` was a
  module-load-time constant that baked in `homedir()` at import time. Windows
  uses `USERPROFILE` while Unix uses `HOME`, and a frozen constant meant any
  runtime override (tests, future `--plugins-dir` flag, programmatic use)
  couldn't take effect without a module reload. Windows CI failed on the
  plugin-loader tests because `process.env.HOME` mutation had no effect.
  Fixed by introducing `getPluginsDir()` that resolves on every call, and
  accepting an optional `dir` parameter on `loadPlugins()`,
  `getLoadedPlugins()`, and `ensurePluginsDir()`. The `PLUGINS_DIR` constant
  is retained for back-compat but runtime paths now go through the getter.
- **`/favicon.ico` returning 404 for clients that ignore `<link rel="icon">`.**
  Added an explicit `GET /favicon.ico` route to the HTTP server that serves
  a 238-byte inline SVG favicon with `Cache-Control: public, max-age=86400`.
  The dashboard HTML still inlines the same favicon via `<link>` so modern
  browsers avoid the request entirely.

### Changed

- Test count: 640 → 641 (+1 for the "plugins directory does not exist"
  branch of `loadPlugins()`).

### CI

- Verified green on GitHub Actions matrix: Ubuntu + Windows × Node 20 + 22.
  Commit `7c6001c`.

## [2.0.0] — 2026-04-17 — "Ecosystem"

The biggest release since v1.0.0. Completes the v2.0 roadmap Phases 1–4:
Foundation, Web Dashboard, Integration Expansion, and Solidification.
640 tests (up from 579). All changes backward-compatible with v1.x graph
files — existing `.engram/graph.db` files auto-migrate to schema v7.

### Added — Phase 3 (Integration Expansion)

- **`engram gen-windsurfrules`** — generate `.windsurfrules` for Windsurf
  (Codeium) IDE. Plain markdown (no frontmatter), auto-picked-up by Windsurf
  on every chat session. Supports `--watch` for live regeneration on graph
  changes. See `docs/integrations/README.md`.
- **Integration docs**: `docs/integrations/neovim.md` (codecompanion +
  avante.nvim via mcphub), `docs/integrations/cursor-mcp.md` (Cursor's
  native MCP support alongside the MDC path), `docs/integrations/emacs.md`
  (gptel + gptel-mcp), plus a new `docs/integrations/README.md` index that
  maps every supported IDE to its mechanism.

### Added — Phase 4 (Solidification)

- **Provider plugin system** — third-party context providers installable
  at `~/.engram/plugins/*.mjs`. Each plugin default-exports a
  `ContextProviderPlugin` object and is dynamically loaded by the resolver.
  Validation-before-install refuses malformed plugins; duplicate names
  can't shadow built-ins. New CLI:
  - `engram plugin list` — show installed plugins with tier/budget/version
  - `engram plugin install <file.mjs>` — validate + copy into plugins dir
  - `engram plugin remove <filename>`
- **`engram cache` CLI namespace** — inspect and manage the context cache:
  - `engram cache stats` — hit rate, entries per layer, hot file count
  - `engram cache clear` — flush all layers
  - `engram cache warm` — pre-warm hot files from access frequency
- **Schema rollback** — `engram db rollback --to <version>` reverts the
  schema with automatic backup at `<dbPath>.bak-v<fromVersion>`. Requires
  explicit `--yes` confirmation (data loss). Rollback is in-session only;
  reopen auto-migrates forward again by design — the backup is the
  recovery path for pinning an older version.
- **Schema v7** — adds `query_cache` and `pattern_cache` tables with
  `idx_query_cache_file` index. Retroactive DOWN migrations defined for
  versions 1–7 so any version is rollback-target-safe.

### Added — Phase 1 (Foundation)

- **Tree-sitter grammar bundling** — 6 WASM grammar files (TypeScript, TSX,
  JavaScript, Python, Go, Rust) now ship inside the npm package at
  `dist/grammars/`. The `engram:ast` provider works out of the box for npm
  users without needing local `node_modules` tree-sitter packages.
  New: `scripts/bundle-grammars.mjs` (pure Node ESM, no tsx dep).
  `npm run build` bundles them automatically; `build:nogrammars` as escape hatch.
- **Incremental indexing** — `init()` accepts `{ incremental: true }` and the
  CLI accepts `--incremental` to skip files whose mtime hasn't changed since
  last index. File mtimes persisted as JSON in the stats table. On engram's
  own source (117 TS files): 53ms vs 244ms full init — **78% faster**.
- **`.engramignore` support** — gitignore-like syntax for excluding directories
  and files from indexing. Loaded from project root.
- **Memory cache system** (`src/intelligence/cache.ts`, ~330 LOC) — 3-layer
  compound savings engine:
  - **Query result cache** — resolved context packets per file, SQLite-backed
    + in-memory LRU (100 entries). Invalidated on file mtime change.
    Benchmarked at 23μs/op, 99% hit rate under 10k random reads.
  - **Pattern cache** — structural query answers memoized with graph version
    tracking. LRU (50 entries). Auto-invalidates on graph mutation.
  - **Hot file cache** — `warmHotFiles()` pre-loads top-N most-accessed files
    at SessionStart for zero first-hit latency.
  - `engram cache` CLI namespace (stats/clear/warm) — planned for Phase 4.
- **9 new HTTP API endpoints** serving the dashboard + external integrations:
  - `GET /api/hook-log` — paginated hook log entries
  - `GET /api/hook-log/summary` — aggregated event/tool/decision stats
  - `GET /api/tokens` — cumulative token savings
  - `GET /api/files/heatmap` — file interception frequency ranking
  - `GET /api/providers/health` — component status
  - `GET /api/cache/stats` — cache hit/miss rates, entry counts
  - `GET /api/graph/nodes` — paginated graph nodes
  - `GET /api/graph/god-nodes` — top-connected entities
  - `GET /api/sse` — Server-Sent Events, 1s hook-log polling, auto-cleans on
    disconnect
  - Load tested at 200 concurrent mixed requests in 295ms (~1.5ms/req).

### Added — Phase 2 (Web Dashboard)

- **Zero-dependency web dashboard at `GET /ui`** — 35KB self-contained
  HTML/CSS/JS as TypeScript template literals. No external CDNs, no build
  pipeline, works offline / on air-gapped machines.
  - Security: CSP meta tag (`default-src 'self'; connect-src 'self'`) + single
    `esc()` helper at every JS→HTML boundary defends against XSS from
    attacker-controllable file paths/labels mined from repos.
  - 6 tabs: Overview, Sessions, Activity (live SSE), Files, Graph (Canvas 2D
    force-directed, ~200 LOC, handles <500 nodes at 60fps with pan/zoom/click),
    Providers.
  - SVG chart library (`ui-components.ts`): donut, stacked bars, sparkline,
    cache/graph stat blocks. Zero dependencies.
- **`engram ui` CLI command** — auto-starts the HTTP server if not running
  (PID file check), opens the default browser to `http://127.0.0.1:7337/ui`.
  `--no-open` flag for print-only mode.

### Changed

- `npm run build` now always bundles tree-sitter grammars into `dist/grammars/`
  (previously only `prepublishOnly` did, which masked the missing-grammar
  scenario for anyone testing a built `dist/` locally).
- `--incremental` flag wired into the CLI (previously API-only and undiscoverable).
- Default skip directories expanded: added `.next`, `.nuxt`, `coverage`,
  `target`, `venv`, `.venv`, `.cache`, `.turbo`, `.output`, `.git`.
- `extractFile()` now returns `lineCount` from content already parsed,
  eliminating a redundant `readFileSync` per file during extraction.
- `GraphStore` extended with `runSql()`, `prepare()` (public), and
  `removeNodesForFile()` for incremental mode and cache module.
- Test count: 579 → 640 (+61 tests: 7 incremental + 17 cache + 15 API + 6
  windsurf + 5 rollback + 11 plugin-loader).

### Fixed

- `dist/grammars/` was empty after `npm run build` alone — only populated by
  `prepublishOnly`. Masked in dev by `grammar-loader.ts` falling back to
  `node_modules/tree-sitter-*/`, but shipped broken to anyone running `dist/`
  locally after build. Root cause: tsup's `clean: true` wiped the dir.

## [1.0.0] — 2026-04-17 — "Protocol"

### Added

- **HTTP REST server** — `engram server --http` starts a local server on
  127.0.0.1:7337. Endpoints: `/health`, `/query`, `/stats`, `/providers`,
  `/learn`. Bearer token auth via `ENGRAM_API_TOKEN`. PID file written on
  start for HUD server-status detection.
- **Tree-sitter AST provider** (`engram:ast`) — WASM-based AST parsing for
  10 languages (TypeScript, JavaScript, Python, Go, Rust, PHP, Ruby, Java,
  C, C++). Confidence 1.0 vs 0.85 for regex. When the AST provider succeeds
  for a file, the regex `engram:structure` provider is skipped entirely.
- **LSP provider** (`engram:lsp`) — connects to running LSP servers. Hover
  info is added to Read interceptions; diagnostic events on Edit create
  mistake nodes automatically. Best-effort with graceful degradation when no
  LSP is running.
- **Auto-tuning** — `engram tune [--dry-run|--apply]` analyzes
  `.engram/hook-log.jsonl` and proposes per-project config changes:
  confidence threshold, token budgets, provider enable/disable. Settings
  are written to `.engram/config.json`.
- **Schema versioning** — 6 migration files (001–006). Auto-migrate on
  startup with backup. `engram db status` shows current schema version;
  `engram db migrate` runs pending migrations.
- **CCS integration** — Codebase Context Specification support.
  `engram init --from-ccs` imports `.context/index.md` into the KG as
  nodes. `engram gen-ccs` exports the KG to CCS format.
- **Continue.dev context provider** — `engramx-continue` npm package.
  Surfaces as `@engram` in Continue's @-mention system. Falls back to HTTP
  server if CLI is unavailable.
- **Cursor MDC generation** — `engram gen-mdc` generates
  `.cursor/rules/engram-context.mdc` from the KG. YAML frontmatter with
  auto-detected globs. `--watch` flag for live refresh on graph changes.
- **Zed context server** — `engram context-server` implements Zed's
  JSON-RPC protocol. Registers as the `/engram` slash command inside Zed.
- **Aider context generation** — `engram gen-aider` creates
  `.aider-context.md` from the KG. `--watch` flag for live refresh.
- **Benchmark harness v0.2** — automated `npm run bench` with 10 task
  fixtures. Measures baseline vs engram token savings across real tasks.
  Result: **88.1% aggregate token savings** (measured, not estimated).
- **Stress test suite** — `npm run stress` covering rapid concurrent reads,
  provider concurrency, large graph operations, and hook-log replay.
- **Component health HUD** — statusLine now shows HTTP ✓/✗, LSP ✓/✗,
  AST ✓/✗, and N IDEs. Updates automatically as components activate.
- **ECP spec v0.1** — Engram Context Protocol RFC at
  `docs/specs/ecp-v0.1.md`. Vendor-neutral standard for hook-based context
  enrichment across coding tools. CC-BY 4.0.
- **5 integration guides** — `docs/integrations/` with setup guides for
  Continue.dev, Cursor, Zed, Aider, Claude Code, and CCS.
- **Per-project config** — `.engram/config.json` supports confidence
  threshold, token budgets, and provider overrides. Read by the resolver
  on every packet assembly.

### Changed

- Provider priority now includes `engram:ast` (highest confidence, runs
  first) and `engram:lsp` (lowest, best-effort enrichment). The regex
  `engram:structure` provider is skipped on files where AST succeeds.
- `TOTAL_TOKEN_BUDGET` is now configurable via `.engram/config.json`.
  Was hardcoded at 600.
- Test count: 520 → 579 (+59 tests across 6 new test files).

### Fixed

- **Shell injection in Continue adapter** — switched from double-quote
  escaping to single-quote wrapping for all CLI arguments.
- **HTTP server package.json path resolution** — now resolves correctly
  from both `src/` (dev) and `dist/` (built) entry points.

---

## [0.5.0] — 2026-04-13 — "Context Spine"

### Added

- **Context Spine** — engram now assembles rich context packets from
  6 providers (structure, mistakes, git, mempalace, context7, obsidian)
  per Read interception. One response replaces 5 separate tool calls.
  Target: up to 90% session-level token savings.
- **Provider cache** — new `provider_cache` SQLite table with full CRUD.
  External providers (mempalace, context7, obsidian) cache results at
  SessionStart. Per-Read cache lookup is <5ms.
- **ContextProvider interface** — formal contract for all providers:
  `resolve()`, `warmup()`, `isAvailable()`, with token budgets and
  per-provider timeouts.
- **6 providers**: `engram:structure` (graph), `engram:mistakes` (known
  issues), `engram:git` (recent changes/churn), `mempalace` (decisions
  from ChromaDB), `context7` (library docs), `obsidian` (project notes).
- **Resolver engine** — parallel resolution with priority ordering,
  600-token total budget, graceful degradation per provider.
- **SessionStart warmup** — fire-and-forget bulk cache fill for Tier 2
  providers at session start.
- **StatusLine auto-config** — `engram install-hook` now sets up the
  Claude Code statusLine with `engram hud-label` when no existing
  statusLine is configured.

### Fixed

- **CRITICAL: `renderFileStructure` full table scan** — replaced
  `getAllNodes()`/`getAllEdges()` with targeted SQL queries
  (`getNodesByFile`, `getEdgesForNodes`). Was silently timing out on
  large projects (50k+ nodes).
- **CRITICAL: `scoreNodes` full table scan** — replaced `getAllNodes()`
  with `searchNodes()` SQL seeding. O(matches) instead of O(all nodes).
- **Go import false positives** — import detection now tracks
  `import()` block state. No longer fires on struct field tags like
  `json:"name"`.
- **TS arrow function false positives** — pattern now requires `=>`
  in the same line. `const x = (someValue)` no longer creates false
  function nodes.
- **Commented-out code extraction** — lines starting with `//` or `*`
  are skipped before pattern matching.
- **Edge ordering** — `renderFileStructure` sorts edges by combined
  endpoint degree before `.slice(0, 10)`. God-node relationships
  appear first.
- **LIKE wildcard escaping** — `%` and `_` in search queries are
  properly escaped.
- **SQLite variable limit** — `getEdgesForNodes` chunks IN clause at
  400 IDs to stay under SQLite's 999 parameter limit.
- **`warmCache` persistence** — now calls `save()` after transaction
  commit, consistent with `bulkUpsert`.
- **Null-safe casts** — `rowToCachedContext` uses `?? fallbacks` on
  all fields to prevent null propagation.
- **Parallel availability checks** — provider isAvailable() runs in
  parallel, not sequentially. Prevents slow Tier 2 timeouts from
  blocking Tier 1 providers.

### Changed

- Confidence score calibrated to 0.85 for regex extraction (was 1.0).
  Reserves 1.0 for future tree-sitter integration.
- Removed phantom `graphology` dependency (was in package.json with
  zero imports in source code).
- Test count: 493 → 520 (+27 new tests).
- README updated: "context spine" positioning, accurate test count,
  provider documentation, "heuristic extraction" language.

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

[1.0.0]: https://github.com/NickCirv/engram/releases/tag/v1.0.0
[0.2.0]: https://github.com/NickCirv/engram/releases/tag/v0.2.0
[0.1.1]: https://github.com/NickCirv/engram/releases/tag/v0.1.1
[0.1.0]: https://github.com/NickCirv/engram/releases/tag/v0.1.0
