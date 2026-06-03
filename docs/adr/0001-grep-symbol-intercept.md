# ADR-0001: Intercept symbol-search Grep with the reference graph (recall-safe)

**Status:** Accepted · **Date:** 2026-06-03 · **Author:** Nicholas

## Context

engram's original Context Spine thesis (`docs/specs/2026-04-13-context-spine-design.md`) was to
collapse the agent's 5-call investigation loop (grep → read → read → grep) into one packet, targeting
90%+ *session-level* token reduction. The shipped product only intercepts `Read`/`cat` — so the agent
still runs every `Grep` raw, and a symbol search across a large repo floods the context window with
match lines (often 2–20k tokens). The W1.9 benchmark shows engram already wins exactly on the
explore-heavy workloads (troubleshooting +24.9%, code-understanding +23.3%) and is neutral/negative on
linear edits — i.e. the value is in *exploration elimination*, which this gap leaves on the table. The
`calls` reference graph + `findCallers/findCallees/findImpact` (pure traversal, alphabetically sorted) already exist but are
CLI-only — never wired into the hook.

## Decision

Add a `PreToolUse:Grep` handler that intercepts **only** a bare-identifier pattern that matches a known
symbol with references in the `calls` graph, denies the grep, and returns engram's caller list (the files that reference it).
For anything else — regex/metacharacter patterns, multi-word/text searches, stopword identifiers, or a
symbol the graph doesn't know — it returns PASSTHROUGH so the real grep runs.

The chosen trade-off: the `calls` graph is **name-based and structural**, so it has *lower textual
recall* than grep (it misses comments, log strings, dynamic dispatch, partial matches). Replacing grep
wholesale would blind the agent — a correctness regression. We mitigate by (a) intercepting only when
the pattern is a known symbol with ≥1 caller (high precision), and (b) **always emitting the exact
`rg -n "<pattern>"` escalation command** in the deny reason, so the agent can recover full textual
matches in one step if it needs them. The token win comes from the common case ("where is this symbol
used") being answered from a caller-file list (~tens–hundreds of tokens) instead of a raw match dump,
while correctness is preserved by the escalation path. The discarded alternative — augment-don't-deny
(let grep run AND add engram's note) — preserves recall perfectly but saves zero tokens (grep still
runs + we add tokens), which defeats the purpose. If the precision gate proves too narrow or too broad
in practice, the gate (identifier shape + known-symbol + has-callers) is the single tuning point and
can change without touching the graph or the deny/passthrough contract.
