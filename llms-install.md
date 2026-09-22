# Install Engram from a pinned checkout

Engram builds a persistent SQLite graph for a local codebase. Node.js 20 or later is required by the package manifest. Use a disposable project to evaluate indexing and context output before connecting an agent.

```bash
npm install
npm run build
node dist/cli.js init /absolute/path/to/project --no-hook
node dist/cli.js stats -p /absolute/path/to/project
node dist/cli.js query "authentication" -p /absolute/path/to/project --budget 2000
```

Run these commands from a checkout of the revision cited below. `npm install` can run dependency lifecycle scripts; review the dependency set first. Native dependencies and grammar bundling may require local build support. The build creates the declared CLI artifacts. Package publication and a clean-machine install were not checked.

## Decide which integration to enable

- Query-only: use the CLI, or launch `node /absolute/path/to/engram/dist/serve.js /absolute/path/to/project` as an MCP stdio process.
- Generated context: use `gen`, `gen-mdc`, `gen-aider`, or `gen-ccs`; inspect the resulting file diff.
- Read interception: preview `install-hook --dry-run -p /absolute/path/to/project` before selecting the desired configuration scope.

`init` installs a Sentinel hook by default; `--no-hook` disables that initialization step. Indexing writes `.engram/graph.db` and associated local state. Never treat a graph summary as a replacement for reading the implementation before editing it.

## Continue with the appropriate guide

- [User manual](docs/USER-MANUAL.md): skills indexing, generated instructions, verification, troubleshooting and removal.
- [Sentinel](docs/SENTINEL.md): current event families, read gates and mistake-guard behavior.
- [Editor integrations](docs/integrations/README.md): per-client process contracts and known gaps.
- [Providers](docs/plugins/README.md): reviewed JavaScript and MCP extension configuration.
- [Command reference](docs/REFERENCE.md): the available command families.

The manifest identifies the npm package as `engramx`, but this review did not verify package availability or published artifacts. The pinned source build above is the reproducible starting point. Avoid copying output counts, timings or passing-test totals from older installation pages.

## Network and recovery

Core graph operations are local. Update checks contact the npm registry unless disabled with `ENGRAM_NO_UPDATE_CHECK=1` or CI detection. Optional providers can launch processes or make network requests. Review provider configuration before enabling it.

Use `doctor` to inspect setup, `db status` before migration, and make a filesystem backup before destructive database operations. `db rollback --to 0 --yes` is destructive; it is not a routine troubleshooting step.

## Evidence and verification

This guide describes the pinned source below. Commands and client integrations were inspected, not executed; external client compatibility remains unverified.

- [package.json](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/package.json)
- [src/cli.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/cli.ts)
- [src/serve.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/serve.ts)
