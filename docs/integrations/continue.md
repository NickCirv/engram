# Engram with Continue

The included adapter implements a query context provider. It calls the CLI first and uses the first workspace directory as the project root.

```bash
engram init /absolute/path/to/project --no-hook
engram query "authentication" -p /absolute/path/to/project --budget 2000
```

The adapter invokes `engram query QUESTION -p WORKSPACE --budget 2000` with a five-second process timeout. Empty queries yield no context. The CLI must be available on the editor process PATH; installation alone does not register a custom provider with Continue.

## Compatibility limit

The fallback requests `http://127.0.0.1:7337/query` with a three-second timeout but sends no bearer token. The current HTTP service protects that route, so the fallback is not a working authenticated replacement without an adapter change. Use the CLI path and surface failures during evaluation. Continue custom-provider registration was not tested against a current client release.

See the [adapter guide](../../adapters/continue/README.md) for its source boundary.

## Evidence and verification

This guide describes the pinned source below. Commands and client integrations were inspected, not executed; external client compatibility remains unverified.

- [adapters/continue/src/index.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/adapters/continue/src/index.ts)
- [src/cli.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/cli.ts)
