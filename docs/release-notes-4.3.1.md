# engramx v4.3.1 — "Proof" (patch)

A two-pass **execution-swarm audit** — agents that actually *ran* engram end-to-end (hooks, CLI, MCP server, the graph, packaging) rather than just reading it — plus a perf self-audit, hardened the 4.3.0 release. **All fixes, no new features, no change to the honest claim.** 1144 tests.

## Fixed

### Honesty (the project's core discipline)
- **`engram cost` digest** printed an unqualified `Total tokens saved: … (100% reduction, ~$3.60)` — in output literally designed to be pasted to Substack/LinkedIn/Telegram. It now carries the full *"structural reduction, **not a bill saving** — net over prompt caching ≈ 0; USD is illustrative list-price only"* caveat. (The cost module predated the honesty pass.)
- **`bench`/`stats`** printed "0.2x smaller packet" when the packet was actually **5× larger** than the relevant files. A new shared `packetRatioPhrase()` states it honestly across CLI, bench, and the HTTP server: *"5x LARGER — engram passes through."*

### Graph correctness + performance
- **Incremental reindex drift:** single-file `reindex` / `watch` / the reindex-hook (fires on every edit) re-extracted a file but never rebuilt the name-resolved cross-file `calls` relation, so ranking / callers / callees silently drifted until the next full `init`. Now rebuilt on both the index and prune paths.
- **Hot-path perf:** that rebuild re-parsed *every* file on disk (~330 ms on a 1k-node graph) on the per-edit hook path. An mtime-keyed per-file refs cache makes a single-file reindex re-parse only the changed file — **328 ms → ~1 ms** warm, with byte-identical edges (equivalence-tested).

### Robustness
- **MCP server** reported `serverInfo.version: "0.2.1"` (clients + the MCP registry saw the wrong version); now reads the real package version.
- **`engram doctor`** reported a green "hook active" even with the `.engram/hook-disabled` kill switch set; now warns "installed but DISABLED."
- **`engram gen --task <bad>`** threw a raw stacktrace; now prints the clear "unknown task" message and exits 1.
- Grep-family Bash parser no longer mis-intercepts output-mode flags after the pattern (`rg sym -l` / `-c` / `-A 3`); `missingHookEvents` no longer throws on a hand-edited `settings.json`; Windows drive-letter paths survive `measure`'s recall set; the recall bench guards `trials === 0` (no `NaN%`).

## Verified (no fix needed)
Hook interception layer clean; all v4.3 headline features (sub-agent broker, compaction ledger, mistakes memory, grep never-worse, PageRank ranking) work E2E; security held against every injection / SQL / DoS / auth attack; npm tarball ships 55 files / 0 dev files; 4 parallel reindexes leave the graph intact; docs carry no surviving cost over-claim; public `engramx@4.3.0` smoke from npm passes.

**Upgrade:** `npm i -g engramx@4.3.1` (or `npx engramx@4.3.1`). No migration; the refs cache builds itself on the next `init`/reindex.
