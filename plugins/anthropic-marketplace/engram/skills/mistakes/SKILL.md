---
description: List past mistakes engram has learned in this project — failures, regressions, broken assumptions. Use before starting a non-trivial change to surface relevant prior failures, or when debugging to check if this issue has been seen before.
---

# engram mistakes

Surface bi-temporal mistake memory from engram's graph. Each mistake has a
`valid_until` timestamp and an `invalidated_by_commit` reference, so an old
mistake auto-expires when its underlying cause is fixed.

Run:

```
engram mistakes -p $CLAUDE_PROJECT_DIR
```

The output lists active (still-valid) mistakes with confidence scores. When
a mistake matches a query, engram surfaces it with ⚠️ at the top of the
context packet, weighted 2.5× to ensure it gets attention.

Use this skill:

- Before refactoring a module: "are there known sharp edges here?"
- During debugging: "has this kind of error been seen before?"
- When onboarding to a new area of the codebase: "what's broken or fragile?"

To record a new mistake explicitly:

```
engram learn "Don't pass options.scope=user; SETTINGS_LOCAL takes precedence." -p $CLAUDE_PROJECT_DIR
```

## Example invocations

**User:** "I'm about to refactor the rate limiter — anything I should know?"
**You:** Run `engram mistakes -p $CLAUDE_PROJECT_DIR`. Filter mentally for entries related to "rate", "limit", "mutex", or the file paths the user mentions. Surface the matches with their confidence scores: "engram has 3 active mistakes near this code, and one of them flagged this exact module:"

**User:** "Why does this test keep flaking?"
**You:** Run `engram mistakes -p $CLAUDE_PROJECT_DIR`. Look for entries about flakiness, timing, race conditions, or the test file's name. If a related mistake exists, quote it verbatim — chances are someone already debugged this.

**User:** "We just fixed a race condition in the queue worker. Remember it for next time."
**You:** Run `engram learn "Queue worker had a race condition: don't read state.queue inside the await; snapshot it first" -p $CLAUDE_PROJECT_DIR`. Confirm to the user that the mistake is recorded and will surface with ⚠️ on future Edits to that file.

**User:** "Has anyone fixed this kind of bug before?"
**You:** Run `engram mistakes -p $CLAUDE_PROJECT_DIR`. The graph carries 2.5x relevance boost on matching results, so if a similar fix exists, it surfaces near the top.

**User:** "Clear the mistake list — we've outgrown those warnings"
**You:** Don't. Mistakes are bi-temporal — they auto-expire when their underlying cause is fixed (`invalidated_by_commit` set automatically). Manual clearing should be the last resort. If a specific mistake is no longer relevant but hasn't auto-expired, the user can edit `.engram/graph.db` with sqlite3, but recommend living with one extra warning instead.

## When NOT to fire this skill

- The user is debugging a fresh problem with no engram-recorded history. The mistake list is for past failures, not unrelated current issues.
- The graph is uninitialized. Recommend `engram init .` first.
- The user wants to view *successful* patterns, not failures. Use `engram query` for those.
