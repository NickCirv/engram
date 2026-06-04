# ADR-0006: The honest before/after demo

**Status:** Accepted · **Date:** 2026-06-04 · **Author:** Nicholas

## Context

Research (PLAN §2, 2026-06-04) says the single highest-leverage adoption asset is a 30-second
before/after demo, and that the binding constraint on winning is distribution, not more interception.
But engram's whole credibility rests on the honest spine (PLAN §1): every number is a **structural
context-token reduction**, never a cost saving. A demo that flashes "−95%!" without context would be
the exact W1.9 sin — selling the **P=0 ceiling** (agent needs zero raw follow-up) as if it were the
realistic case. The competitors (CodeGraphContext, codegraph) already over-claim "~35% cheaper"; engram
cannot join that race.

The bench engine already does honest measurement: `bench/session-level.ts` replays real
`Grep(symbol) → Read(caller files)` traces through the **real shipped handlers** (`handleGrep`,
`handleRead`), tokens counted as `Math.ceil(text.length / 4)`. The demo must use that same real engine —
never staged numbers.

## Decision

Add `demo/run.mjs` — a standalone, deterministic, asciinema-recordable script that calls engram's
**real** `dist/` handlers on engram's own repo and renders a narrated before/after for three fixed,
disclosed scenarios:

1. a **big-win** symbol (many callers — the ranked packet replaces a grep-flood + reads),
2. a **typical** symbol (near the per-trace median), and
3. a **passthrough** case (small/few-caller — engram declines to intercept; raw passes through unchanged).

For each: *without engram* = real `rg` output tokens (the match-line flood — the **same grep-step model
as `bench/session-level.ts`**, with whole-file reads deliberately NOT billed to the baseline);
*with engram* = the real `handleGrep` packet tokens. The collapse is whatever the real handlers produce.
The per-search reduction is disclosed on-screen as a **ceiling** (assumes the ranked call-sites answer
the search; real recall-coverage ~22%) with `npm run bench` cited as the rigorous P-modelled aggregate.

It does **not** import the bench's private functions (no changes to audited bench code). It owns a
one-line `estimateTokens` mirror (documented as mirroring `session-level.ts`) and calls the already-
exported handlers. Numbers are byte-comparable to the bench because the engine and the heuristic are
the same.

The on-screen frame is **capacity, not cost**, and the asterisk is shown **prominently, not hidden**:
- "STRUCTURAL context tokens — not your bill. Prompt caching owns cost; engram's net over caching ≈ 0."
- "The packet is a *ranked subset*. If the agent needs the raw matches, engram always prints the exact
  `rg -n` to get them. engram wins **when the ranked packet answers the question** — which is what
  ranking is for." (recall-coverage cited.)
- The passthrough scenario, shown on purpose, proves the floor: **engram never makes it worse.**
- A pointer to `npm run bench` for the reproducible aggregate (the benches stay the source of truth;
  the demo is illustrative).

asciinema cast recorded locally (binary is installed) to `docs/demos/before-after.cast` and embedded.

## The trade-off

Leading with the real collapse (impressive) is in tension with not over-claiming. We resolve it by making
the honest caveat *part of the demo's punchline* rather than fine print — the asterisk the over-claiming
competitors omit becomes engram's differentiation. We pick three fixed scenarios (disclosed) spanning the
real range incl. a passthrough, so it can't be dismissed as cherry-picking; the aggregate lives in the
reproducible bench. The cost: the demo is illustrative, not a benchmark — anyone wanting the rigorous
number runs `npm run bench`. Accepted: the demo's job is to make the value visceral *honestly*, and the
bench's job is to prove it.

## Follow-up

The same engine generalizes to Track-M #81 (`engram bench` on the user's *own* repo). Build that as a CLI
subcommand reusing this measurement path once the demo's framing is validated.
