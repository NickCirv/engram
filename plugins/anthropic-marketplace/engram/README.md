# Engram plugin for Claude Code

This plugin bundles three skill prompts and an MCP process registration. It depends on an installed Engram CLI and an initialized project; the plugin does not supply the graph engine itself.

| Component | Purpose |
| --- | --- |
| `query` skill | Request structural context |
| `mistakes` skill | Inspect stored failure modes |
| `cost` skill | Inspect usage estimates |
| `.mcp.json` | Launch `engram-serve` with `${CLAUDE_PROJECT_DIR}` |

Build or install a reviewed CLI version, then run `engram init /absolute/path/to/project --no-hook` to evaluate queries first. Register the plugin using your client's supported marketplace procedure; discovery and client installation were not verified here. If you choose hooks, inspect `engram install-hook --dry-run -p /absolute/path/to/project` before enabling them.

The MCP server exposes six tools: `query_graph`, `god_nodes`, `graph_stats`, `shortest_path`, `benchmark`, and `list_mistakes`. Ensure the client can resolve `engram-serve` and supplies the intended project path.

Token reports are estimates whose meaning depends on their input records. This plugin does not guarantee subscription headroom, task accuracy, or a particular percentage reduction. Existing skill prompt contracts are preserved separately from this user guide.

## Evidence and verification

This guide describes the pinned source below. Commands and client integrations were inspected, not executed; external client compatibility remains unverified.

- [plugins/anthropic-marketplace/engram/.mcp.json](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/plugins/anthropic-marketplace/engram/.mcp.json)
- [src/serve.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/serve.ts)
- [src/cli.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/cli.ts)
