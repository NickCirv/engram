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
saving. With prompt caching, engram's net effect on the dollar bill is ~0 (measured). The value
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

### Shipped 2026-06-04 (on `main`, post-v4.2 — bundles into v4.3)

| What | Where | ADR |
|---|---|---|
| **Bash-grep interception** (#71) | `src/intercept/handlers/bash.ts` — `rg`/`grep` via Bash → `handleGrep`; net-new for shell-only IDEs | **0005** |
| **Honest before/after demo** (#77) | `npm run demo` + `docs/demos/before-after.cast`; −78% / ~4.5× with ceiling + ~22% recall + ~20% intercept-rate + passthrough floor all disclosed | **0006** |
| **Differentiation comparison** (#78) | `docs/COMPARISON.md` — verified-facts-only vs CodeGraphContext/codegraph (both query-based MCP + unranked + no mistakes-memory; CodeGraphContext = 13 IDEs > engram's 8) | — |
| **`engram measure`** (#81) | shipped CLI — honest structural reduction on the USER's own repo; auto-discovers top symbols, all disclosures computed live; only counts genuine reductions | — |
| **Grep never-worse gate** (#82) | `src/intercept/handlers/grep.ts` — sizes the real grep scoped to the agent's cwd+path+glob; passes through when the packet isn't smaller. Closes a real "never worse" violation found by #81 | **0007** |
| **Sub-agent context broker** (#83) | `src/intercept/handlers/subagent-start.ts` — registers Claude Code's `SubagentStart`; injects a ~100-tok production-only structural slice per sub-agent (the fan-out regime caching can't help). Honest (a bet, not "never worse"); opt-out `ENGRAM_SUBAGENT_CONTEXT=0` | **0008** |
| **Recall-coverage benchmark** (#85, deterministic half) | `npm run bench:recall` — the honesty moat: does engram's ranked answer surface co-changed files? recall@10 33.0% (vs 29.8% random-within-candidate, 10.4% blind); reaches 43.0%, ranker +3.2pp. Backtest killed the 88.9% `impact`-firehose vanity number. Live resolve-rate A/B → #87 (gated) | **0009** |
| **Compaction session ledger** (#84) | `src/intercept/handlers/pre-compact.ts` — after explicit `/compact`, a path-only "Previously read this session" list (top-8 recent files) so the agent doesn't re-explore. Honest (a bet; path-only after adversarial caught stale/arbitrary symbols); opt-out `ENGRAM_COMPACT_LEDGER=0` | **0010** |
| Master plan + Frontier research | `docs/PLAN.md` (four tracks + §9 frontier) · `docs/FRONTIER.md` (5-front pioneer research) · `docs/COMPARISON.md` honesty fix (Aider ranks too) · README cost-claim scrub | — |

**Inflection point: the feature-build runway for this arc is complete + verified RELEASE-READY** (fresh-clone audit 2026-06-05: npm ci 2.82s, tsc clean, full suite 1128/0, all new commands run with honest disclosures, never-worse holds, zero leak hits across 18 public files, no cost claims). Token-loop closed (Read/Grep/Bash-grep shipped; **#72 Bash-explore DEFERRED — ADR-0011**, graph is code-only); frontier F1/F2/F3 shipped.

**Next is strategic + Nick-gated, not more features:**
- **v4.3 release (#74, Nick 2FA)** — bundles Bash-grep + `engram measure` + never-worse gate + sub-agent broker + recall bench + compaction ledger. Highest-leverage: ships the honest improvements to users. Ready for the ship-hygiene run on Nick's go.
- **Distribution (#79 launch / #80 marketplace)** — FRONTIER's binding constraint.
- Gated: **#86** (smoke #83 in real Claude Code), **#87** (live resolve-rate A/B, budget), **#65** (LEAK-P2 force-push).

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

## Roadmap

**The full goal — strategy, four tracks (Product / Proof / Distribution / Enterprise), and the
competitive reframe — now lives in `docs/PLAN.md` (the master form).** This section tracks the Product
track ("close the loop"). Per PLAN §8, after item A the highest-leverage move is the **Track-D
before/after demo (#77)**, not more interception — distribution is the binding constraint, not the loop.

| # | Task | Status | Why |
|---|---|---|---|
| **A (#71)** | **Bash-grep interception** | **done, audited** (commit pending) | agents `rg`/`grep` via the **Bash** tool, bypassing the v4.2 Grep-tool win entirely. Reuses `handleGrep` + all gates; ADR-0005; 51/51 bash tests; full suite 1110; adversarial SHIP. Net-new coverage for shell-only IDEs (Aider/Codex/Cline). |
| B (#72) | Bash exploration intercept (`ls`/`find`/`tree`/Glob) | blocked by A | directory listings flood context; answer from the graph's file tree, gated. |
| C (#73) | Cumulative session measurement (replay/live) | blocked by A,B | prove the *combined* saving end-to-end (transcript replay over real logs), not per-mechanism. |
| D (#74) | Release **v4.3** (Bash bundle) | blocked by A,B | ship the Bash interceptions to users (else stranded on main). Nick 2FA. |
| E (#75) | git-bugfix-miner hardening | backlog | perf/robustness, non-blocking. |
| F (#76) | Workload router | **PARKED** | built on N=3 (weakest evidence); the per-call gates are already a better router. Revisit only if the evidence firms up. |

## Operating rhythm (every task)

`Phase-0 measure → ADR → build (gated + recall-safe + opt-out) → triple-audit (tsc + full suite + e2e
from the built CLI) → adversarial review (it has caught a real issue every single feature this arc) →
leak-audit → ship + CI-green`. Update this file + the memory anchor after each. Never claim done
without the verification output.

## Gated (needs Nick / not engineering)

- **LEAK-P2** (task #65) — purge advisory docs + paths from OLD engram-counter history (git-filter-repo
  + force-push). Drafted; awaiting authorization.

## Working rhythm (what produced this arc)

Phase-0 measure → build gated + recall-safe → triple-audit (tsc + full suite + e2e from built CLI) →
**adversarial review** (every feature this arc had a real issue caught: dedup recall holes, the
find-usages token regression, the bench inflation caveat) → leak-audit → ship. Don't skip the
adversarial pass — it has paid for itself every single time.
