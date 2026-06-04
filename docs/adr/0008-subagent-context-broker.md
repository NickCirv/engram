# ADR-0008: Sub-agent context broker (the SubagentStart slice)

**Status:** Accepted · **Date:** 2026-06-04 · **Author:** Nicholas · _Frontier move F1 (#83)_

## Context

`docs/FRONTIER.md` identified the one regime where a local context layer nets a **real** dollar saving in
a caching-dominated world: **multi-agent fan-out**. Each spawned sub-agent opens a fresh context window
and pays a fresh prompt-cache **write** — caching never shares the parent's context with the child, and
Anthropic's own multi-agent report puts fan-out at ~15× a chat's tokens. A tight structural slice injected
into each sub-agent, so it orients without the grep→read discovery fan-out, saves at write price —
multiplied by N sub-agents **when the slice displaces more exploration than it costs** (the per-workload
net that #85 measures, never asserted).

Phase-0 (2026-06-04) confirmed feasibility: Claude Code's Agent SDK fires a **`SubagentStart`** hook inside
the sub-agent's context (`agent_id`/`agent_type` populated), and engram is already a shell-command hook
that speaks the `hookSpecificOutput.additionalContext` wire format. engram did **not** register
`SubagentStart` — so this is genuinely additive, not a free SessionStart side-effect (SessionStart does
*not* fire per sub-agent).

## Decision

Register `SubagentStart` and add `handleSubagentStart` — a deliberately **downsized** SessionStart: top-5
god nodes + graph shape only, **no** landmines, mempalace bundle, or provider warmup (sub-agents are
short-lived; the write cost is what we minimise). It reuses `godNodes`/`stats` and emits via
`buildSessionContextResponse("SubagentStart", …)`. Gated exactly like SessionStart (valid cwd, project
root, kill switch, empty-graph → passthrough) plus an `ENGRAM_SUBAGENT_CONTEXT=0` opt-out. On engram's own
repo the slice is **~97 tokens**.

## Honesty (this is NOT a "never worse" gate)

Unlike the grep gate (ADR-0007), engram can't know in advance whether a given sub-agent will explore. The
slice is a small **bet**: ~97 tokens that pay for themselves the moment the sub-agent would otherwise read
even one file to orient (~500–5000 tokens), and cost ~97 tokens of pure overhead on a focused sub-agent
that wouldn't have explored. The expected value is strongly positive on exploration-heavy fan-out (the
common multi-agent case), the downside is deliberately tiny, and it's opt-out. We do **not** claim a
guaranteed per-sub-agent saving — the *net* across real workloads is exactly what the recall→resolve
benchmark (#85) is built to measure. Framing stays structural (capacity + skipped exploration), never a
bare cost claim.

## The trade-off

A tiny unconditional injection beats trying to predict per-sub-agent need in v1. A **v2** could gate on
`agent_type` (inject only for explore/general agents) or task-target the slice (callers/impact of the
spawn prompt — available via the parent's `PreToolUse` on the `Agent`/`Task` tool, a cross-event
correlation). Those are deferred; v1 is the smallest honest thing that captures the fan-out win.

## Delivery caveat (the smoke gate)

engram's side is verified via simulated `SubagentStart` events (valid JSON, correct `hookEventName`, ~97-
token slice, opt-out + empty-graph passthrough). That a **shell hook's** `additionalContext` is actually
injected for `SubagentStart` in a live Claude Code sub-agent run is documented for SessionStart/PostToolUse
but must be **smoke-tested in a real sub-agent spawn** before claiming end-to-end delivery. Until then,
this ships as "engram emits the slice correctly; harness delivery pending real-session confirmation."
