# engram integrations

engram integrates with every major AI coding tool — usually via the Model
Context Protocol (MCP), sometimes via a static rules file, sometimes via a
native hook. Pick the path that matches your IDE.

## By IDE

| IDE / Editor | Integration doc | Mechanism |
|--------------|-----------------|-----------|
| Claude Code | [claude-code.md](./claude-code.md) | Hook-based interception (native, automatic) |
| Cursor | [cursor-mcp.md](./cursor-mcp.md) *(active)* + MDC file *(passive)* | MCP server + `.cursor/rules/*.mdc` |
| Continue.dev | [continue.md](./continue.md) | `@engram` context provider |
| Zed | [zed.md](./zed.md) | Context server (JSON-RPC) — `/engram` slash command |
| Aider | [aider.md](./aider.md) | `.aider-context.md` static snapshot |
| Windsurf (Codeium) | MCP server — register `engram-serve` | See [cursor-mcp.md](./cursor-mcp.md); Windsurf supports MCP natively with the same config. Also: `engram gen-windsurfrules` for a `.windsurfrules` snapshot. |
| Neovim | [neovim.md](./neovim.md) | MCP via codecompanion.nvim or avante.nvim |
| Emacs | [emacs.md](./emacs.md) | MCP via gptel-mcp |

## By mechanism

### Active (MCP server)

The agent decides when to call engram. Best for structural queries that
vary per question — *"what calls X?"*, *"trace the path from A to B"*.
Register the `engram-serve` binary:

```json
{
  "mcpServers": {
    "engram": { "command": "engram-serve", "args": [] }
  }
}
```

Tools exposed: `query_graph`, `god_nodes`, `graph_stats`,
`shortest_path`, `benchmark`, `list_mistakes`.

### Passive (static snapshot)

engram writes a markdown file your IDE auto-loads. Best for cheap
always-on context — architecture, decisions, landmines.

| Command | File | Consumer |
|---------|------|----------|
| `engram gen-mdc` | `.cursor/rules/engram-context.mdc` | Cursor |
| `engram gen-windsurfrules` | `.windsurfrules` | Windsurf |
| `engram gen-aider` | `.aider-context.md` | Aider |
| `engram gen-ccs` | `.context/index.md` | CCS-compatible tools |

All static generators accept `--watch` to regenerate automatically on
graph changes.

### Hook-based (interception)

Claude Code only. engram intercepts `Read`/`Edit`/`Write` tool calls and
injects a structural summary inline. Install with:

```bash
engram install-hook
```

This is the path that delivers the measured 88.1% session-level token
savings (see [EngramBench v0.2](../../bench/README.md)).

## Composition

These paths compose. A typical production setup:

- **Claude Code:** hooks for automatic Read interception
- **Any other IDE:** MCP server for ad-hoc queries + a static snapshot for
  always-on architecture context

engram's graph is a single source of truth — all paths read from the same
`.engram/graph.db`. You don't need to re-index per IDE.
