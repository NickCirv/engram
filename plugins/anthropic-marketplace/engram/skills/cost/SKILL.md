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

## Example invocations

**User:** "How much has engram saved me this week?"
**You:** Run `engram cost --digest`. Read the output. Quote the totals: tokens saved, reduction ratio, approx USD. Mention the digest file path so the user can paste it into Slack.

**User:** "Show me my engram numbers across all projects"
**You:** Multi-project mode. Run `engram cost -p ~/proj-a -p ~/proj-b -p ~/proj-c` (substitute with the user's actual paths if they list them, otherwise default to the current directory).

**User:** "Is engram even doing anything?"
**You:** Run `engram cost --json` and pipe to a sanity check. If `events > 0` but `tokensSaved == 0`, the user is on engramx older than 3.3.0 — recommend `npm i -g engramx@latest`. If `events == 0`, the hook isn't installed — recommend `engram install-hook`.

**User:** "Compare cost vs last week"
**You:** Two digest files at `~/.engram/cost-report-YYYY-W{N}.md` and `~/.engram/cost-report-YYYY-W{N-1}.md`. Read both, present the deltas in a table.

## When NOT to fire this skill

- The user is asking about npm package costs, hosting bills, or general cloud spend. This skill is engram-specific only.
- The user wants to set up cost tracking for the first time. Point them at `engram setup` and `engram install-hook` first; cost data accumulates after the hook is wired.
