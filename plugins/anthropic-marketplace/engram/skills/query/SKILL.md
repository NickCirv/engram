---
description: Query engram's local knowledge graph for structural context — function calls, imports, type relationships, mistake history, ADRs. Use when the user asks "how does X work in this project", "what calls Y", "where is Z used", or any structural question that doesn't need file content.
---

# engram query

Query engram's knowledge graph instead of reading files directly. Saves tokens
when a structural answer suffices.

The argument is a natural-language question. Run:

```
engram query "$ARGUMENTS" -p $CLAUDE_PROJECT_DIR
```

The graph returns a token-budgeted answer with:

- Relevant nodes (functions, files, concepts)
- Edges (calls, imports, decided-for relationships)
- Mistake hits if any (these surface with ⚠️ at the top — read carefully, they
  represent past failure modes)

If the answer doesn't fully address the question, fall back to reading specific
files mentioned in the result.

For a connection between two specific concepts use `engram path <source> <target>`.
For most-connected entities use `engram gods`.
