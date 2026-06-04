# How engram compares

engram is a **local, ranked, hook-boundary** code-graph context layer for AI coding agents. The closest
tools are the local code-graph projects **CodeGraphContext** and **codegraph** (colbymchenry). All three are
permissively licensed (engram **Apache-2.0**; the other two MIT) and run fully local — that's parity,
not a differentiator. The differences that matter
are architectural, and they're verifiable.

_Facts below verified against each project's README + the GitHub API on 2026-06-04. If any has changed,
open an issue — we'd rather fix this table than carry a stale claim._

## The comparison

| | **engram** | **CodeGraphContext** | **codegraph** (colbymchenry) |
|---|---|---|---|
| Delivery | **Hook-boundary — answers the agent's Read/Grep automatically** | Query-based MCP server (agent must choose to call it) | Query-based MCP server |
| Result ordering | **PageRank-ranked** (returns the *important* call-sites first) | Unranked graph queries | Unranked (SQLite + FTS5 lexical) |
| Past-mistakes memory | **Yes** (bi-temporal — surfaces fixes the agent already made) | No | No |
| License / local | **Apache-2.0** / fully local | MIT / local-capable | MIT / fully local |
| IDE coverage | 8 | 13 | 8 |
| Cost claim | **None — by design** (see below) | None | Markets ~16% cheaper |

Two honest notes against ourselves: **CodeGraphContext covers more IDEs than engram** (13 vs 8), and
breadth is now table stakes in this category, not an engram advantage. And engram makes **no cost claim**
where one competitor does — that's a deliberate choice, explained next, not a gap.

## The three differences that are actually ours

1. **Hook-boundary auto-interception.** An MCP server only helps when the model *decides* to call it.
   engram sits at the tool-call boundary: when the agent runs a Read or a symbol Grep, engram answers
   from the graph automatically — no new tool for the model to remember, and it works in shell-only IDEs
   (Aider, Codex CLI, Cline) that have no structured Grep tool at all.

2. **Ranking.** A graph that treats every node equally hands the agent a flat neighbourhood. engram ranks
   the reference graph with PageRank, so a symbol search returns the *important* call-sites first — which
   is what lets a ranked subset answer the question instead of a flood of matches. ("Ranked" refers to
   query ordering only — never a re-ordering of your grep results behind your back.) In fairness, ranking
   alone isn't unique — **Aider's repomap also ranks via PageRank**; it differentiates engram from the
   *unranked* MCP-server tools above. The moat versus the whole field is the **combination** — ranked
   *and* hook-auto-injected *and* mistakes-memory *and* honestly measured (see `docs/FRONTIER.md`).

3. **Past-mistakes memory.** engram mines `fix:` / `fixes #N` history into a bi-temporal memory and
   surfaces the relevant past mistake when the agent is about to touch the same code. No other local-graph
   tool has this.

## The honest stance on cost (and why it's a feature)

engram does **not** claim to save you money, and won't — because with prompt caching, a local context
layer's net effect on your bill is ≈ 0 (we measured it — see `bench/`). Every number
engram reports is a **structural context-token reduction** — fewer tokens entering the model's context
per tool call — which buys **capacity** (longer sessions before the context wall) and **quality** (ranked
context, mistakes memory), not a smaller invoice.

We're explicit about this because the alternative is the trap the category keeps falling into: headline a
token-reduction percentage as if it were a cost saving. It isn't. If a tool tells you a local graph makes
your agent *cheaper*, ask it to separate its number from what prompt caching already does for free. ours
is in `npm run bench`, with the recall-coverage caveat and the break-even point shown.

## See for yourself

```bash
npm run demo     # the honest before/after on engram's own repo
npm run bench    # the rigorous, P-modelled aggregate — run it on your repo
```

See `docs/adr/0006-honest-before-after-demo.md` for the demo's methodology and `docs/PLAN.md` §1–§2 for
the positioning.
