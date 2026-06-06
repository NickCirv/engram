# Installing engram (guide for AI agents like Cline)

engram is a local code-graph context layer for AI coding agents. It indexes a
repository into a local SQLite knowledge graph and exposes it over MCP (stdio),
so the agent can ask about code structure, call sites, and git-mined mistakes
instead of re-reading whole files. **Apache-2.0, local-only, zero cloud, no API
key, no account.**

## 1. Install the CLI

```bash
npm install -g engramx
```

(Or skip the global install and run it on demand with `npx` — see the MCP
config below, which uses `npx`.)

## 2. Index the project

```bash
cd /absolute/path/to/the/project
engram init .
```

This builds `.engram/graph.db` from the repo (AST extraction + git history). It
runs entirely locally and takes a few seconds on a typical repo.

## 3. Register engram as an MCP server

Add this to the MCP settings (in Cline: **MCP Servers → Configure**, i.e.
`cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": ["-y", "-p", "engramx", "engram-serve", "/absolute/path/to/the/project"]
    }
  }
}
```

Replace `/absolute/path/to/the/project` with the absolute path to the repo you
indexed in step 2.

## 4. Verify

```bash
engram doctor -p /absolute/path/to/the/project
```

It should report that the graph is present and the AST provider is reachable.

## MCP tools you get

- `query_graph` — natural-language search of the code graph
- `god_nodes` — the most-connected entities (core abstractions)
- `graph_stats` — node / edge counts and confidence breakdown
- `shortest_path` — trace the connection between two symbols
- `benchmark` — the **structural** context-token reduction on this repo (a
  reduction in tokens entering context, **not** a dollar/bill saving — your real
  cost is dominated by prompt caching)

## Notes

- **Requirements:** Node ≥ 20. For the grep call-site feature, `ripgrep` (`rg`)
  on `PATH` (optional — engram falls back gracefully without it).
- **Keeping the graph fresh:** re-run `engram init .` after large changes, or
  `engram reindex <file>` for one file, or `engram install-hook` to update it
  automatically as files change.
- **Privacy:** nothing leaves the machine — engram never makes a network call
  and stores everything in local SQLite under `.engram/`.
