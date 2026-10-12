# Continue context provider

This adapter retrieves Engram context for a Continue query. It is source for an integration, not evidence of a published or installed extension.

## Process contract

The provider uses the first workspace root and executes `engram query QUESTION -p ROOT --budget 2000` with `execFile`, a five-second timeout, and separate arguments. Empty queries return an empty context list. Ensure the CLI is built, available on the editor's PATH, and that the workspace has been indexed.

The fallback HTTP request uses loopback port 7337 and a three-second timeout. It resolves the server token the same way the server documents for external callers (the `ENGRAM_API_TOKEN` environment variable, then `~/.engram/http-server.token`) and sends it as `Authorization: Bearer`. Engram's HTTP `/query` route is fail-closed, so without a resolvable token the request receives 401 and the provider returns no items. A failed fallback must not be interpreted as proof that no context exists.

## Integration checklist

1. Run the equivalent CLI query from the editor environment.
2. Register this provider using the custom-provider API supported by your Continue version.
3. Check a known symbol, a blank query, a missing graph, and a missing executable.
4. Inspect returned context against source before permitting an agent to edit.

The current Continue API and client loading procedure were not executed or externally verified.

## Evidence and verification

This guide describes the source below. The HTTP fallback's auth path is executed against a fixture server in `tests/adapters/continue-http-auth.test.ts`; external Continue client compatibility remains unverified.

- [adapters/continue/src/index.ts](../../adapters/continue/src/index.ts) (earlier inspected revision: [pinned blob](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/adapters/continue/src/index.ts))
