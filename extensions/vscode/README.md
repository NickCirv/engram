# engram for VS Code & Cursor

Local-first context spine that 10x's your AI coding sessions. Works in VS Code, Cursor, and every VS Code fork.

## What this extension does

This extension is a **thin wrapper around the engramx CLI**. It surfaces the most useful engram commands inside the editor's command palette so you don't have to drop into a terminal. The CLI does all the actual work — that means updates to the CLI (`npm install -g engramx@latest`) immediately apply to the extension without a re-publish.

## Prerequisites

```bash
npm install -g engramx
```

That's it. The extension calls `engram` as a subprocess.

## Commands

Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and type `Engram:`:

| Command | What it does |
|---|---|
| Engram: Initialize knowledge graph | First-run scan, builds `.engram/graph.db` |
| Engram: Generate Cursor rules | Writes `.cursor/rules/engram-context.mdc` |
| Engram: Generate AGENTS.md + CLAUDE.md | Universal agent-instructions files |
| Engram: Show token-savings telemetry | Per-project token-saved table |
| Engram: Open live dashboard | Real-time terminal dashboard |
| Engram: Run health check | `engram doctor` summary |

## Settings

| Setting | Default | What it does |
|---|---|---|
| `engram.cliPath` | `engram` | Path to the engram CLI. Override if not on PATH. |
| `engram.regenerateOnSave` | `false` | Auto-regenerate Cursor rules when files are saved. |

## Why use it

If you're already using Cursor or VS Code with an AI agent (Cline, Continue, GitHub Copilot, Claude in a terminal), engram cuts the tokens they consume by ~89% on real codebases. The graph is local SQLite. Nothing leaves your machine.

## License

Apache-2.0. Source: https://github.com/NickCirv/engram
