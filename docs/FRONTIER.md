# The Frontier — where engram pioneers

_A grounded research map of context-token efficiency for AI coding agents (2026), and the
unoccupied white space engram is built to own. Synthesised from a 5-front research sweep on
2026-06-04. This is the "be pioneers, understand the whole realm" document — it sets direction;
`docs/PLAN.md` tracks the work._

> **The honest spine still governs everything below.** engram delivers a *structural context-token
> reduction → capacity + quality*, not a dollar saving — except in the specific cache-hostile regimes
> identified in §3, where the saving is genuinely real and we can claim it honestly.

---

## 1. The map: five layers of context reduction, by where they live

| Layer | Technique | Lives | Reachable by a local hook tool? |
|---|---|---|---|
| **Structural** | repo-maps, tree-sitter symbol graphs, **PageRank ranking** (Aider, engram) | tool | **Yes — engram's home** |
| Retrieval (RAG-for-code) | embedding + lexical hybrid, reranking (Cursor, Cody, Claude-Context) | tool | yes |
| Prompt compression | LLMLingua-2 / LongLLMLingua (token-dropping, lossy) | tool/proxy | yes, but lossy — wrong trust model for code |
| Distillation / memory | compaction, sub-agent summaries, memory tools | agent scaffold | partly |
| KV-cache / token-level | H₂O, PyramidKV, StructKV | **inside the model** | **no** |

The structural layer is the one place a *local, offline, deterministic* tool genuinely shapes what the
agent consumes. That is engram's lane — and it's the honest one.

## 2. The value thesis is validated (this is the important part)

Less + ranked + relevant context **measurably improves agent outcomes** — it is not just fewer tokens:

- **Chroma "Context Rot"** tested 18 frontier models (GPT-4.1, Claude Opus 4, Gemini 2.5): *every one*
  degrades **20–50%** as input grows 10k→100k+. Their conclusion: "careful curation is more critical
  than providing more raw information." That is engram's pitch, externally validated.
- **Lost-in-the-middle**: ~30%+ accuracy loss when relevant content is buried mid-context — so *ranking*
  (putting the right call-sites first) directly raises recall. Ranking is not cosmetic.
- **SWE-Pruner** (SWE-bench): pruning to relevant context **raised** resolve-rate to **64% vs 54%** for a
  naive compressor — reduction that *improves* success.
- **SWE-Effi**: an *unresolved* agent attempt burns ~**4× more resources** than a successful one. So the
  only honest efficiency metric is resolve-rate-per-token (AUC), never token count alone — and a
  reduction that lowers success is strictly worse than no tool. engram's "net ≈ 0 cost, honest
  structural reduction, measured" framing is exactly the posture this rewards.

**Implication:** engram's real product is **capacity + quality** (headroom before context-rot sets in,
and the right code ranked first), and the evidence base for that is strong. Lead with it.

## 3. Where engram nets a REAL saving (the honest exceptions to "net ≈ 0")

Prompt caching (Anthropic 0.1×, OpenAI 0.25–0.5×, Gemini 0.1× on cache reads) owns the cost of the
*second* read of a stable prefix. It does **nothing** for four cache-hostile regimes — and these are
where engram genuinely saves cost, honestly:

1. **First-reads / cache-misses** — caching gives 0 discount on the miss; a smaller structural payload
   is a full-price saving on every first read.
2. **Edit-busts** — caching is prefix-exact; a mid-session edit invalidates everything after it and
   forces full-price reprocessing. Fewer structural tokens upstream of the edit = smaller reprocess bill.
