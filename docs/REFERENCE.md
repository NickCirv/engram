# engram — command reference

[Overview](../README.md) · [Research record](RESEARCH.md)

Describes revision `9fa2a4b74ca8e66560d74d1255c16c43157d32bd`. Commands are source-inspected; no execution results are asserted.

## Workflow

Indexes source structure, Git relationships and selected session/mistake information into project-local SQLite. Exposes graph queries, caller/callee/impact views, context generation, opt-in hooks, an authenticated local HTTP UI/API and an MCP stdio server.

Requires Node >=20. Build from source before using dist/cli.js. Start indexing with init PATH --no-hook to inspect the graph before installing hooks. Set ENGRAM_NO_UPDATE_CHECK=1 if registry update checks are unwanted; configured providers/plugins have their own data paths.

```bash
node dist/cli.js stats --project ../your-project
```

## Commands and controls

| Control | Behavior in the inspected implementation |
| --- | --- |
| `query QUESTION` | Retrieve a graph view |
| `--project PATH` | Choose the indexed project for commands that declare this flag |
| `--budget N` | Set query estimated-token budget |
| `--depth N` | Set query traversal depth |
| `init PATH --no-hook` | Index without installing the default Sentinel hook |

## Command families

| Task | Commands and important controls |
| --- | --- |
| Index | `init PATH --no-hook`; `--incremental` for incremental work, `--from-ccs` to import context |
| Retrieve | `query QUESTION` with `--depth` (3), `--budget` (2000), optional `--dfs`; `gods --top 10`; `callers`, `callees`, `impact`, `path` |
| Inspect history | `learn`, `mistakes --limit 20 --since DAYS`; `--since` is numeric days |
| Generate context | `gen`, `gen-mdc`, `gen-aider`, `gen-windsurfrules`, `gen-ccs`; only generators declaring `--watch` support it |
| Hooks | `install-hook --dry-run --scope local`, `uninstall-hook`, `hook-preview`, `hook-stats`, `hook-disable`, `hook-enable` |
| Serve | `server --http --port 7337`, `ui --no-open`, `context-server`; MCP executable `engram-serve PROJECT` |
| Database | `db status`, `db migrate`, `db rollback`; rollback to zero can drop stored data |
| Providers/cache | `plugin list/install/remove`; `cache stats/clear/warm` |
| Diagnose/update | `doctor --json`, `setup --dry-run`, `update --check`, `update --dry-run`, `tune --dry-run` |
| Measurement | `measure`, `cost --json`, `bench`; inspect input provenance and distinguish estimates from measurements |

Use `--project` only where the command declares it; initialization and the MCP executable take positional project paths. Run the installed command's help after an upgrade rather than assuming every subcommand shares the same options.

## Detailed guides

[Installation](../llms-install.md), [integration interfaces](INTEGRATION.md), [editor guides](integrations/README.md), [providers](plugins/README.md), and [benchmark interpretation](../bench/README.md) cover setup and operating boundaries.

## Interpretation and side effects

Graph summaries are retrieval aids, not execution traces or complete semantic understanding. Hook output can change what an agent sees. Token estimates and fixture benchmarks are not invoice savings or proof of task accuracy; measure both quality and cost on your workload.

## Implementation reference

- [package.json](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/package.json)
- [src/cli.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/cli.ts)
