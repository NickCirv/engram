# Engram user manual

Use Engram to index a project's structure, retrieve focused context, and optionally connect that context to an agent. Start with direct queries so you can inspect the graph before enabling automatic hooks.

## Prerequisites and installation

The package manifest requires Node.js 20 or later. Follow the [pinned-checkout installation guide](../llms-install.md) to install dependencies and build the CLI. Git supplies history for Git-backed features. An AI editor is optional for direct CLI queries; its own integration requirements apply when using hooks or MCP.

The examples below assume the built `engram` executable is available on PATH. From a source checkout, substitute `node /absolute/path/to/engram/dist/cli.js`. Check `engram --version` and `engram --help`; do not compare them against version strings printed in older HTML walkthroughs.

## Build and inspect the graph

```bash
engram init /absolute/path/to/project --no-hook
engram stats -p /absolute/path/to/project
engram query "authentication" -p /absolute/path/to/project --budget 2000
engram gods -p /absolute/path/to/project --top 10
```

Indexing writes `.engram/graph.db` and related local state. A query result is selected structural evidence; inspect referenced source before making an edit. Add intended exclusions to `.engramignore` before indexing, and inspect the miner's matching rules rather than assuming full Git ignore syntax or secret detection.

`engram watch /absolute/path/to/project` is a long-running watcher. `engram reindex src/example.ts -p /absolute/path/to/project` refreshes a selected file. Graph freshness still depends on successful indexing and supported extraction; neither a watcher nor a hook guarantees that every change was captured.

## Add skill context

```bash
engram init /absolute/path/to/project --with-skills /absolute/path/to/skills --no-hook
```

The optional skills path indexes instructional material along with source context. Omitting the path after `--with-skills` selects the default skills directory described by the CLI. Review the material before letting it enter an agent's context; indexing a skill does not install or execute it.

## Generate project instructions

```bash
engram gen -p /absolute/path/to/project --task refactor
engram memory-sync -p /absolute/path/to/project --dry-run
```

`gen` defaults to both `CLAUDE.md` and `AGENTS.md`; `--target claude`, `cursor`, or `agents` selects one target. Task views include `general`, `bug-fix`, `feature`, and `refactor`. Review generated diffs against your authored project rules. The older `gen --memory-md` example is not supported by this parser; use the separate `memory-sync` command and preview it first.

## Enable an agent hook

```bash
engram install-hook --dry-run --scope local -p /absolute/path/to/project
engram hook-preview /absolute/path/to/project/src/example.ts -p /absolute/path/to/project
```

Preview shows proposed configuration changes or a Read-handler decision; neither command establishes live client interoperability. After reviewing the installer preview, running `install-hook` without `--dry-run` changes the selected client settings. The parser defaults to local scope; project scope is shared configuration and user scope applies more broadly. Initialization without `--no-hook` also installs a hook by default.

Read the [Sentinel guide](SENTINEL.md) for interception, guard modes, coexistence and recovery. The CLI's `hook-stats` summarizes captured hook events; token estimates do not establish answer quality or billing savings.

## Git hook automation and its current limitation

`engram hooks install PROJECT`, `hooks status PROJECT`, and `hooks uninstall PROJECT` manage marked sections in post-commit and post-checkout hooks. They are separate from agent hooks. The source appends to existing hooks and removes its marked sections on uninstall.

**Automatic rebuilding needs a code correction in this revision.** The generated hook invokes `init . --quiet`, but the inspected `init` parser does not declare `--quiet`. The fallback executable path also refers to a global `/engram/` directory although the package is named `engramx`. Hook discovery assumes `.git/hooks` and does not establish linked-worktree or custom `core.hooksPath` support. Prefer a reviewed manual refresh or watcher until these paths are corrected and tested. Do not install the hooks expecting guaranteed freshness.

## Verify and troubleshoot

| Symptom | Investigation |
| --- | --- |
| CLI cannot be found | Confirm the source build and executable path in the actual shell/editor environment |
| No or few graph nodes | Check project selection, supported source extensions and exclusions; inspect extraction results |
| Query seems stale | Refresh the graph, check the indexing process and inspect current source |
| A Read passes through | Check explicit partial-read arguments, kill switch, graph coverage/freshness and preview decision; passthrough can be intentional |
| HTTP query returns 401 | Configure authentication; a public health response does not authorize graph routes |
| Editor command fails but CLI works | Check the editor PATH, project argument and documented adapter limitations |

Use `engram doctor --json` for diagnostic output. Keep the actual output and environment with a bug report. The [reference](REFERENCE.md) groups commands; the [integration guide](INTEGRATION.md) explains interfaces.

## Disable or remove integrations

```bash
engram hook-disable -p /absolute/path/to/project
engram uninstall-hook --scope local -p /absolute/path/to/project
engram hooks uninstall /absolute/path/to/project
```

Use the same explicit scope used for installation; inspect other scopes if hooks were installed there too. `hook-enable` reverses the project kill switch. Stop watchers and servers separately. If you installed the npm package globally, `npm uninstall -g engramx` removes that package, but does not replace the preceding configuration cleanup.

Back up graph data before deleting any project state. Removing the CLI does not remove graph files, generated instructions, plugin configuration or stored HTTP tokens. Review these individually rather than recursively deleting a shared configuration directory.

## Source and verification

Pinned revision: `9fa2a4b74ca8e66560d74d1255c16c43157d32bd`. These commands and behaviors were source-inspected, not executed. Client compatibility, clean installation and measured outcomes remain unverified.

- [package.json](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/package.json)
- [src/cli.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/cli.ts)
- [src/hooks.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/hooks.ts)
- [src/miners/ast-miner.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/miners/ast-miner.ts)
- [src/intercept/installer.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/intercept/installer.ts)
