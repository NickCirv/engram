# engram — State & Next Step

_Single source of truth for "where we are / what's next." Update at the end of each arc._

**Last updated:** 2026-06-04 · **Live:** `engramx@4.2.0` "Loop" on npm · **main:** green (1100 tests, 0 vulns, tsc clean, fresh-clone verified)

---

## Where we are

engram is a local code-graph context layer for AI coding tools. It indexes a repo into a SQLite
knowledge graph once, then intercepts the agent's tool calls at the hook boundary and answers from
the graph instead of letting raw file/grep output flood the context window.

**The honest claim (do not drift):** every number engram reports is a *structural context-token
reduction* — fewer tokens entering the model's context window per tool call — **not** a cost/bill
saving. With prompt caching, engram's net effect on the dollar bill is ~0 (measured, W1.9). The value
is capacity (longer sessions, fewer "context full" walls) and quality (ranked context, mistakes
memory, audit). "Ranked" refers only to the **PageRank query ordering**, never the grep caller list.

### Shipped this arc (v4.1 "Compass" → v4.2 "Loop")

| Feature | What it does | Gated / recall-safe | ADR |
|---|---|---|---|
| Ranked context (PageRank) | Query results ranked over the `calls` reference graph | — | (v4.1) |
| `callers/callees/impact` traversal | CLI/MCP over the reference graph | — | (v4.1) |
| **Grep interception** | Content-mode symbol grep → **call-site lines** from the graph | `output_mode==="content"` + ≥4 caller files; `rg -n` escalation; `ENGRAM_GREP_INTERCEPT=0` | 0001, **0004** |
| **Same-session read dedup** | Re-read of an unchanged file → pointer, not re-serve | byte-unchanged + full-read-only + PreCompact/SessionStart reset + TTL/cap; `ENGRAM_READ_DEDUP=0` | 0003 |
| Day-1 mistakes | `fix:`/`fixes #N` miner seeds mistake-memory on init | `ENGRAM_MISTAKE_GUARD` (warn floor) | (v4.1) |

### Measurement (how we keep ourselves honest)

- `bench/real-world.ts` — per-file structural reduction (size-guarded "effective" number).
- `bench/session-level.ts` — the session model: first-reads/greps via the **recall-recovery P-model**
  (packets are lossy → reported as a curve over P + a break-even), plus a **recall-coverage** metric
  (does the grep packet contain the actual usage lines), plus **dedup** re-reads as a separate *clean*
  saving. The whole-session number is a **same-epoch ceiling** (dedup doesn't fire post-compaction) —
  the bench discloses this; don't quote it as realistic.
- `engram-counter@0.2.0` (separate public repo) — cache-aware cost accounting on real logs.

ADR index: `docs/adr/0001`–`0004` (grep intercept · session bench · read dedup · richer find-usages).

---

## Open threads / next-step candidates

1. **Bash-grep interception** — agents also run `rg`/`grep` via the **Bash** tool, which bypasses the
   Grep-tool interception entirely. Closing it extends the v4.2 grep win to the Bash path. Real user
   value, Phase-0-measurable (how often do agents grep via Bash?). _Strongest next lever._
2. **git-bugfix-miner hardening** (task #70, deferred, non-blocking) — per-commit `git show` forks,
   separator-byte parsing, surrogate slice. Perf/robustness, not correctness.
3. **Workload router** — _parked._ Built on the W1.9 bimodal, our weakest evidence (N=3, high
   variance). The per-call honest gates we already ship (read size-guard, grep content+caller gate,
   dedup) are effectively a better router — they only fire when engram genuinely saves. Revisit only
   if the bimodal firms up with more runs.

## Gated (needs Nick / not engineering)

- **LEAK-P2** — purge advisory docs + paths from OLD engram-counter history (git-filter-repo +
  force-push). Drafted; awaiting authorization.

## Working rhythm (what produced this arc)

Phase-0 measure → build gated + recall-safe → triple-audit (tsc + full suite + e2e from built CLI) →
**adversarial review** (every feature this arc had a real issue caught: dedup recall holes, the
find-usages token regression, the bench inflation caveat) → leak-audit → ship. Don't skip the
adversarial pass — it has paid for itself every single time.
