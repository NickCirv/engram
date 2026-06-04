# ADR-0009: Recall-coverage benchmark (the deterministic half of #85)

**Status:** Accepted · **Date:** 2026-06-04 · **Author:** Nicholas · _Frontier move F3 (#85)_

## Context

`docs/FRONTIER.md` §5 names honest measurement as a category-defining moat: "nobody publishes recall-
coverage tied to outcomes; everyone leads with token theater." #85's full form is a caching-isolated
recall→**resolve-rate** A/B that needs live agents (real API budget — the gated half). This ADR is the
**deterministic half**: does engram's ranked structural answer surface the files a real change actually
touched — measured against git history, no agents, no spend.

## The backtest that shaped it (backtest-before-build)

Phase-0 backtested the obvious metric and **falsified it**: the naive "is the gold file in
callers∪callees∪impact" union recall reports **88.9%** — but that's an artifact of `findImpact` returning
**up to ~81% of the repo** on hub files. "Recall against 81% of the codebase" puts zero useful code in
front of the agent. The signal is real (it beats chance), but the *publishable* number must be **recall@k
on the PageRank-ranked list, with `impact` excluded**, or our own honesty discipline (rightly) torches it.

## Decision

`bench/recall-coverage.ts` (`npm run bench:recall`):
- **Gold** = non-merge commits touching ≥2 known source files (tests/docs/config and renames/deletes
  excluded). Each commit's changed files are the co-change set.
- **Candidate related files** for a start file `f1` = `callers(f1's symbols) ∪ callees(f1)`. **`impact` is
  excluded** (the firehose).
- **Rank** with engram's real ranker: personalized PageRank seeded on f1's symbols.
- **Metric**: recall@5 / recall@10 = |gold_others ∩ top-k| / |gold_others|; MRR over the first gold hit.
  **Every changed file is rotated as f1** — report mean AND worst-case (per-commit minimum), because an
  agent doesn't always start at the hub file. Reported against a **random-chance baseline** (k / #source
  files = "what you'd get grepping the repo blind").

First result (engram on engram, default `npm run bench:recall`, deterministic): **recall@5 24.7%,
recall@10 33.0%, MRR 0.466, 71.5% of trials hit @10, worst-case recall@10 20.2%.** Decomposed honestly
(adversarial review): candidate generation (callers∪callees) **reaches 43.0%** of co-changed files;
PageRank ranking then captures **76.6% of that reachable set** at @10 — vs 29.8% for *random ordering of
the same candidates* (the ranker's own lift, +3.2pp) and 10.4% for blind-grep chance. So the headline is
mostly the candidate set, with a modest, honestly-stated ranker contribution. First co-changed file near
rank 2. Real signal, not inflated. _(Self-repo numbers drift as the repo's history grows — reproduce the
current figure with `npm run bench:recall`.)_

## Honesty (disclosed in the bench output itself)

- **STRUCTURAL recall, not resolve-rate.** It measures whether engram surfaces the co-changed files, not
  whether the agent succeeds. The resolve-rate half needs live agents (gated).
- **Co-change ≠ structural relatedness.** Sibling refactors and doc+code changes share no call edge — a
  hard ceiling on what *any* structural tool can predict. The method's own reachable ceiling (callers∪
  callees membership) is **43.0%**, so recall@10 33.0% is read against 43.0%, not 100% — it captures 76.6%
  of what's structurally reachable.
- **Ranking vs candidate generation are reported separately** (vs a random-order-within-candidates
  baseline) so the PageRank ranker's real contribution (+3.2pp) isn't conflated with set membership.
- **9.1% of co-changed source files have no extracted symbols** and are excluded (disclosed in output) —
  engram can't structurally predict them.
- **`impact` excluded** as a vanity firehose (the backtest finding, baked into the method).
- **Self-repo only** (engram on engram, ~96 source files). Generalise before quoting publicly.

## The trade-off

Recall@k on the ranked tight set is a *modest, honest* number where the union-recall vanity number would
be a flashy lie. We choose the modest truth — it is the entire point of the artifact, and it's the number
a procurement reviewer can reproduce with `npm run bench:recall`. The live resolve-rate A/B (the half that
would let us claim a task-success delta) stays explicitly deferred and budget-gated.
