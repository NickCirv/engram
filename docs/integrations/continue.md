# Continue.dev Integration

Inject engram's knowledge graph directly into Continue.dev chat via the `@engram` context provider.

## Prerequisites

- engram v0.5+ initialized in your project (`engram init /path/to/project`)
- Continue.dev extension installed in VS Code or JetBrains
- Node.js 18+

## Installation

```bash
npm install engramx-continue
```

## Configuration

Add the provider to `~/.continue/config.json`:

```json
{
  "contextProviders": [
    {
      "name": "engramx-continue"
    }
  ]
}
```

Restart Continue after saving the config.

## Usage

In any Continue chat input, type `@engram` followed by your question:

```
@engram how does the query pipeline work?
@engram what are the known issues with the AST miner?
@engram what architectural decisions were made for the graph schema?
```

The provider runs `engram query "<your text>" -p <workspace> --budget 2000` and injects the result as context before your message is sent to the LLM.

## How It Works

1. **CLI first** — calls `engram query` as a subprocess (5s timeout)
2. **HTTP fallback** — tries `http://127.0.0.1:7337/query` if CLI fails (3s timeout, for Sprint 2 remote mode)
3. **Graceful degradation** — returns empty context if both fail; no errors surface

## Troubleshooting

**`@engram` returns no context**
- Confirm `engram` is on your PATH: `which engram`
- Confirm the graph is initialized: `engram stats -p /path/to/project`
- Check that `.engram/graph.db` exists in your workspace root

**`graph.db not found` error from CLI**
- Run `engram init /path/to/project` to create the initial graph
- Then mine your codebase: `engram mine /path/to/project` (or just open files — the hook auto-mines)

**Stale context**
- Re-index manually: `engram mine /path/to/project`
- Or enable the file watcher: `engram watch /path/to/project`
