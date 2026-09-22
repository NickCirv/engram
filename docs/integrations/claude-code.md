# Engram with Claude Code

Use MCP for explicit queries, or opt into a hook that supplies structural context during file access. Evaluate them separately so that you can identify which integration changed an agent response.

```bash
engram init /absolute/path/to/project --no-hook
engram install-hook --dry-run -p /absolute/path/to/project
```

The hook installer supports `--scope local`, `project`, or `user` (default `local`). Review the dry-run target and changes before running without `--dry-run`. Use `uninstall-hook` for removal and `hook-stats` or `hook-preview` to inspect behavior. Read interception can change the information supplied to the model; validate edits against full source.

For MCP, register the executable `engram-serve` with an argument array containing the absolute project path. Six tools are declared, including `query_graph` and `list_mistakes`. The bundled marketplace plugin includes the same process registration and three skills; its discovery and installation commands depend on the installed Claude Code version.

`engram init` without `--no-hook` also enables a Sentinel hook by default. Do not assume an initialization command is read-only. Optional providers and update checks may use the network.

## Evidence and verification

This guide describes the pinned source below. Commands and client integrations were inspected, not executed; external client compatibility remains unverified.

- [src/cli.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/cli.ts)
- [src/serve.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/serve.ts)
- [plugins/anthropic-marketplace/engram/.mcp.json](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/plugins/anthropic-marketplace/engram/.mcp.json)
