# Engram editor commands

This extension is a thin terminal wrapper around the Engram CLI. Its manifest declares VS Code `^1.85.0`; runtime compatibility and marketplace distribution were not tested.

| Command | Terminal invocation |
| --- | --- |
| Initialize | `engram init "WORKSPACE"` |
| Generate Cursor rules | `engram gen-mdc -p "WORKSPACE"` |
| Generate agent context | `engram gen -p "WORKSPACE"` |
| Cost report | `engram cost -p "WORKSPACE"` |
| Doctor | `engram doctor` |
| Dashboard | `engram dashboard "WORKSPACE"` — incompatible with the inspected CLI, which declares `ui` |

The first workspace folder is used. Initialization does not pass `--no-hook`, so it inherits the CLI's default hook installation. The extension sends command text to a terminal; treat `engram.cliPath` and workspace names as trusted shell input.

## Settings and development

`engram.cliPath` defaults to `engram`. `engram.regenerateOnSave` defaults to `false`; enabling it sends `gen-mdc` on document saves. Settings are read during activation, so reload after changing them if needed.

The extension's `compile` script runs `tsc -p ./` and its entrypoint is `out/extension.js`. Build and test it in an extension development host before installing. The dashboard mismatch requires a code fix; use the main CLI's `engram ui -p /absolute/path/to/project` directly in the meantime.

## Evidence and verification

This guide describes the pinned source below. Commands and client integrations were inspected, not executed; external client compatibility remains unverified.

- [extensions/vscode/package.json](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/extensions/vscode/package.json)
- [extensions/vscode/src/extension.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/extensions/vscode/src/extension.ts)
- [src/cli.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/cli.ts)
