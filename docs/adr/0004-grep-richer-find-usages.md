# ADR-0004: Richer find-usages in the Grep packet (call-site lines)

**Status:** Accepted · **Date:** 2026-06-03 · **Author:** Nicholas

## Context

ADR-0001 made the Grep handler answer a symbol search from the `calls` graph with a list of caller
**files**. The session-level bench (ADR-0002) and its adversarial audit then showed the load-bearing
weakness: that packet is a strict *subset* of what the agent grepped for — it contains the symbol's
call sites **zero times**, only file names. So the agent often re-runs the raw grep to see the actual
usage, which is exactly the high "recall-recovery fraction" (P) that caps the real session saving
between the optimistic ceiling and break-even. To move the real saving toward the ceiling we must raise
**recall-sufficiency**: make the packet actually answer "where/how is this symbol used."

## Decision

The Grep handler now scans the resolved caller files (at query time, no graph/miner change) for the
lines that reference the symbol (word-boundary via lookarounds, so `$`-identifiers anchor) and returns
the actual **call-site lines** (`file:line: code`) in the packet, deduplicated and capped, plus the
existing `rg -n` escalation.

**Two gates make this a genuine token win, never a regression** (added after an adversarial audit showed
the naive version cost *more* on most greps):

1. **`output_mode === "content"` only.** Claude Code's Grep defaults to `files_with_matches` (filenames)
   and also offers `count` — both far cheaper than any packet. engram's call-site packet can only beat a
   *content* grep (matching lines), so for the filenames/count modes it passes through.
2. **`callerFiles.length >= 4`.** Below that, even a content grep is small enough that engram's packet +
   its ~50-token boilerplate would cost more than the grep it replaces. The win scales with usage; this
   floors out the regressing tail.

Bounds keep the packet smaller than the content grep it replaces: at most 15 caller files scanned, 25
lines returned, each trimmed to 140 chars, files > 1 MB skipped. If the scan finds **zero** lines (a
`calls` edge from dynamic dispatch the literal symbol word doesn't appear for), it passes through.

## The trade-off (honest)

The packet is larger than a bare file list — but it is the right kind of larger: it contains the real
usage context the agent grepped for, drawn **only from the files the graph says actually reference the
symbol** (no comment/string/test-file/partial-match noise), capped. The naive version (no gates) was a
token *regression* on most greps — bigger than a default filenames grep always, and bigger than a
content grep for low-usage symbols (the ~50-token boilerplate dominates). The two gates fix that: scoped
to `content` mode and `>= 4` caller files, every interception that fires is smaller than the content
grep it replaces (measured on engram's own repo: `init` 573 vs 9,317 tok, `parse` 578 vs 2,152,
`getStore` 531 vs 1,781), while raising recall-sufficiency from ~0 (file names) to the real call sites.
This is a *structural* context-token effect, not a bill saving. The discarded alternative — returning every match
line — is just the grep dump (no saving); the discarded alternative of reading the call-site line from
`GraphEdge.sourceLocation` was rejected to avoid touching the hardened reference-graph code (the
line *text* requires reading the file anyway, so the scan is simpler and self-contained).

We cannot deterministically measure the drop in P (it is behavioural). We can and do measure the two
proxies: (a) the packet still smaller than the raw grep, and (b) the packet now *contains* the call-site
lines a grep would show (recall-coverage), vs ~0 before.
