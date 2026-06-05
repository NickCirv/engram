# ADR-0010: Compaction session ledger — "previously explored" at PreCompact

**Status:** Accepted · **Date:** 2026-06-05 · **Author:** Nicholas · _Frontier move F2 (#84)_

## Context

`docs/FRONTIER.md` §5: after `/compact`, agents **thrash** — they re-read and re-explore files they
already saw, because compaction dropped the results. Harnesses reset per session; only a persistent local
layer can carry a record across the compaction boundary. The original hypothesis was "keep a session
ledger that *survives* compaction."

## The backtest that reshaped it (backtest-before-build)

Phase-0 **falsified the literal hypothesis**: engram's served-reads ledger
(`.engram/served-reads-<session>.json`, ADR-0003) is **wiped** on the post-compaction `SessionStart`
(`clearServedReads`) — empirically confirmed. So the ledger does *not* survive. But the backtest found the
achievable mechanism: the **PreCompact** hook fires *before* compaction *and before* that wipe, already
injects a survival brief via `additionalContext` (which survives into the compacted context), and at
PreCompact entry the ledger is still alive. The window is inside `handlePreCompact`, *before* its
`clearServedReads`.

## Decision

In `handlePreCompact`, **before** `clearServedReads`: capture the top-8 most-recently-read files via a new
`exploredFiles()` reader on the served-reads store. After the existing god-node survival brief, append a
**"Previously read this session (re-read if changed): file"** block — a **path-only** list. Opt-out
`ENGRAM_COMPACT_LEDGER=0`. The `clearServedReads` wipe still runs unchanged afterward (ADR-0003 correctness
— post-compaction reads must re-serve, since the content they'd point at is gone).

**Path-only, by adversarial review.** An earlier draft listed each file's top-3 graph symbols. The review
showed that misleads: the symbols come from the last mine, but the ledger only proves the file was *read*
(possibly a newer version) — so the block would assert as-of-last-index symbols as current fact, and the
arbitrary top-3 were noise, not the file's API. The honest signal is the *path*: if the agent re-reads,
its own Read interception returns the **current** structural summary. We also say "**read**", not
"explored" — grep/search is not tracked, so the list is reads only.

## Honesty (NOT a "never worse" gate)

Like the sub-agent broker (ADR-0008), this is a small **bet**, not a guarantee. The block costs a handful
of tokens; it pays off when it lets the post-compaction agent skip re-reading / re-deriving structure it
already saw — which is exactly the documented post-`/compact` thrashing. Net-positive on that behaviour,
tiny cost otherwise, opt-out. Honest scoping baked into the design:

- **Explicit `/compact` only.** Silent volume-overflow eviction does **not** fire PreCompact, so this
  covers explicit compaction, not window overflow. We don't claim the latter.
- **Files-read only.** No grep/symbol-search tracking exists in engram; "previously explored" is reads,
  not searches. (A grep ledger would be new recording infrastructure — deferred.)
- It's a *reminder*, not a guarantee the agent won't re-read — and if it does re-read, engram's Read
  interception already makes that cheap.

## The trade-off

A handful of tokens on a rare hook (PreCompact), bounded to the top-8 file paths — **no graph load**. We
reframed the design from "the ledger survives compaction" (false) to "a path list derived from the ledger
is injected at PreCompact, in the window before the wipe" — same user value (the agent re-reads only what
changed), honest mechanism.
