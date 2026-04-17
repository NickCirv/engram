# Aider Integration

engram generates a `.aider-context.md` snapshot from your knowledge graph.
Aider reads it as static context at session start — no plugins or special config required.

## Setup

**1. Generate context file**

```bash
engram gen-aider -p .
```

This writes `.aider-context.md` to your project root with five sections:
Architecture (god nodes), Hot Files, Known Issues, Decisions, and Key Patterns.

**2. Add to `.aider.conf.yml`**

```yaml
read:
  - .aider-context.md
```

Aider loads this file before every chat session. Commit `.aider.conf.yml` to the repo.

**3. Keep it fresh**

```bash
# One-shot refresh after re-indexing
engram gen-aider -p .

# Auto-refresh on graph changes (watch mode)
engram gen-aider --watch -p .
```

Watch mode stays alive and regenerates whenever engram detects graph changes.

## Typical workflow

```bash
# Index your project (first time or after large changes)
engram init .
engram index .

# Generate context
engram gen-aider -p .

# Start Aider — it picks up .aider-context.md automatically
aider
```

## What gets included

| Section | Source | Limit |
|---------|--------|-------|
| Architecture | God nodes (highest connectivity) | Top 10 |
| Hot Files | Pattern nodes with `type: hot_file` | Top 10 |
| Known Issues | Mistake nodes, ranked by query frequency | Top 5 |
| Decisions | Decision nodes from last 30 days | All |
| Key Patterns | Pattern nodes with confidence >= 0.8 | All |

## HTTP bridge (future)

Once engram ships its HTTP server, you can fetch context dynamically in
pre-session scripts:

```bash
curl "localhost:7337/query?q=auth+flow" >> .aider-context.md
```

This will let you prime Aider with task-specific context before starting a session.

## Positioning

Aider builds per-file repo maps from AST analysis. engram adds the
persistent layer: architectural decisions, known failure modes, and
recurring patterns that survive across sessions. They complement each other.
