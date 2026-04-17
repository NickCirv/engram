# engramx-continue

Continue.dev context provider for [engram](https://github.com/NickCirv/engram) — surfaces the knowledge graph as `@engram` in chat.

## Prerequisites

engram must be initialized in your project:

```bash
npm install -g engramx
engram init /path/to/project
```

## Install

```bash
npm install engramx-continue
```

## Configure

Add to `~/.continue/config.json`:

```json
{
  "contextProviders": [
    { "name": "engramx-continue" }
  ]
}
```

## Use

Type `@engram` in Continue chat. The provider queries the local knowledge graph and injects architecture, decisions, patterns, and known issues as context.

Falls back to HTTP (`127.0.0.1:7337`) if the CLI is unavailable. Returns empty if both fail — no errors surface to the user.
