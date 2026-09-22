# Editor and agent integrations

Start with an indexed project and one integration. Multiple automatic context paths can duplicate material or alter an agent's reads in ways that are difficult to diagnose.

| Guide | Connection model |
| --- | --- |
| [Claude Code](claude-code.md) | Optional hooks and MCP |
| [Cursor](cursor-mcp.md) | MCP or generated rules |
| [Cline](cline.md) | MCP process registration |
| [Continue](continue.md) | Included context-provider adapter |
| [Zed](zed.md) | Experimental JSON-RPC adapter |
| [Aider](aider.md) | Generated `.aider-context.md` |
| [CCS](ccs.md) | Import/export `.context/index.md` |
| [Neovim](neovim.md) | CLI or a separately configured MCP-capable plugin |
| [Emacs](emacs.md) | CLI or a separately configured MCP-capable client |

```bash
engram init /absolute/path/to/project --no-hook
engram query "a known symbol" -p /absolute/path/to/project
```

Resolve the CLI executable explicitly in editor environments, which often have a different PATH from your terminal. Client configuration locations and extension APIs vary by version; the guides document the Engram process contract rather than asserting current marketplace support.

`gen-mdc`, `gen-aider`, and `gen-windsurfrules` expose watch mode. `gen-ccs` does not expose `--watch` in this revision. Regenerate after re-indexing and review diffs before committing.

## Evidence and verification

This guide describes the pinned source below. Commands and client integrations were inspected, not executed; external client compatibility remains unverified.

- [src/cli.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/cli.ts)
- [src/serve.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/serve.ts)
