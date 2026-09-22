# Choosing a context integration

Choose an integration by the context your task needs and the behavior you can verify in your environment. This document describes Engram's interfaces; it does not rank competitors or assert current third-party features.

| Need | Engram path | Tradeoff to test |
| --- | --- | --- |
| Find symbols and structural relationships | Local graph queries, callers/callees/path | Parser coverage and graph freshness |
| Supply project context as a file | Context generators | Snapshot staleness and authored-file replacement |
| Let an agent query on demand | MCP tools | Client handshake, permissions and tool selection |
| Add context during reads | Optional hooks | Whether summaries omit details required for the task |
| Combine external knowledge | Providers/plugins | Egress, trust, latency and conflicting context |
| Inspect local usage | Cost and measurement commands | Estimation assumptions and completeness of records |

A useful evaluation pairs the same tasks and repository revision, scores correctness independently, and records actual usage. Test missing symbols and failed retrieval, not only successful queries. A smaller context block can still omit a critical condition. Fixture benchmarks and historical showcase numbers do not establish real-world savings.

Use the CLI with `--no-hook` initialization for a retrieval-only starting point, then add one integration at a time.

## Evidence and verification

This guide describes the pinned source below. Commands and client integrations were inspected, not executed; external client compatibility remains unverified.

- [src/cli.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/cli.ts)
- [src/serve.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/serve.ts)
- [bench/runner.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/bench/runner.ts)
