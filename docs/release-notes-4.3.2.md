# engramx v4.3.2 — "Proof" (patch)

v4.3.1 was published from a staging snapshot and missed the batch of fixes made
immediately after it — most importantly **a broken MCP-setup command in the
README**. v4.3.2 ships them. All fixes, no new features, no change to the honest
claim. 1149 tests.

## Fixed

- **MCP setup (README) — the important one.** The documented config told MCP
  clients (Cline, Cursor, Claude Desktop) to run `npx -y engramx serve <path>`,
  but there is no `serve` subcommand — the CLI has `server` (the HTTP API) and
  the MCP stdio server is the separate `engram-serve` bin. Following the README
  produced `error: unknown command 'serve'` and the server never started. Now
  `npx -y -p engramx engram-serve <path>`, verified against the MCP `initialize`
  handshake. (The other integration docs already used the correct form.)
- **`gen-ccs`** on a fresh repo wrote an empty file under a false "✅ Generated";
  now falls back to the top code entities by graph degree, and warns honestly
  when there is nothing to export.
- **AST extraction:** TS `interface` / `type` alias / `enum` declarations are now
  first-class graph nodes (kinds `interface`/`type`) instead of being dropped —
  they were dead reference targets.
- **git co-change miner** no longer emits a self-edge when two distinct files
  share a basename stem (`src/index.ts` + `src/miners/index.ts`).
- **Providers:** mempalace/context7 warmup + availability probes `unref` their
  child processes, so a slow/absent backend can't hold the engram process open
  for seconds after a session's context bundle was delivered.

## Added

- `llms-install.md` — an agent-readable setup guide so tools like Cline can
  configure engram autonomously (global install → `engram init` → the
  `mcpServers` config block).

## Internal

- CI installs ripgrep (best-effort) so the grep never-worse-gate tests run on the
  runners; first dedicated tests for the git-miner and the mtime-keyed refs cache.

**Upgrade:** `npm i -g engramx@4.3.2` (or `npx engramx@4.3.2`). No migration.
If you set engram up as an MCP server from the old README, update the command to
`npx -y -p engramx engram-serve <absolute-project-path>`.
