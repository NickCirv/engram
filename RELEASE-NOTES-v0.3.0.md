# engram v0.3.0 "Sentinel" — Release Notes

**Status:** Branch `v0.3.0-sentinel` at commit `125af22`. All code, tests,
docs, and metadata ready to ship. Local tag `v0.3.0` pending.

**Date:** 2026-04-11
**Tests:** 439 passing (up from 214 in v0.2.1)
**tsc:** clean
**Build:** `dist/cli.js` 50.6 KB, 9 files, 42.5 KB packed
**Branch commits:** 7 (Day 1 → Day 2 → audit → Day 3 → Day 4 → Day 5 → Day 6)
**Total LOC:** ~6,500 source + tests + docs

---

## The Headline

**engram v0.3 is no longer a tool your agent queries. It's a Claude Code
hook layer that intercepts at the tool-call boundary so the agent
can't forget to use it.**

| v0.2 (old) | v0.3 (new) |
|---|---|
| Agent remembers to call `query_graph` ~5x/session | Every Read/Edit/Bash/prompt is intercepted automatically |
| 5 × 2000 = 10K max theoretical savings | Projected -42,500 tokens/session (~80%) |
| Works only if the agent cooperates | Works whether the agent cooperates or not |

## Real Measured Numbers (2026-04-11, engram on itself)

**Baseline benchmark** (`engram bench`):
```
Full corpus:     ~113,544 tokens
Avg graph query: ~464 tokens
vs relevant:     11.1x fewer tokens
vs full corpus:  244.7x fewer tokens
```

**Sentinel interception on 4 real engram files** (`engram hook-preview`):

| File | Full-read tokens | Sentinel result | Savings |
|---|---|---|---|
| `src/core.ts` | ~4,169 | DENY (13 nodes → ~300 tok summary) | **-3,869** |
| `src/graph/query.ts` | ~4,890 | DENY (10 nodes → ~300 tok summary) | **-4,590** |
| `src/intercept/dispatch.ts` | ~1,820 | DENY (5 nodes → ~300 tok summary) | **-1,520** |
| `src/intercept/handlers/read.ts` | ~1,310 | PASSTHROUGH (only 1 export) | 0 |
| **Total** | **12,189** | **2,210** | **-9,979 (-82%)** |

**Hit rate: 75%** (3 of 4 files intercepted). Passthrough was correct —
`read.ts` has only 1 exported function, below the 3-node confidence
threshold. The conservative formula is working.

These are **measured on real engram code**, not projected.

## What Ships

### 7 new CLI commands
- `engram intercept` — hook entry point (stdin JSON → dispatch → stdout JSON, always exit 0)
- `engram install-hook [--scope local|project|user] [--dry-run]` — add hooks, atomic + backup
- `engram uninstall-hook` — surgical removal preserving other hooks
- `engram hook-stats [--json]` — summarize `.engram/hook-log.jsonl`
- `engram hook-preview <file>` — dry-run Read handler for a file
- `engram hook-disable` / `engram hook-enable` — kill switch toggle

### 7 new hook handlers
- **PreToolUse:Read** — deny+reason (replaces file with structural summary)
- **PreToolUse:Edit** — allow+context (landmine warnings, never blocks)
- **PreToolUse:Write** — same as Edit
- **PreToolUse:Bash** — strict parser for `cat/head/tail/less/more <file>`, delegates to Read
- **SessionStart** — project brief injection on startup/clear/compact
- **UserPromptSubmit** — keyword-gated pre-query injection (never logs prompts)
- **PostToolUse** — pure observer → hook-log.jsonl

### 10 safety invariants
1. Any handler error → passthrough (never block Claude Code)
2. 2-second per-handler timeout
3. Kill switch (`.engram/hook-disabled`) respected by all handlers
4. Atomic settings.json writes with timestamped backups
5. Never intercept outside project root
6. Never intercept binaries or secrets (.env/.pem/.key/credentials/id_rsa)
7. Never log user prompt content (asserted in test)
8. Never inject >8000 chars per hook response
9. Stale graph detection (file mtime > graph mtime → passthrough)
10. Partial-read bypass (offset/limit → passthrough)

