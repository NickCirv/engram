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
