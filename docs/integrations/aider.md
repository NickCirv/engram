# Generate context for Aider

Engram can write a static context snapshot for a coding session. This path does not require the HTTP server or an interception hook.

```bash
engram init /absolute/path/to/project --no-hook
engram gen-aider -p /absolute/path/to/project
```

The generator writes `.aider-context.md` in the project. Review the file before loading it as read-only context in Aider. The previous guide used this Aider configuration shape; verify it against your installed client:

```yaml
read:
  - .aider-context.md
```

Generated sections draw on graph architecture, hot files, known issues, decisions, and patterns. A snapshot is only as current as its source graph. Re-index after source changes, then regenerate. `engram gen-aider --watch -p /absolute/path/to/project` is a long-running refresh mode.

The HTTP service exists in this revision, but `/query` requires authentication. Do not reuse the earlier guide's unauthenticated curl append command or treat a static snapshot as a live retrieval API.

## Evidence and verification

This guide describes the pinned source below. Commands and client integrations were inspected, not executed; external client compatibility remains unverified.

- [src/cli.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/cli.ts)