### Infrastructure
- `src/intercept/` module — 14 files including safety, context, formatter,
  dispatch, installer, stats, and 7 handlers
- `src/intelligence/hook-log.ts` — append-only JSONL with 10MB rotation
- `tests/intercept/` — 225 new tests including end-to-end subprocess tests
  that actually spawn `node dist/cli.js intercept` with real payloads

## Migration

**None required.** v0.3.0 is purely additive.

- All v0.2.1 CLI commands work identically
- All MCP tools unchanged (`query_graph`, `god_nodes`, `graph_stats`,
  `shortest_path`, `benchmark`, `list_mistakes`)
- Internal API stable (`mistakes()` function, `list_mistakes` MCP tool,
  `kind: "mistake"` schema)
- Existing engram projects continue working without re-init

The only user-facing terminology change is "regret buffer" → "landmines"
in comments and docs. Internal code still uses "mistake".

## What's Deferred to v0.3.1

- **Grep interception.** Too many edge cases in v0.3.0 (regex metacharacters,
  string-literal searches engram can't answer). Will be re-scoped based on
  real hook-log data.
- **Per-user confidence threshold config.** v0.3.0 hardcodes 0.7.
- **Self-tuning from hook-log data.** Will tune the 2.5x mistake boost,
  0.5x keyword downweight, 0.7 confidence threshold, and coverage ceiling.

---

## Remaining Manual Steps (for Nick to run)

Everything below requires Nick's explicit action — 2FA, public release,
account state. Claude cannot and should not do these autonomously.

### 1. Local tag (safe to do now)
```bash
cd ~/engram
git tag v0.3.0
```
This is local-only. No push.

### 2. Review the branch
```bash
cd ~/engram
git log --oneline main..v0.3.0-sentinel
git diff --stat main..v0.3.0-sentinel
```
Sanity check before anything public.

### 3. Merge to main (optional, choose one)
```bash
# Option A: squash merge (clean history)
git checkout main
git merge --squash v0.3.0-sentinel
git commit -m "v0.3.0 Sentinel — hook-based interception layer"

# Option B: merge commit (preserves day-by-day history)
git checkout main
git merge --no-ff v0.3.0-sentinel

# Option C: rebase (keeps linear history with all 7 commits)
git checkout main
git merge --ff-only v0.3.0-sentinel  # requires rebase first if diverged
```

### 4. Push to GitHub
```bash
git push origin main
git push origin v0.3.0        # push the tag
```

### 5. npm publish (requires 2FA)
```bash
npm run build                 # clean rebuild from main
npm pack --dry-run            # final sanity check
npm publish                   # requires npm 2FA
```

### 6. GitHub release
```bash
gh release create v0.3.0 \
  --title "v0.3.0 — Sentinel" \
  --notes-file RELEASE-NOTES-v0.3.0.md
```

### 7. Install on your own system
```bash
npm install -g engramx@0.3.0
cd ~/any-project-with-engram
engram install-hook --scope local
```

Then open Claude Code in that project. The Sentinel is live.

### 8. Announce (when ready)
Launch posts from v0.2.0 template:
- HN: `Show HN: engram v0.3 — context as infra for Claude Code`
- r/ClaudeAI: workflow framing with the hook mechanism
- r/SideProject: "I built a Claude Code hook layer that drops session
  tokens 80%" story framing
- Twitter/X thread with the 82% measured reduction on real engram code

---

## Sanity Checklist (all ✅)

- [x] 439/439 tests passing
- [x] tsc --noEmit clean
- [x] npm run build clean (42.5 KB packed, 9 files)
- [x] CLI reports version 0.3.0
- [x] All 7 new commands registered and documented via `--help`
- [x] Dogfood verified: `engram hook-preview` works on engram's own files
- [x] Real benchmark numbers captured
- [x] CHANGELOG entry complete with migration notes
- [x] README hero rewritten with Sentinel framing
- [x] package.json version bumped
- [x] Opportunistic landmines rename landed
- [x] RELEASE-NOTES-v0.3.0.md written

**The branch is ready.** Nick's call on when to merge and publish.
