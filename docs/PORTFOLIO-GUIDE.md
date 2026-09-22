# Engram — architecture and integration guide

[Overview](../README.md) · [Research record](RESEARCH.md)

This guide describes the pinned source revision `9fa2a4b74ca8e66560d74d1255c16c43157d32bd`. Examples are source-inspected and were not executed.

## Local graph workflow

`init PATH --no-hook` indexes without the default hook installation. `query QUESTION --project PATH` reads the indexed graph; the inspected defaults are depth 3 and a 2,000-token estimated budget. `watch PATH` maintains a long-running watcher, while `reindex FILE --project PATH` updates a selected file. Use `stats --project PATH` to inspect the graph before relying on it.

The graph path is derived from the project root in [core.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/core.ts), rather than a single global graph shared by every project. Indexing takes a lock to avoid concurrent writers. Treat stale-lock removal as a recovery operation after checking that no indexer is active.

## Source map

| Area | Implementation | Responsibility |
| --- | --- | --- |
| Public API | [src/index.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/index.ts) | Exports init, query, path, godNodes, stats, benchmark, learn and mistakes |
| Orchestration | [src/core.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/core.ts) | Indexing and graph-facing operations |
| Persistence | [src/graph/store.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/graph/store.ts) | SQLite graph, metadata and cache storage |
| Mining | [src/miners/ast-miner.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/miners/ast-miner.ts) | Entity extraction and supported source extensions |
| Retrieval | [src/graph/query.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/graph/query.ts) | Graph queries and rendering |
| Providers | [src/providers/resolver.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/providers/resolver.ts) | Context assembly and optional providers |
| Agent interception | [src/intercept/dispatch.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/dispatch.ts) | Hook dispatch |
| HTTP | [src/server/http.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/server/http.ts) | Local routes, UI and access checks |
| MCP | [src/serve.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/serve.ts) | JSON-RPC tool calls over stdio |

The resolver lists nine built-in providers and loads additional plugins/MCP configurations. Availability and successful contribution are separate: a declared provider may return nothing when its integration is absent.

## Programmatic example

After the source build, a script inside this checkout can use the public exports:

```javascript
import { init, query, stats } from './dist/index.js';

const project = '../your-project';
await init(project);
const result = await query(project, 'authentication', {
  depth: 2,
  tokenBudget: 2000,
});
console.log(result.text);
console.log(await stats(project));
```

The direct `init` API builds the graph. CLI convenience behavior, including hook installation, belongs to the CLI path. Treat the returned estimate as an approximation rather than provider billing.

## MCP integration

Point an MCP-capable client at a reviewed local build and the indexed project:

```json
{
  "mcpServers": {
    "engram": {
      "command": "node",
      "args": ["/absolute/path/to/engram/dist/serve.js", "/absolute/path/to/project"]
    }
  }
}
```

The inspected tool catalogue contains `query_graph`, `god_nodes`, `graph_stats`, `shortest_path`, `benchmark` and `list_mistakes`. The client receives graph-derived text; consider the client's provider/data policy separately. MCP interoperability with a particular client version was not tested in this review.

## HTTP and dashboard

```bash
node dist/cli.js server --http --project ../your-project --port 7337
```

The server binds to loopback. `/health` is a minimal public health route; graph/data routes require authentication. The implementation accepts `Authorization: Bearer <token>` or its dashboard cookie. Token resolution uses an environment token of at least 32 characters, then `~/.engram/http-server.token`, then generates a new token. Do not commit that file or paste the dashboard bootstrap URL into public reports.

`ui --no-open` starts the UI path without automatically opening a browser. Custom allowed origins are controlled through `ENGRAM_ALLOWED_ORIGINS`; extending this list changes the access boundary. Mutation routes require JSON content type. The source includes security tests, but no test results are asserted here.

## Hooks and removal

Preview installation with `install-hook --dry-run --project PATH` and inspect the selected scope. `hook-disable` provides a project kill switch; `hook-enable` removes it. `uninstall-hook` removes the configured integration. Keep the existing uninstall notes and changelog for migration history, but verify scope against command help rather than assuming an older default.

## Evidence and maintenance

Preserve the graph/retrieval tests when changing output or storage. For a release, run the build, type checking, tests and representative indexing/integration workflows; record actual results. Benchmarks should report dataset, revision, baseline, cache state, token-estimation method and task quality. No generated-art banner or documentation badge substitutes for those results.
