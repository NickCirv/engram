# Phase A — Resolver: Concatenator → Displacement Engine

**Status:** Design spec (read-only research) · **Date:** 2026-06-20 · **Author:** engram-phaseA-researcher
**Scope:** `src/providers/resolver.ts` only. No code edited. Honesty: DISPLACEMENT (aggregate→rank→DISCARD), never "aggregate more"; counter attests *displaced*/*redundant*, never "saved". W1.9: net-of-caching ≈ 0 — no cost claims.

## 0. Premise corrections (file:line evidence)

- **Paths wrong in brief.** Files are `src/providers/resolver.ts`, `src/providers/mcp-client.ts`, `src/providers/types.ts` — NOT `src/intercept/providers/`. Line numbers below are the real ones.
- **`confidence` default 0.75** is real: `mcp-client.ts:293` `tool.confidence ?? 0.75`.
- **Priority array** is real: `types.ts:163` `PROVIDER_PRIORITY` (9 entries, `engram:ast` … `engram:lsp`).
- **PARTIAL DEDUP ALREADY EXISTS** (brief said "ZERO" — half-wrong): `resolver.ts:174-179` drops `engram:structure` when `engram:ast` succeeded. It is a single hard-coded provider-pair special case, NOT general semantic dedup. Phase A generalises it; do not claim it's net-new.
- **`ProviderResult` shape** (`types.ts:33-42`): `{ provider, content, confidence, cached }`. **No symbol id, no path, no line range** — only free-text `content`. This is load-bearing: dedup can only operate on normalized `content`, not structured keys. Symbol-level dedup would require a provider-contract change (out of Phase A scope; noted as risk).

## 1. Where duplication arises

The Read handler resolves enrichment providers (`read.ts:182-188`): `engram:mistakes, engram:git, mempalace, context7, obsidian` (structure already in `fileCtx.summary`). MCP code-graph plugins join via `getAllProviders()` (`resolver.ts:145`). Cross-provider dupes:
- **structure ↔ MCP code-graph** — same function signature/callers text from `engram:structure` and an MCP graph server (only AST↔structure is currently handled, 174-179).
- **mistakes ↔ git** — same commit/line cited as "broke here" (mistakes) and "churned here" (git).
- **mempalace ↔ obsidian** — same decision note synced to both stores.
- **context7 ↔ MCP docs plugin** — same library doc snippet.

Each arrives as a *section blob* of `content` (`mcp-client.ts:248` joins multiple tool outputs with `\n\n`). Dedup granularity is therefore the **section** and, finer, the **line/shingle** within a section.

## 2. Design — three changes

All three slot into `resolveRichPacket` between collection (`resolver.ts:172`) and assembly (`resolver.ts:212`), in this order: **(b) blend rank → (a) dedup → (c) size gate**. Rank first so dedup's keep-decision honours blended score; gate last over the final packet.

### (a) Dedup pass — content-normalized shingles (cheap first)
New `dedupResults(results: ProviderResult[]): { kept; redundantTokens }` called at `resolver.ts:185` (replacing the AST/structure special-case 174-179, which becomes one general rule).

- **Normalize:** lowercase, collapse whitespace runs→single space, NFKC unicode fold, strip section header/label noise. → `norm(content)`.
- **Shingle:** w=5 word k-shingles → `Set<hash>` (FNV-1a 32-bit, reuse `estimateTokens` neighbour util style; no new dep).
- **Compare:** Jaccard over shingle sets. `J ≥ 0.85` ⇒ duplicate (tune via tests; 0.85 tolerates reformatting, rejects merely-same-topic).
- **Sub-section dedup:** within the *kept* result, drop individual lines whose 5-shingle set has `J ≥ 0.9` against a line already emitted by a higher-ranked result. This is where most real displacement happens (partial overlap, not whole-section).
- **Keep rule (tiebreak):** on a dup cluster keep the member with **highest blended score** (from (b)); on score tie keep **highest raw `confidence`**; on confidence tie keep **first by priority index**. Deterministic.
- **Accounting:** sum `estimateTokens` of every discarded section + discarded line ⇒ `redundantTokens` (for §4).
- **Embeddings: deferred, NOT used.** Justification gate (must hold to adopt later): only if a stress corpus shows shingle-Jaccard misses ≥15% of true semantic dupes (paraphrase with <0.85 lexical overlap) AND the false-keep tokens exceed the embedding compute cost. No data yet ⇒ hashing only. Recording this so a future session doesn't silently add a model dependency.

### (b) Blend confidence across providers (invert the comparator)
Replace the comparator at `resolver.ts:197-204` (priority-primary, confidence-tiebreak) with a blended score:

```
priorityWeight(p) = (P - idx(p)) / P        // idx via PROVIDER_PRIORITY; unknown ⇒ idx=99 ⇒ ~0
score(r) = 0.6 * r.confidence + 0.4 * priorityWeight(r.provider)
sort desc by score; tie → higher confidence; tie → lower priority idx (deterministic)
```

- `P = PROVIDER_PRIORITY.length`. Weights chosen so a **low-priority high-confidence** result (e.g. MCP graph, idx 8, conf 0.95 → 0.6·0.95+0.4·0.11=0.61) **beats** a **high-priority low-confidence** result (engram:git idx 6, conf 0.3 → 0.6·0.3+0.4·0.33=0.31). Priority still contributes (it's the 0.4 term) so it remains a real signal, not discarded.
- `boostByMistakes` (`resolver.ts:192`, 458-477) stays — it adjusts `confidence` *before* scoring, so mistake-touching results rank up across the blend, not just within a tier. This is an intended upgrade over today's tie-only effect.
- `0.6/0.4` weights are config-exposed (`config.rankConfidenceWeight`, default 0.6) so they're tunable without a code change.

### (c) Never-worse size gate (reuse ADR-0007 pattern)
ADR-0007's grep gate (`grep.ts:93 rawGrepFloorTokens`, gate at `read.ts:166-172`) compares `estimateTokens(packet)` vs a conservative raw floor and PASSTHROUGHs if not strictly smaller. Reuse the *shape*, not the rg floor.

- **Baseline = pre-displacement packet tokens.** Compute `baselineTokens = sum(estimateTokens(r.content))` over the budgeted-but-not-yet-deduped results (the tokens engram would emit today). Compute `finalTokens` after dedup+rank+assembly.
- **Gate:** `if (finalTokens >= baselineTokens) ` → emit the **smaller** of {deduped packet, today's packet}; never emit a packet larger than today's. Because dedup only removes, `finalTokens ≤ baselineTokens` always holds for the *content*; the gate guards against header/label churn re-inflating it (see §5 risk). Mirrors `read.ts:170 if (summaryTokens >= fileTokens) return PASSTHROUGH`.
- Honest framing: gate proves packet is **smaller-or-equal** while rank keeps top-relevance first.

## 3. Hook points (resolver.ts)
| Step | Line today | Change |
|---|---|---|
| collect results | 165-172 | unchanged |
| AST/structure special-case | 174-179 | **remove** — folded into general `dedupResults` |
| per-provider budget | 185 | unchanged (runs before dedup) |
| boostByMistakes | 192 | unchanged (feeds confidence into blend) |
| **blend sort (b)** | 197-204 | **replace comparator** with blended `score` |
| **dedup (a)** | new, after sort (~205) | `{kept, redundantTokens} = dedupResults(sorted)` |
| assembly loop | 212-226 | iterate `kept` |
| **size gate (c)** | new, after 228 | compare final vs baseline; emit smaller |
| return RichPacket | 241-247 | add `displacedTokens`, `redundantTokens` |

## 4. engram-counter instrumentation
Extend `RichPacket` (`resolver.ts:112-123`) + counter audit block:
- `redundantTokensEliminated` — tokens removed by dedup (§2a accounting). Attest "redundancy eliminated".
- `tokensDisplaced` — `baselineTokens − finalTokens` (gate's measured delta). Attest "tokens displaced".
- **Never** a `saved`/`cost` field. Counter consumes these two integers; aggregate is sum, never a % cost claim.

## 5. Where this risks INCREASING tokens (flagged)
1. **Header/label re-inflation** — if dedup drops a whole section, `providerCount` shrinks but per-section labels stay; net could rise if dedup removes tiny sections and keeps big ones. Mitigation: gate (c) is the backstop; refuse any packet ≥ baseline.
2. **Sub-section line-dedup leaving orphans** — removing interior lines can leave a dangling header with no body. Mitigation: drop a section whose body falls to 0 lines post-dedup.
3. **Blend promoting a verbose low-priority result** that pushes a terse high-priority one past budget at `resolver.ts:214`. Ranking changes *order*, not size — but order changes *which* sections survive the budget cut. Net tokens unchanged (budget caps it), but relevance could drop; covered by the "low-priority-high-confidence beats" test asserting the displaced result is genuinely more relevant, not just longer.

## 6. TDD test list (ordered) — `tests/providers/resolver.test.ts`
1. **dedup collapses identical sections** — two providers, same `content` → one section, `redundantTokensEliminated == estimateTokens(dup)`.
2. **dedup collapses whitespace/unicode variants** — same text, NFKC + collapsed spaces differ → still deduped (J≥0.85).
3. **dedup keeps highest blended score on a cluster** — dup pair, assert the kept one is the higher-score member, not first-arrival.
4. **sub-section line dedup** — partial overlap (3 of 5 shared lines) → shared lines removed once, both sections survive minus overlap.
5. **blend: low-priority high-confidence beats high-priority low-confidence** — MCP graph(idx8,0.95) ordered above engram:git(idx6,0.30).
6. **blend: priority still contributes** — equal confidence → higher-priority first (the 0.4 term decides).
7. **boostByMistakes feeds blend** — mistake-touching low-priority result outranks a non-touching equal-confidence one.
8. **size gate refuses larger packet** — synthetic case where labels inflate → assert emitted packet ≤ baseline (never larger).
9. **size gate: deduped is strictly smaller** → emits deduped, `tokensDisplaced > 0`.
10. **empty results** → returns null (parity with `resolver.ts:172`).
11. **malformed result (empty content / non-string)** → skipped, no throw, others survive.
12. **never-worse under N providers** — property test, 2..8 random providers w/ random overlap → `finalTokens ≤ baselineTokens` ALWAYS.
13. **AST/structure regression** — old special-case behaviour (drop structure when AST present) still holds via general dedup (guard against regressing 174-179).
14. **counter fields populated** — `redundantTokensEliminated` + `tokensDisplaced` present and consistent (`displaced == baseline − final`).

### 3 adversarial scenarios
- **A1 — near-dup-not-dup (J just under threshold):** two results J≈0.84 (same topic, different specifics). Assert BOTH kept (dedup must not eat distinct context). Tunes the 0.85 boundary.
- **A2 — hostile MCP plugin returns 50KB single section, confidence 1.0:** per-provider budget (185) truncates first; blend can't let it starve others; gate proves no net increase. Assert other providers still present + packet ≤ baseline.
- **A3 — adversarial label collision:** plugin sets its `content` to mimic another provider's section verbatim to get itself kept. Assert keep-rule uses blended score+confidence (not content identity) so the impersonator doesn't displace the genuine higher-confidence source.
