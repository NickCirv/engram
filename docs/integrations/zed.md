# engram — Zed Context Server

Exposes engram's knowledge graph as a Zed slash command via the context server protocol (JSON-RPC over stdio).

## Prerequisites

- engram installed globally: `npm install -g engramx`
- Project indexed: `engram init` run in your project root

## Setup

Add to your Zed `settings.json`:

```json
{
  "context_servers": {
    "engram": {
      "command": {
        "path": "engram",
        "args": ["context-server"]
      }
    }
  }
}
```

Open `~/.config/zed/settings.json` (macOS) or `~/.local/config/zed/settings.json` (Linux) and merge the block above.

## Usage

In Zed's agent panel, type `/engram` followed by your query:

```
/engram auth flow
/engram database schema decisions
/engram known issues GraphStore
```

engram queries the local knowledge graph and injects matching context — architecture nodes, past decisions, mistake warnings — directly into the AI's prompt.

## How It Works

1. Zed sends `context/list` on startup — engram advertises the `engram` slash command.
2. When you invoke `/engram <query>`, Zed sends `context/fetch` with `{ query, project }`.
3. The server runs `engram query <query> -p <project> --budget 2000` as a subprocess.
4. The result (nodes, edges, mistake warnings) is returned as text and injected into context.

## Optional: Per-Project Config

Pass a specific project path via the `project` param. By default the server uses `process.cwd()` at the time Zed launches it.

## Troubleshooting

- **"engram query failed"** — run `engram init` in your project root, then `engram` (mines the codebase).
- **No results** — try a broader query, or run `engram stats -p .` to check node count.
- **Command not found** — ensure `engram` is on your `PATH` (`which engram`).
