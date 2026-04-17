# CCS Integration

engram integrates with the [Codebase Context Specification](https://github.com/Agentic-Insights/codebase-context-spec) — a standard for human + AI-readable project documentation stored in `.context/index.md`.

## What CCS Is

CCS defines a standard location (`.context/index.md`) for project documentation. Sections typically include Architecture, Decisions, Conventions, and Known Issues. Any AI tool can read this file to understand a project without digging through source code.

## Import: Load CCS into engram

If your project already has a `.context/index.md`, import it into the knowledge graph:

```bash
engram init --from-ccs
```

This parses each section and maps bullet points to graph nodes:

| Section heading | Node kind |
|-----------------|-----------|
| Architecture, Design, Conventions, Patterns | `pattern` |
| Decisions | `decision` |
| Issues, Problems, Known Issues | `mistake` |
| Everything else | `concept` |

All imported nodes get `confidenceScore: 0.9` — human-authored context is treated as high-signal.

## Export: Generate CCS from engram

Export the knowledge graph as a CCS-format `.context/index.md`:

```bash
engram gen-ccs
```

This writes four sections:

- **Architecture Patterns** — pattern nodes with confidence >= 0.8, sorted by query frequency
- **Decisions** — all decision nodes, newest first
- **Known Issues** — mistake nodes sorted by how often they surface in queries
- **Key Concepts** — high-traffic concept nodes (queryCount > 0)

## Positioning

engram is the **dynamic layer** for CCS. Static `.context/index.md` files capture what you know at a point in time. engram makes that knowledge live — it grows as you code, surfaces the right nodes during AI queries, and tracks which decisions and patterns actually matter (via queryCount).

Static docs become a living knowledge graph.
