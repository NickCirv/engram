# Continue context provider

This adapter retrieves Engram context for a Continue query. It is source for an integration, not evidence of a published or installed extension.

## Process contract

The provider uses the first workspace root and executes `engram query QUESTION -p ROOT --budget 2000` with `execFile`, a five-second timeout, and separate arguments. Empty queries return an empty context list. Ensure the CLI is built, available on the editor's PATH, and that the workspace has been indexed.

The fallback HTTP request uses loopback port 7337 and a three-second timeout. It currently supplies no authentication header, while Engram's HTTP `/query` route requires authentication. A failed fallback must not be interpreted as proof that no context exists.

## Integration checklist

1. Run the equivalent CLI query from the editor environment.
2. Register this provider using the custom-provider API supported by your Continue version.
3. Check a known symbol, a blank query, a missing graph, and a missing executable.
4. Inspect returned context against source before permitting an agent to edit.

The current Continue API and client loading procedure were not executed or externally verified.

## Evidence and verification

This guide describes the pinned source below. Commands and client integrations were inspected, not executed; external client compatibility remains unverified.

- [adapters/continue/src/index.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/adapters/continue/src/index.ts)
