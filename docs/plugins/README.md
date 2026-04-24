# engramx Plugins

> A plugin is a single `.mjs` file in `~/.engram/plugins/` that adds a new
> Context Spine provider to engramx. Two shapes are supported:

1. **MCP-backed** — declare an `mcpConfig` and the loader auto-wraps an
   MCP server of your choice. ~10 lines.
2. **Classic** — write your own `resolve()` and `isAvailable()`. Full
   control over what goes into the context packet.

Both shapes live side-by-side in the same directory. Pick whichever fits.

---

## Install

1. Copy an example from `docs/plugins/examples/` to `~/.engram/plugins/`:

   ```bash
   cp docs/plugins/examples/serena-plugin.mjs ~/.engram/plugins/serena.mjs
   ```

2. Verify it loaded:

   ```bash
   engram plugin list
   ```

   You should see your plugin listed with its name + label.

3. Trigger any file read in Claude Code. The plugin's contribution will
   appear in the rich context packet header (e.g. `SEMANTIC SYMBOLS
   (mcp:serena):`).

---

## Shape 1 — MCP-backed plugin

See `examples/serena-plugin.mjs` for the full example. The essence:

```javascript
export default {
  name: "mcp:my-server",
  label: "MY CONTEXT",
  version: "0.1.0",
  mcpConfig: {
    transport: "stdio",
    command: "my-mcp-server",
    args: [],
    tools: [
      { name: "get_context", args: { file: "{filePath}" } },
    ],
  },
};
```

**Template tokens available in `tools[].args`:**

| Token | Value |
|-------|-------|
| `{filePath}` | Relative POSIX path (e.g. `src/auth/login.ts`) |
| `{projectRoot}` | Absolute project root path |
| `{imports}` | Comma-separated import names (`"jsonwebtoken,express"`) |
| `{fileBasename}` | Basename only (e.g. `login.ts`) |

Unknown tokens pass through verbatim. Non-string values (`true`, `10`, …)
pass through unchanged.

**Transports:** `stdio` ships in v3.0. `http` is declared but deferred
until the SSE-streaming + Host/Origin hardening work lands (v3.0 item #5).

---

## Shape 2 — Classic plugin

See `examples/static-context-plugin.mjs`. Key fields:

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Unique identifier (no collision with built-ins) |
| `label` | string | Section header in the context packet |
| `version` | string | Semver |
| `tier` | `1 \| 2` | 1 = internal (fast), 2 = external (cached). See `src/providers/types.ts`. |
| `tokenBudget` | number | Max tokens this plugin may emit per Read |
| `timeoutMs` | number | Per-resolve() timeout |
| `resolve(filePath, context)` | async | Return a `ProviderResult` or `null` |
| `isAvailable()` | async | Return `false` to silently skip this plugin |

`resolve()` must return `null` on any error path — it must NOT throw. A
thrown error is swallowed by the resolver's Promise.allSettled, so your
plugin just goes silently missing rather than breaking the session.

---

## Safety guarantees

A broken plugin CANNOT break engramx. The plugin loader:

1. Imports your file in a try/catch.
2. Validates the shape (missing fields → skip with stderr warning).
3. For `mcpConfig`, validates the MCP schema before auto-wrapping.
4. Deduplicates names — first-loaded wins.
5. Surfaces the list of loads + failures via `engram plugin list`.

A plugin that throws at import, fails shape validation, or has an invalid
`mcpConfig` simply doesn't appear in the provider list. Other plugins and
built-ins are unaffected.

---

## Debugging a plugin that "won't load"

1. `engram plugin list` — shows loaded + failed with one-line reason.
2. For MCP-backed plugins, try the underlying command manually:
   ```bash
   uvx --from git+https://github.com/oraios/serena serena start-mcp-server
   ```
   If it fails here, engramx can't make it work either. Fix the upstream
   first, then re-test.
3. Check `~/.engram/` exists and is writable (the loader creates
   `plugins/` on demand).
4. Enable verbose logs: `ENGRAM_LOG=debug engram query "hello"` shows
   the full load trace.

---

## Publishing a plugin for others

Plugins are currently installed by copy-paste — there's no plugin
registry yet. The recommended path:

1. Ship your plugin file in a public git repo with clear install notes
   (one README + one `.mjs`).
2. Use a `mcp:your-tool-name` or `your-org:name` namespace to avoid
   collisions.
3. Include a version bump policy in your README so users know when to
   update.

A first-party plugin registry is tracked as post-v3.0 work (dependent on
Official MCP Registry verified-tier requirements solidifying).
