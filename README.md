![Engram — Nicholas Ashkar repository collection](assets/nicholas-ashkar/banner.png)

# Engram

A local structural code graph and context toolkit for AI coding agents. Engram indexes source entities, Git relationships and selected project memory, then exposes focused context through a CLI, agent hooks, MCP and an authenticated local dashboard.

Use it to find relevant code before reading full files, inspect relationships and carry recorded mistakes into a later session. Read the source returned by a query before making a behavioral claim: graph retrieval is an aid to investigation.






<a id="try-in-30-seconds-no-install"></a>

<a id="install-in-30-seconds"></a>

<a id="1-cli-recommended-starting-point--works-in-every-supported-ide"></a>

<a id="install"></a>

<a id="install--configuration"></a>

## Quickstart

The inspected package is `engramx` 4.5.0 and requires **Node >=20**. This source-build example is **source-inspected, not executed**; it does not assume a currently published package or extension version.

```bash
git clone https://github.com/NickCirv/engram.git
cd engram
git checkout 9fa2a4b74ca8e66560d74d1255c16c43157d32bd
npm install --ignore-scripts
npm run build
export ENGRAM_NO_UPDATE_CHECK=1
node dist/cli.js init ../your-project --no-hook
node dist/cli.js query "authentication" --project ../your-project --budget 2000
node dist/cli.js stats --project ../your-project
```

Replace `../your-project` with a codebase you can inspect. Indexing writes the project's `.engram/` graph. The `--no-hook` flag matters: the default CLI `init` also installs a Sentinel hook. Start with the graph, examine the output, then decide which integration to enable. The build includes grammar bundling; inspect package scripts and dependencies before installation.

The query returns matching graph entities and an estimated token count, or a no-matching-nodes message. Counts depend on the indexed project; no benchmark output is fabricated here.


















<a id="why-this-exists-may-2026"></a>

<a id="2-cursor--vs-code-extension-live-on-openvsx"></a>

<a id="3-continuedev-users"></a>

<a id="engramx--the-cached-context-spine-for-ai-coding-agents"></a>

<a id="one-command-to-everything"></a>

<a id="dashboard"></a>

<a id="design"></a>

<a id="benchmark"></a>

<a id="real-world-bench-new-in-v30-preferred"></a>

<a id="plugins-extend-what-engram-understands"></a>

<a id="ide-integrations"></a>

<a id="how-it-compares"></a>

<a id="cli-reference"></a>

<a id="http-api"></a>

<a id="mcp-server"></a>

<a id="ecp-spec"></a>

<a id="programmatic-api"></a>

## What is implemented

| Workflow | Source-backed entry points |
| --- | --- |
| Explore structure | `query`, `path`, `gods`, `callers`, `callees`, `impact`, `stats` |
| Maintain context | `init`, `watch`, `reindex`, `learn`, `mistakes` |
| Generate agent documents | `gen`, `gen-mdc`, `gen-aider`, `gen-windsurfrules`, `gen-ccs` |
| Inspect hook integration | `install-hook --dry-run`, `hook-preview`, `hook-stats`, `hook-disable`, `hook-enable` |
| Serve context | `server`, `ui`, `engram-serve` MCP executable |
| Review measurements | `measure`, `bench`, `cost`, package benchmark scripts |
| Maintain installation | `doctor`, `setup --dry-run`, `update --check`, database/cache/plugin commands |

These entry points are declared in the [pinned CLI](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/cli.ts). Consult each command's help before a write operation. Generators, hook installers, cache/database commands and plugin installation can modify local state.

## Architecture

Source miners extract entities, references, Git co-change and selected mistake/session information. The graph store persists project-local SQLite using `sql.js`. Queries traverse the graph and render bounded context. The provider resolver combines built-in sources and optional plugins/MCP providers; integrations can add external processes and network access.

The [architecture and integration guide](docs/PORTFOLIO-GUIDE.md) maps these paths, documents HTTP authentication and gives a local MCP configuration. Existing design records, release notes, integration documents and the ECP draft remain linked in the [documentation inventory](docs/RESEARCH.md). They retain historical context and are not all certified against this revision.





<a id="im-not-a-developer--what-does-this-actually-do"></a>

<a id="proof-not-promises"></a>

<a id="what-engramx-is-not"></a>

<a id="privacy"></a>

## Privacy and operational boundaries

The core graph is local, but **the entire system is not guaranteed to be network-free**. The CLI has npm update checks, Context7 can call an external wrapper, and configured MCP/plugin providers can execute their own processes. `ENGRAM_NO_UPDATE_CHECK=1` disables the update-check path; it does not disable every optional integration. Review configured providers and the agent that receives graph output.

The HTTP server binds to `127.0.0.1`, validates Host/Origin and requires a bearer token or dashboard cookie for protected routes. It resolves a token from `ENGRAM_API_TOKEN` or a local token file. Keep that token private and retain the existing [security policy](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/SECURITY.md).

## Limits and measurement

Structural context size, estimated token reductions, session replay and actual provider billing answer different questions. A smaller packet does not by itself demonstrate equal answer quality or a lower bill. Reproduce the included benchmarks on your own representative workload and track correctness alongside cost. This documentation review did not run a build, test suite, benchmark or agent session.



<a id="structured-task-bench-ci-regression"></a>

<a id="contributing"></a>

## Development

```bash
npm run build
npm run lint
npm test -- --run
```

The repository contains unit and integration test sources for graph storage, providers, hooks, HTTP security and other modules. Their presence is evidence of test coverage intent; results at this revision remain unverified here. See the preserved [contribution guide](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/CONTRIBUTING.md) before changing behavior.


<a id="license"></a>

## License and author

[Apache-2.0 license](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/LICENSE). The ECP specification carries its own attribution and licensing in its source document; this rewrite does not alter either.

[Nicholas Ashkar](https://nicholashkar.com) · Applied AI, systems and consulting.

## User guides

[User manual](docs/USER-MANUAL.md) covers setup, skills, troubleshooting and removal. [Sentinel](docs/SENTINEL.md) explains current hook behavior and guard modes. Tool authors can use the [integration guide](docs/INTEGRATION.md).
