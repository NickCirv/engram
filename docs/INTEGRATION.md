# Integrating Engram

Choose the smallest interface that supplies the context your application needs. The CLI and generators operate on a project graph; the MCP server exposes tool calls; the HTTP service supports the dashboard and authenticated requests.

| Interface | Entry point | Integration boundary |
| --- | --- | --- |
| CLI | `engram query "question" -p /path/to/project --budget 2000` | Capture stdout, inspect exit status, bound process runtime |
| MCP | `engram-serve /path/to/project` | Stdio JSON-RPC; six tool definitions |
| HTTP | `engram server --http -p /path/to/project --port 7337` | Loopback service with Host/Origin checks and authentication |
| Static context | `engram gen-aider -p /path/to/project` | Review and refresh generated files |
| Library | exports in `src/index.ts` | Build the package and follow the exported TypeScript signatures |

Initialize with `engram init /path/to/project --no-hook` when evaluating retrieval without installing a hook. The graph persists under `.engram`; concurrent writer protection does not make backups unnecessary.

## MCP contract

The server defines `query_graph`, `god_nodes`, `graph_stats`, `shortest_path`, `benchmark`, and `list_mistakes`. The project path is the server process's first positional argument. Configure your client's executable path and argument array; avoid shell interpolation. Keep process logging off the JSON-RPC stdout channel.

## HTTP contract

`GET /health` is public. Graph queries use **GET `/query`**, with `q` and `budget` query parameters. `/stats`, `/providers`, dashboard `/api/*` routes, SSE/context streams, and `POST /learn` are protected. The server accepts bearer authentication or its dashboard cookie; JSON mutations require an appropriate JSON content type.

`ENGRAM_API_TOKEN` must contain at least 32 characters; otherwise the service generates a token file at `~/.engram/http-server.token` with restrictive permissions. Keep tokens out of logs and committed client configuration. A 401 from an adapter is an authentication failure, not an empty graph.

## Integrating another tool

Invoke the CLI with an executable and argument array, capture stdout/stderr separately, set a timeout, and check the exit status before interpreting output. A successful graph lookup does not establish that a downstream editor consumed it correctly.

The package's public `src/index.ts` exports `query`, `godNodes`, `stats`, `mistakes`, `GraphStore` and other declared APIs. The old HTML imported `getFileContext` and `getStore` from the package root, but those helpers are not exported there in this revision. Use the public exports and their actual signatures; do not copy that historical import example.

```javascript
import { query, stats } from './dist/index.js';

const project = '/absolute/path/to/project';
console.log(await stats(project));
const result = await query(project, 'authentication', {
  depth: 2,
  tokenBudget: 2000,
});
console.log(result.text);
```

Run this source-inspected example from the built package checkout after indexing the project. For another package consuming a published artifact, verify its export map and installed version separately.

The historical `subHooks` configuration was labeled a future design; this guide does not treat it as a supported interface. Use the implemented provider contract for additional context, documented in [providers and plugins](plugins/README.md). A memory, review or compression tool should retain source provenance and distinguish Engram summaries from raw file contents.

## Hook coexistence

The dispatcher now includes Grep and additional lifecycle events, so the older recommendation that Grep hooks cannot overlap is obsolete. Test each installed hook and their combined configuration, including passthrough, denial, exceptions and compaction. Do not presume that separate context injections compose cleanly. The [Sentinel guide](SENTINEL.md) documents the current event families and guard defaults.

## Data and quality boundaries

Query results carry `text`, `estimatedTokens`, and `nodesFound` in the library interface. Estimated tokens measure context size, not answer quality or invoice savings. Built-in and configured providers may add external context or execute processes. Test each integration with a known symbol, inspect the original file, and verify missing-index and authentication errors separately.

## Evidence and verification

This guide describes the pinned source below. Commands and client integrations were inspected, not executed; external client compatibility remains unverified.

- [src/index.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/index.ts)
- [src/serve.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/serve.ts)
- [src/cli.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/cli.ts)
- [src/providers/mcp-config.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/providers/mcp-config.ts)

- [HTTP routes](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/server/http.ts)
- [Authentication](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/server/auth.ts)
