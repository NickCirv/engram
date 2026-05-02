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
