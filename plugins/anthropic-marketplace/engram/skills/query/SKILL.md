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

## Example invocations

**User:** "How does authentication work in this project?"
**You:** Run `engram query "how does authentication work" -p $CLAUDE_PROJECT_DIR`. Read the structured response. Cite the relevant nodes (function names, file paths). If the answer mentions specific files, those are good candidates for a follow-up Read — but only if the structural view leaves a question.

**User:** "What calls `validateToken`?"
**You:** Run `engram query "what calls validateToken" -p $CLAUDE_PROJECT_DIR`. The graph returns the inbound call sites without you ever Reading those files.

**User:** "Where is the rate limiter implemented?"
**You:** Run `engram query "rate limiter implementation" -p $CLAUDE_PROJECT_DIR`. If the answer points at one file, you can Read that file confidently. If it points at three files, ask the user which path matters.

**User:** "Trace from `userController.create` to the database write"
**You:** This is a path query, not a free-text query. Use `engram path userController.create database.write -p $CLAUDE_PROJECT_DIR`. Returns the shortest call chain.

**User:** "Show me the most-connected files in this codebase"
**You:** Use `engram gods -p $CLAUDE_PROJECT_DIR --top 10`. Returns the entities with the most graph degree. Useful for "where do I start reading."

## When NOT to fire this skill

- The user explicitly asks to read a specific file. They want the file content, not a summary. Use the Read tool.
- The user is debugging a runtime error and needs the exact stack trace. The graph is structural; runtime data lives in logs.
- The graph is empty (`engram stats` shows 0 nodes) — the project hasn't been indexed yet. Recommend `engram init .` first.
