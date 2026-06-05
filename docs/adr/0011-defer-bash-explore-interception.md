# ADR-0011: Defer Bash directory-exploration interception (#72)

**Status:** Accepted (decision: do not build) · **Date:** 2026-06-05 · **Author:** Nicholas

## Context

The token-loop roadmap listed #72: intercept directory exploration (`ls`/`find`/`tree` via Bash + the
Glob tool) and answer from engram's graph instead of letting the listing flood context — the last open
"bypass" after Read, Grep, and Bash-grep. Phase-0 backtested the premise before building.

## The backtest (decisive)

engram's graph is a **code-symbol graph, not a file index.** Measured on engram's own repo:

| Source | Count |
|---|---|
| Graph `file` nodes | **183** (178 `.ts` + 5 `.mjs`) |
| `git ls-files` (all tracked) | **327** |

The graph holds **56% of tracked files, and is 100% code-only** — direct query: 0 `.md` (62 in repo),
0 `.json` (19), 0 `.yaml`/`.yml` (10), 0 `.png`/`.html`/`.svg`/`.sh`/`.csv`/`.pdf` (~25+). So:

- **"Answer `ls`/`find`/`tree` from the graph" is dishonest by construction** — engram would return a
  listing silently missing 44% of the repo (every doc, config, asset). That breaches the honest spine.
- **Only deep recursive listings flood** (`ls src/` ≈ 53 tokens — intercepting it would *add* tokens, the
  exact ADR-0007 / #82 never-worse trap). And the deep listings are precisely the queries the graph
  cannot honestly answer (they pull in the non-code 44%).
- **Recall is near-zero:** `find -name '*.md'` / glob `**/*.json` → engram can serve 0% (not in a code
  graph). The only honestly-servable exploration is "list code files," which is small enough to lose the
  never-worse gate and is already better served as *symbols* by the Read/Grep handlers.

## Decision

**Do not build #72.** Directory exploration is either tiny (`ls` — never-worse fails) or un-servable
(docs/configs/assets absent from the graph). Pass-through is the honest behaviour. The Read + Grep
handlers already cover the high-value case (symbol/code recall); a fourth interception handler here adds
honesty risk, not capacity.

## The trade-off

We forgo closing the "exploration bypass." Accepted: serving partial file listings would violate engram's
own honest spine and the never-worse promise (ADR-0007) we just fixed for grep (#82) — and per
`docs/FRONTIER.md`, the binding constraint on winning is **distribution, not more interception**.

## Rescope path (only if ever revisited)

The narrowest honest version would intercept *only* deep recursive `find`/`tree` (never bare `ls`) with a
filesystem walk (respecting `.gitignore`) returning a dir-count summary + god-node structure + a mandatory
escalation footer. But that's a generic fs-summarizer, not graph-backed, and low value. Not recommended.
