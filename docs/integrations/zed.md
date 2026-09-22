# Engram Zed adapter

The included adapter is an experimental JSON-RPC bridge with `context/list` and `context/fetch` handlers. Its source does not establish compatibility with a current Zed extension API.

`context/list` describes Engram context. `context/fetch` accepts a query and project, then executes `engram query QUESTION -p PROJECT --budget 2000` with an eight-second timeout. Index the project and check the CLI independently before attempting client integration.

```bash
engram init /absolute/path/to/project --no-hook
engram query "authentication" -p /absolute/path/to/project --budget 2000
```

Treat the adapter as implementation material for a version-specific integration. Verify the client's protocol, process launch, error handling, and cancellation support before describing it as an installed extension. No marketplace publication or live Zed session was verified.

## Evidence and verification

This guide describes the pinned source below. Commands and client integrations were inspected, not executed; external client compatibility remains unverified.

- [adapters/zed/index.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/adapters/zed/index.ts)
- [src/cli.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/cli.ts)
