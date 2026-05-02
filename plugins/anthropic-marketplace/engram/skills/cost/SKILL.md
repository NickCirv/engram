---
description: Show how many tokens engram has saved in this session, this week, and across all indexed projects. Use when the user asks about token usage, savings, costs, or wants a digest report.
---

# engram cost

Show token-savings telemetry from engram's hook log. Three modes:

1. **Default** — terminal table for the current project: `engram cost`
2. **Multi-project** — across many roots: `engram cost -p /path/a -p /path/b`
3. **Weekly digest** — Markdown file at `~/.engram/cost-report-YYYY-Www.md`: `engram cost --digest`

Run the requested mode and report the totals:

- Tokens saved (numeric, with K/M suffix)
- Reduction ratio (percentage)
- Approximate USD saved (Claude Sonnet 4.6 input pricing by default)
- Total events (number of intercepted tool calls)

If the user passed "$ARGUMENTS", treat it as flag input (e.g., `--digest`, `-p /path`).

If the table shows zeroes, explain that historic events don't carry the new tokens-saved fields — real numbers populate within ~24 hours of v3.3 install.
