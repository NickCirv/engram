# ADR-0007: A measured "never worse" gate for grep interception

**Status:** Accepted · **Date:** 2026-06-04 · **Author:** Nicholas

## Context

The README, the demo, and `docs/COMPARISON.md` all promise engram is **never worse** — a symbol it
declines passes through unchanged. The Read handler keeps that promise structurally (it passes through
when its packet is larger than the file). The **Grep** handler did **not**: it gated only on
`MIN_CALLER_FILES ≥ 4`, a *proxy* for "the raw grep is big enough to be worth replacing." `engram measure`
on a small repo (2026-06-04) exposed the gap — a symbol with ≥4 caller files but few short call sites
(e.g. `hashTok`, called once across 6 files) produces a packet whose boilerplate (header + the
recall-safe `rg -n` escalation footer) exceeds the raw grep. engram intercepted and **increased** context
— a direct promise violation (tracked as #82).

## Decision

Before denying the grep, measure the real raw grep and pass through if engram's packet isn't actually
smaller. The measurement is a **conservative floor**, `rg -wF` (word-boundary, fixed-string), **scoped to
the agent's own grep** — its `cwd`, plus any `path`/`glob` from the tool call. This scoping is
load-bearing: an agent grepping a *subdirectory* gets a small result that engram's repo-wide packet could
exceed; sizing the floor repo-wide would compare the packet against the wrong (much larger) number and
wrongly intercept. `-wF` returns the **fewest** matches the agent could get in that scope (its default
substring grep returns at least as many), so if the packet beats this floor, it beats the agent's actual
grep too. Compare token estimates (`ceil(len/4)`); `estimateTokens(packet) >= rawFloor` → PASSTHROUGH.

`rawGrepFloorTokens` never throws: `rg` exit 1 (no matches in scope) → `0`; buffer-overflow / timeout (a
huge raw) → `MAX_SAFE_INTEGER`, so the caller intercepts (a guaranteed win); rg-missing / unknown error →
`null`, and the caller **passes through** — never add tokens we can't justify. `MIN_CALLER_FILES` stays as
a cheap pre-filter so the rg call only runs on already-plausible interceptions (Grep is ~1% of tool
events; the extra rg is negligible, and `rg` is present wherever the Grep tool runs — it *is* ripgrep).

## The trade-off

One extra `rg` invocation per intercepted content grep (a rare path), scoped to match the agent's grep. A
non-string `path`/`glob` we can't faithfully reproduce → pass through (we won't guess the scope). The
packet engram returns is still repo-wide (a recall feature); the *gate* compares it against the agent's
actual scope, so a narrowly-scoped grep that the repo-wide packet would exceed is correctly passed
through. The gate is **conservative**: a false passthrough costs a few tokens, a false intercept breaks
the "never worse" promise — we optimise for the promise. The floor uses `-w` (word) while the agent's
grep is substring-by-default, so on rare distinctive symbols we may pass through a marginal win; safe
direction.

## Consequence

`engram measure` and the live handler now agree: symbols where the packet would be larger are passed
through, never folded into a "saving." The promise holds by measurement, not proxy.
