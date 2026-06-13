# ADR-0012: Cumulative session measurement via hook-log replay (Token-loop C)

**Status:** Accepted · **Date:** 2026-06-14 · **Author:** Nicholas

We measure engram's combined whole-session structural reduction by **replaying** the
recorded `.engram/hook-log.jsonl` through the same recall-recovery P-model the
deterministic bench uses (ADR-0002), rather than accumulating it live during a session.
Replay is deterministic, free (no LLM), and reuses existing machinery (the cost aggregator +
the session-level P-model), so it ships now via `engram measure --session [--replay <log>]`;
live in-session accumulation is **deferred** (it needs `session_id` plumbing verified in real
Claude Code, overlapping the SubagentStart work).

We added two **optional** fields to `HookLogEntry`: `sessionId` (honest session boundaries
instead of a 30-min time-gap guess) and `command` (Bash only, so the shell-grep arm is
**measured, not inferred**). Both are optional so pre-v4.4 logs still parse; segmentation
falls back to the time-gap heuristic and the report discloses which mode was used.

**Honesty constraints (the reason the feature exists):** the report is a per-session
**break-even-P curve**, never a single "X% saved" number; it is framed as a **structural**
context-token reduction, never a dollar/bill saving (net over prompt caching ≈ 0, measured);
the whole-session figure is explicitly disclosed as a **same-epoch ceiling** that does not
survive `/compact` (the served-set resets); and Bash events lacking the `command` field are
**excluded** from the number with a printed warning rather than back-filled with the 39:1
inference.

**Trade-off accepted:** replay can only re-account what the hook boundary already recorded —
it cannot model context the agent fetched outside engram's interceptors, and old logs exclude
the Bash arm. We surface both caveats rather than infer. If live measurement later becomes
necessary, the `sessionId` field already lays the groundwork. (Supersedes the stale
"C blocked by B" dependency in STATE/PLAN — B = #72 was deferred in ADR-0011, so C depends
only on A, which shipped.)
