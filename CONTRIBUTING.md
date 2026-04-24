# Contributing to EngramX

Thanks for wanting to help. EngramX is Apache-2.0, welcomes every kind of contribution, and aims to stay meticulously honest about what works and what doesn't. This doc is short because the rules are few.

## Quick Start

```bash
git clone https://github.com/NickCirv/engram.git
cd engram
npm install
npm run build
npm test
```

You need Node 20+. No native toolchain — EngramX's SQLite is sql.js WASM, all tree-sitter grammars are bundled as WASM. Zero system libraries required.

## Highest-impact contributions

In rough order of "what helps the most":

1. **Worked examples** — run `engram setup` on a real codebase, record what the graph got right and wrong, open an issue. Honest feedback from actual use is more valuable than any patch.
2. **Reproducible bench results** — run `npx tsx bench/real-world.ts --project . --files 50` on your project and share the numbers (especially if you see <50% savings — we want to understand why).
3. **Plugin submissions** — a 10-line MCP plugin file for a service we don't have yet. Drop in `docs/plugins/examples/` + mention the coverage in a PR.
4. **Language extraction bugs** — if `engram init` misses a function/class/import in a supported language, open an issue with the source file and what was missed.
5. **Windows-specific fixes** — EngramX CI covers Ubuntu × Node 20/22 AND Windows × Node 20/22. Windows-path bugs are real. We welcome patches that harden cross-platform behaviour.
6. **New language support** — tree-sitter grammar wiring in `src/miners/ast-miner.ts`, plus a test fixture.

## Development loop

```bash
npm run dev        # watch mode — rebuilds on every save
npx vitest         # tests in watch mode
npx vitest run     # tests once
npm run build      # production build (bundled WASM grammars)
npm run lint       # TypeScript strict check (tsc --noEmit)
npx tsx bench/real-world.ts   # sanity-check your changes against the savings bench
```

## Before you open a PR

1. `npm run build` passes (TypeScript strict).
2. `npx vitest run` passes all suites (currently 878 on v3.0).
3. If you changed extraction logic, add a fixture + test case.
4. **If you touched anything that builds a filesystem path, assert with `path.join()` / `path.resolve()`, never hand-write `/` separators.** We shipped a Windows-CI regression on v3.0's first pass because of this. Tests that build an expected path via `path.join()` (matching the implementation) work on every platform — regex assertions with `\/` do not.
5. Keep PRs focused — one change per PR.

## Code style

- TypeScript strict mode.
- ESM imports (`import`, not `require`). Vitest's CommonJS interop hides bare-`require()` bugs that crash in production — always use top-level ESM imports.
- Immutable patterns (spread, not mutation).
- Functions under ~50 lines.
- No `console.log` in library code — only in CLI entry points (`src/cli.ts`) and the bench runner.
- Every new test that exercises filesystem paths should explicitly include a Windows-native-path case so regressions surface locally, not only on CI.

## Plugin authors

Writing a context provider is ~10 lines. See [`docs/plugins/README.md`](docs/plugins/README.md) for the full spec. Two shapes are supported:

- **MCP-backed** — declare an `mcpConfig` and the loader spawns/connects to the MCP server for you. Any MCP server becomes an EngramX provider in one `.mjs` file.
- **Classic** — write your own `resolve()` + `isAvailable()` for full control.

Reference examples:
- [`docs/plugins/examples/serena-plugin.mjs`](docs/plugins/examples/serena-plugin.mjs) — MCP-backed (Serena / LSP symbols)
- [`docs/plugins/examples/static-context-plugin.mjs`](docs/plugins/examples/static-context-plugin.mjs) — classic (always-on project reminder)

Submitting a plugin into the repo:
1. Drop your `.mjs` into `docs/plugins/examples/`.
2. Add a row to the "Plugins multiply the savings" table in `README.md`.
3. Include a short doc-comment header explaining what gap your plugin closes + install notes.

## Security

- Never commit credentials. The token at `~/.engram/http-server.token` is auto-generated, `.gitignore`d, and never leaves your machine.
- Found a vulnerability? See [`SECURITY.md`](SECURITY.md) — coordinated disclosure via GitHub advisories, we respond within 48 hours.

## Community

- **Issues** for bugs, feature requests, and plugin submissions.
- **GitHub Discussions** for "what benchmark are you seeing on your code" and "has anyone built a plugin for X yet."
- **Security advisories** for anything that could compromise a user's local SQLite.

## License

Apache 2.0. By contributing you agree that your contributions are licensed under the same. See [`LICENSE`](LICENSE) for the full text.
