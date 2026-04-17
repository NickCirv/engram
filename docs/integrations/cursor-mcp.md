# Cursor — MCP mode

engram supports **two** Cursor integration paths. Most users want both.

| Mode | Trigger | What you get |
|------|---------|--------------|
| **MDC file** (passive) | Every Cursor chat session | Static `.cursor/rules/engram-context.mdc` with architecture + landmines + patterns |
| **MCP server** (active) | When the agent chooses | Live graph queries via `query_graph`, `god_nodes`, `shortest_path`, etc. |

This page covers the MCP path. For the MDC generator see
[cursor.md](./cursor.md) or run `engram gen-mdc --watch`.

## Why use both

The MDC file is a snapshot — always in context, always fresh-ish (if you
run `--watch`), but limited to ~200 bullets. The MCP server is on-demand
— the agent can issue arbitrary structural queries when a question
requires more than the snapshot contains.

Think of it as: **MDC = your project's short README, MCP = its search
interface.**

## Prerequisites

```bash
npm install -g engramx
cd ~/your-project
engram init .
```

## Configure Cursor

**1. Open Cursor settings**

`Cursor Settings` → `MCP` → `+ Add new MCP server`

**2. Register engram**

```json
{
  "mcpServers": {
    "engram": {
      "command": "engram-serve",
      "args": []
    }
  }
}
```

Paste this into the MCP config editor and save. Cursor will restart the
MCP connection automatically.

**3. Verify**

Open a chat and ask:

> "Use engram to list the god nodes in this project."

Cursor should show a tool-use indicator and return the top-connected
entities from your graph.

## Available tools

| Tool | Example agent query |
|------|---------------------|
| `query_graph` | *"Use engram to find everything related to auth."* |
| `god_nodes` | *"What are the core entities in this codebase?"* |
| `graph_stats` | *"How big is the knowledge graph?"* |
| `shortest_path` | *"Trace the call path from handleRead to queryGraph."* |
| `benchmark` | *"Measure engram's token savings on this repo."* |
| `list_mistakes` | *"What bugs have been fixed in auth recently?"* |

## Combining with .cursorrules / MDC

The MDC file loads passively. When Cursor needs more — say, the user asks
about a file that isn't in the top-10 god nodes — the agent can call
`query_graph` through MCP to pull relevant structural context on demand.

This is the Context Spine pattern: cheap passive context + targeted
live queries. engram's 88.1% measured token savings comes from letting
the agent decide when to spend tokens vs when to rely on the snapshot.

## Troubleshooting

**Cursor shows "MCP server failed to start"**

Run from the same terminal Cursor was launched from:

```bash
engram-serve
```

If it prints `{"jsonrpc":"2.0",...}` or waits silently, the server works.
Common fixes:
- Install globally: `npm install -g engramx`
- On macOS GUI launch, set the full path: `"command": "/opt/homebrew/bin/engram-serve"`

**Tools appear but calls error with "no graph"**

Cursor runs MCP servers with `cwd = HOME`, not the project directory.
Pass `-p` explicitly or `cd` inside the server wrapper:

```json
{
  "command": "sh",
  "args": ["-c", "cd \"$PWD\" && engram-serve"]
}
```

Or, simpler: use the HTTP API (port 7337) and tell Cursor your project
root at query time.
