# Engram with Cursor

The stable boundary in this repository is an executable and an absolute project path. Client-specific UI labels and configuration formats were not tested in this review.

```bash
engram init /absolute/path/to/project --no-hook
engram query "a known symbol" -p /absolute/path/to/project --budget 2000
```

## MCP process settings

| Setting | Value |
| --- | --- |
| Command | Absolute path to `engram-serve`, or `node` |
| Arguments | Project path; with Node, prepend the absolute path to `dist/serve.js` |
| Transport | Stdio |
| Working directory | The project being indexed |

The server declares `query_graph`, `god_nodes`, `graph_stats`, `shortest_path`, `benchmark`, and `list_mistakes`. Register the process using your client's documented MCP configuration. Do not paste a shell command into a configuration field that expects an executable and array.

Alternatively, `engram gen-mdc -p /absolute/path/to/project` writes Cursor-oriented rules; `--watch` keeps that generator running. Review generated changes before use.

## Diagnose a missing result

Check that the editor can locate the executable, that the project path matches the initialized graph, and that `engram stats -p /absolute/path/to/project` reports the expected project. A successful CLI query does not verify the client's MCP handshake. Inspect both separately.

## Evidence and verification

This guide describes the pinned source below. Commands and client integrations were inspected, not executed; external client compatibility remains unverified.

- [src/cli.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/cli.ts)
- [src/serve.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/serve.ts)
