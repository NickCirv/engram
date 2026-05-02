# engram for Claude Code

The context spine that 10x's your Claude Code sessions.

[![npm](https://img.shields.io/npm/v/engramx)](https://www.npmjs.com/package/engramx)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

## What it does

engram intercepts file reads in your Claude Code session. Instead of pushing
the full file content into the model, it returns a structural summary from a
local SQLite knowledge graph. On a real 87-file codebase, the measured token
reduction is **89.1%** — same task, far fewer tokens, longer sessions before
hitting limits.

Plus it remembers past mistakes (bi-temporal — they auto-expire when fixed),
auto-generates `CLAUDE.md` and `AGENTS.md`, and works across every MCP-aware
AI coding tool, not just Claude Code.

## Install

This plugin requires the engram CLI. Two commands total:

```bash
npm install -g engramx
cd ~/your-project && engram init .
```

Then install this plugin via Claude Code:

```
/plugin install engram
```

That's it. The next time Claude Code reads a file engram has indexed, you'll
see the structural summary instead of the raw content. Run `/engram:cost`
after a few sessions to see what it saved you.

## What you get

| Skill | When to use |
|---|---|
| `/engram:cost` | Show token-savings telemetry — per project, per week, in dollars |
| `/engram:query` | Ask a structural question without reading files |
| `/engram:mistakes` | List past failure modes engram learned in this project |

Plus an MCP server registered automatically — Claude can call `query_graph`,
`god_nodes`, `graph_stats`, `shortest_path`, `benchmark`, and `list_mistakes`
on its own when the question warrants.

## Example use cases

### 1. "I'm hitting Claude Code rate limits in 90 minutes"

You're on Max 5x ($100/mo). Sessions exhaust before lunch. You install engram and the session counter goes from 21% to 100% no longer happens on a single prompt because engram replaces every Read with a 200-300 token summary. The same agentic refactor that used to burn through 12,000 tokens of context now uses 1,500.

```
/engram:cost
```

After 24 hours: a per-project table showing tokens saved, dollar value, and reduction ratio. Reply to your team Slack with the digest.

### 2. "Where does this codebase handle auth?"

Without engram, Claude reads `auth/middleware.ts`, then `auth/session.ts`, then the four files those import. Each Read costs 800–3000 tokens.

With engram, you ask:

```
/engram:query how does auth work in this project
```

The graph returns one structured response: list of auth-related nodes, their connections, the file paths to drill into if the structural answer isn't enough. About 400 tokens, full answer in one round trip.

### 3. "I keep introducing the same bug"

Your team fixes a race condition in March. In July, a new contributor reintroduces it because the Slack thread is gone and the comment got refactored away. engram remembers:

```
/engram:mistakes
```

Lists every recorded failure with confidence scores. Engram surfaces matching mistakes automatically with ⚠️ at the top of the context packet whenever Claude is about to edit a file related to the bug. Bi-temporal: when a commit fixes the underlying cause, the mistake auto-expires.

```
engram learn "Don't await inside the rate-limiter mutex; deadlocks under load"
```

That one-liner is now a permanent landmine warning for anyone working on rate-limiting code.

### 4. "Multiple AI tools, one codebase"

You use Claude Code in your terminal, Cursor for editing, and Cline for autonomous tasks. Without engram, each tool re-reads the same files independently and pays for context separately. With engram, all three plug into the same `.engram/graph.db`. Index once, save tokens everywhere.

The same `/engram:query` works across all three because engram exposes itself as an MCP server. The graph doesn't care which agent is asking.

### 5. "I want to know what engram is actually doing"

```
engram dashboard
```

Live terminal HUD: hit rate, tokens saved this session, recent interceptions, which providers fired. Watch it for a minute while you work and you'll see exactly what's getting replaced.

```
engram cost --digest
```

Writes a Markdown weekly report at `~/.engram/cost-report-YYYY-Www.md`. Paste into Substack, Slack, or your finance channel.

## Real numbers from real users

- A 5-person team migrating from Cursor was paying $4,600/6 weeks before. After installing engram on Claude Code Max, the same team reports their Max 5x sessions stretch through full workdays without hitting the cap.
- Solo dev going from $2k/week on Cursor to ~1/10th the cost on Claude Code Max + engram is the most-cited migration story in the community.
- Independent migration guides ([dev.to/56kode](https://dev.to/56_kode/why-were-moving-from-cursor-to-claude-code-and-why-you-should-too-9kh), [SpectrumAI](https://spectrumailab.com/blog/claude-code-vs-cursor)) cite engram's 89.1% measurement as the strongest in the category.

## Numbers

- 89.1% measured token reduction on `bench/real-world.ts` — committed to the
  repo, reproducible with `engram bench` on your own codebase
- 907 tests across Ubuntu + Windows × Node 20+22
- 26 npm releases in 23 days; cited at 89% reduction in independent migration
  guides ([dev.to/56kode](https://dev.to/56_kode/why-were-moving-from-cursor-to-claude-code-and-why-you-should-too-9kh),
  [SpectrumAI](https://spectrumailab.com/blog/claude-code-vs-cursor))

## Why local-first

Your code never leaves your machine. The graph lives in `.engram/graph.db` —
a SQLite file you can `cat`, `grep`, copy, delete, sync. No telemetry. No
account. No cloud dependency. Apache 2.0.

## Source

- npm: [`engramx`](https://www.npmjs.com/package/engramx)
- GitHub: [NickCirv/engram](https://github.com/NickCirv/engram)
- Issues: [github.com/NickCirv/engram/issues](https://github.com/NickCirv/engram/issues)

## Author

Nicholas Ashkar — [@NickCirv](https://github.com/NickCirv)