3. **Sub-agent fan-out** — multi-agent runs use **~15× the tokens** of a chat because *each* spawned
   agent opens a fresh window and pays a fresh cache **write**. Caching doesn't share across agents.
   Feeding each sub-agent a tight ranked slice multiplies the saving by N at write price **when the slice
   displaces more exploration than it costs** (per-workload, measured by #85 — never asserted). **This is the
   single biggest honest dollar lever, and it's engram's best case.**
4. **Window-limit avoidance** — past the window there is no cache discount; structural reduction is the
   *enabling* move (and avoids lost-in-the-middle quality loss).

The pioneering instrument: a **cache-hostility profiler** that reports a user's spend split across these
regimes, so engram claims a dollar saving *only* in the cache-hostile share — turning the "net ≈ 0"
finding from a weakness into a precise, defensible boundary.

## 4. The competitive white space (and an honesty correction)

**Correction to our own positioning:** **PageRank ranking is NOT unique to engram — Aider ships a
personalised-PageRank repomap.** Ranking differentiates us from the *unranked MCP-server* tools
(CodeGraphContext, codegraph), but it is **not** a moat versus the whole field. The defensible moat is
the **combination** none of them have:

| Tool | Ranked? | Hook auto-inject? | Mistakes-memory? | Cross-session? | Honest measurement? |
|---|---|---|---|---|---|
| Aider repomap | **yes** | no (its own CLI) | no | no | no |
| CodeGraphContext / codegraph | no | no (pull-MCP) | no | partial | no |
| Cursor / Cody / Augment | RAG-rerank | no (in-IDE) | no | index | no |
| Claude Code (grep-only) | no | n/a | no | no | no |
| **engram** | **yes** | **yes (hooks, every IDE)** | **yes (bi-temporal)** | **yes (local graph)** | **yes (the discipline)** |

The unoccupied intersection: **a ranked code-graph that auto-injects via hooks + carries mistakes-memory
as first-class ranked nodes + persists across sessions + proves its own effect honestly.** Aider ranks
but forgets and has no hooks; CodeGraph remembers structure but is unranked and pull-only; memory tools
remember failures but can't rank or auto-inject; Claude Code rejects indexing entirely (the token-burn
wedge). In a field where every claim is inflated, **honest, reproducible, confound-separated measurement
is itself a category-defining moat.**

## 5. The pioneering moves (prioritised)

| # | Move | Why it's pioneering | Honest? | Roadmap |
|---|---|---|---|---|
| **F1** | **Sub-agent context broker** — feed each fan-out sub-agent a tight ranked slice instead of the full corpus | the ~15× cache-write regime caching can't touch — engram's biggest REAL dollar saving | nets real cost, claimed only in the fan-out share | #83 |
| **F2** | **Session ledger that survives compaction** — never read the same thing twice / re-derive structure, even across `/compact` | only a *persistent local* layer can do this; harnesses reset | structural + capacity | #84 (extends #72/#73) |
| **F3** | **Recall-coverage → resolve-rate benchmark**, caching-isolated | nobody publishes coverage tied to outcomes; everyone leads with token theater | the procurement-grade honesty moat | #85 (extends #81 + session bench) |
| **F4** | **Cache-hostility profiler** — report a user's spend split across §3 regimes | converts "net ≈ 0" into a precise, claimable boundary | the most honest cost story possible | folds into #83 |
| **F5** | **Per-turn query-conditioned re-ranking** — re-personalise the graph each turn vs the live task | Aider ranks once/session; KV adapts inside the model; the hook can re-rank every turn → precision-at-budget, attacking ContextBench's measured "explored-vs-utilised" gap | structural + quality | research → later |
| **F6** | **Fuse code-graph + mistakes-graph** — past mistakes rank as high as hot code, auto-injected | the identity move; no competitor combines structure + ranked failure-memory + hooks | quality/safety | research → later |

**The single highest-leverage move:** **F1 (sub-agent context broker).** It is the one place engram can
honestly claim a *real dollar saving* (the regime caching is structurally blind to), it compounds with
the agent industry's shift to multi-agent fan-out, and it's unclaimed. F3 (the honest benchmark) is its
necessary twin — it's how we *prove* F1/F2 without becoming the over-claimers we're differentiating from.

## Sources

Context-rot & quality: Chroma Context-Rot (18-model study); Stanford lost-in-the-middle; SWE-Pruner
(arXiv 2601.16746); SWE-Effi (arXiv 2509.09853). Caching: Anthropic/OpenAI/Gemini caching docs (2026);
Anthropic multi-agent "15×" report. Structural SOTA: ContextBench (arXiv 2602.05892); Aider repomap
(DeepWiki); Codebase-Memory KG (arXiv 2603.27277); LLMLingua-2 (arXiv 2403.12968). Competitive: Cursor
indexing; Sourcegraph Cody; CodeGraphContext / codegraph repos; Claude Code "no indexing" (vadim.blog);
RANGER / GraphCodeAgent / RACG survey (arXiv 2510.04905). Cumulative loop: Anthropic "effective context
engineering"; Claude Code sub-agents docs; TrueFoundry context-engineering.
