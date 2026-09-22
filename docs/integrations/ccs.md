# Codebase Context Specification files

Engram imports and exports project documentation at `.context/index.md`. The graph and the human-authored document serve different purposes; review changes before replacing an existing context file.

```bash
engram init /absolute/path/to/project --from-ccs --no-hook
engram gen-ccs -p /absolute/path/to/project
```

Import maps contextual sections to graph concepts, patterns, decisions, and mistakes. Export assembles graph-backed sections for architecture patterns, decisions, known issues, and key concepts. This is a selected view of stored knowledge, not a reversible round-trip preserving every original sentence or layout.

`gen-ccs` is a one-shot command in this revision; there is no `--watch` option. Preserve authored material before generation, inspect the resulting diff, and rerun after relevant graph updates.

## Evidence and verification

This guide describes the pinned source below. Commands and client integrations were inspected, not executed; external client compatibility remains unverified.

- [src/cli.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/cli.ts)
