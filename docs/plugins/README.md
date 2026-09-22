# Context providers and plugins

Providers add context alongside the local graph. Review each provider as code or an external service before enabling it: a provider can read files, execute a command, or send requests.

## JavaScript plugins

The example module exports a provider object with `name`, `label`, version/description metadata, `tier`, `tokenBudget`, `timeoutMs`, `isAvailable`, and `resolve`. A resolution supplies provider identity, content, confidence, and cache state. Start from the [static example](examples/static-context-plugin.mjs), then test missing inputs and timeouts.

Use `engram plugin list` to inspect registration. `plugin install` and `plugin remove` alter the plugin set; listing a plugin does not establish its trustworthiness. Dynamic module loading executes plugin code.

## MCP providers

The default configuration location is `~/.engram/mcp-providers.json`; `ENGRAM_MCP_CONFIG_PATH` overrides it. The top-level object contains `providers`, an array of named configurations. Both `stdio` and `http` transports are implemented in this revision.

| Field | Meaning |
| --- | --- |
| `name`, `label`, `transport`, `tools` | Provider identity, display name, transport and tool definitions |
| `command`, `args`, `env`, `cwd` | Stdio process configuration |
| `url`, `headers`, `envHeader` | HTTP endpoint, headers and bearer credential environment variable |
| `tokenBudget` | Context allocation; default 200 |
| `timeoutMs` | Request timeout; default 2000 |
| `cacheTtlSec` | Cache lifetime in seconds; default 3600 |
| `enabled` | Whether to load the provider; defaults true |

Tool argument templates support `{filePath}`, `{projectRoot}`, `{imports}`, and `{fileBasename}`. Review expansions before sending them to a remote server. Non-string arguments pass through unchanged. Keep credentials out of committed JSON and use the environment-backed option where appropriate.

## Operating limits

Timeouts and token budgets constrain retrieval; they are not process isolation or a data-access sandbox. Inspect `cache stats`, `cache clear`, and `cache warm` before using them in automation. External service availability and schema compatibility require separate runtime checks.

## Evidence and verification

This guide describes the pinned source below. Commands and client integrations were inspected, not executed; external client compatibility remains unverified.

- [src/providers/mcp-config.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/providers/mcp-config.ts)
- [docs/plugins/examples/static-context-plugin.mjs](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/docs/plugins/examples/static-context-plugin.mjs)
- [src/cli.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/src/cli.ts)
