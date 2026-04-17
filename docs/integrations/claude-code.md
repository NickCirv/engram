# Claude Code Integration

engram integrates with Claude Code via PreToolUse/PostToolUse hooks that
intercept Read/Edit/Write calls and inject structural context automatically.

## Prerequisites

```bash
# Index your project
engram init .

# Install hooks into Claude Code settings
engram install-hook
```

`install-hook` writes to `.claude/settings.json` (project scope) or
`~/.claude/settings.json` (user scope, pass `--scope user`).

## What happens at runtime

Every `Read` call is intercepted. Instead of passing the full file to Claude,
engram returns a structural summary: node list, key relationships, and
confidence scores. Full file content is still available on demand — just
re-read with explicit `offset`/`limit` params.

The hook exits with `deny + reason` to inject context inline, which means
zero latency overhead for Claude Code (synchronous hook path).

## HUD

The status line shows live hit rate and estimated token savings:

```
engram ◆ 47 hits · ~12K tokens saved
```

Configure the label in `.engram/providers.json`.

## Dashboard

```bash
engram dashboard
```

Opens a live terminal view showing recent intercepts, node coverage, and
per-file hit rates.

## Provider configuration

`.engram/providers.json` controls which context providers are active and
their budget limits:

```json
{
  "structure": { "enabled": true, "budget": 800 },
  "mistakes":  { "enabled": true, "budget": 200 },
  "decisions": { "enabled": true, "budget": 200 }
}
```

Run `engram stats -p .` for a summary of current graph state.
