# engram — Master Plan & Operating System

_The full-goal form. Strategy, tracks, task lists, and the way we operate. Pairs with
`docs/STATE.md` (tactical "where we are / next") and `docs/adr/` (decisions)._

**Last updated:** 2026-06-04 · **Live:** `engramx@4.2.0` "Loop" on npm · **main:** green (1110 tests, tsc clean)

---

## 0. The full goal (one sentence)

Make engram the **best local, ranked, IDE-agnostic code-graph context layer for AI coding agents**, and
win adoption as free OSS — **honestly**, on capacity + quality + memory + audit, never on a cost claim.

## 1. The honest spine (never drift)

Every number engram reports is a **structural context-token reduction** — fewer tokens entering the
model's context window per tool call — **not** a cost/bill saving. With prompt caching, engram's net
effect on the dollar bill is ≈ 0 (measured). The value is **capacity** (longer sessions, fewer
"context full" walls) and **quality** (ranked context, mistakes memory, audit). "Ranked" refers only to
the **PageRank query ordering**, never the grep caller list. This constraint is not a weakness to hide —
it's the credibility that the louder incumbents have thrown away (§2).

## 2. The competitive reality (research, 2026-06-04)

The local-code-graph category is now contested:

| Player | Sells (verified 2026-06-04) | Shape |
|---|---|---|
| **CodeGraphContext** (~3.6K★, MIT) | privacy / local graph queries — **makes no cost claim** | query-based **MCP server**; **unranked**; 13 IDEs; no mistakes-memory |
| **codegraph** (colbymchenry, MIT) | markets ~16% cheaper / ~58% fewer tool calls; star count shows **bot-inflation signals** (40K★ / 98 watchers) | query-based **MCP server**; **unranked**; no mistakes-memory |
| Cursor / Cody (Sourcegraph) | scale + cross-repo accuracy (RAG) | cloud-leaning, enterprise-priced |
| Claude Code (agentic search) | zero-setup + freshness | pays in tool-call fan-out |

The cost lane is **contested but modestly** (codegraph ~16%, CodeGraphContext nothing) — and engram
honestly *can't* claim cost at all (caching owns it). Don't price-fight; differentiate on architecture.
engram's three honest, defensible moats (verified absent in both local-graph tools above):

1. **PageRank ranking** — returns the *important* code, not just the *linked* code.
2. **Hook-boundary auto-interception** — answers Read/Grep *automatically*; MCP-server rivals depend on
   the model deciding to call them.
3. **Bi-temporal mistakes-memory** — "your agent stops repeating its mistakes." Unique, demo-able.

**Breadth (8 IDEs) is table stakes now, not a moat.** The honest headline that converts:
> _"Stop hitting the context wall. engram ranks your codebase so your agent sees what matters — and keeps going."_

Lead **capacity + quality**; mistakes-memory is the signature hook. (Sources: Zylos, Sourcegraph,
CodeGraphContext/colbymchenry repos, OpenClaw launch timeline, Claude-Code context-limit writeups.)

## 3. The four tracks (the full goal, decomposed)

| Track | Owns | Binding? |
|---|---|---|
| **P — Product** | Close the agent's tool-call bypasses (the "loop") + harden the three moats | hygiene — completes the auto-intercept moat |
| **M — Proof** | Honest, **user-runnable** measurement (on *their* repo, not ours) | trust |
| **D — Distribution** | The 30-sec demo, the differentiation messaging, the coordinated launch, marketplace presence | **THE binding constraint on winning** |
| **E — Audit** | Procurement-grade cost attestation via `engram-counter` (public OSS) | broader product planning tracked separately, outside this repo |

**Strategic correction from §2:** historically we've spent in Track P. Research says Track P is necessary
but *not* what wins. After the loop is closed enough to make the demo impressive (Bash-grep — Track P
item A — is done, which is what makes the shell-grep IDEs demo-able), **the highest-leverage next move is
Track D's before/after demo.** Don't let interception polish crowd out distribution.

## 4. Task lists

### Track P — Product (close the loop + moats)
| # | Task | Status | Note |
|---|---|---|---|
| A (#71) | Bash-grep interception | **done, audited** (commit pending) | reuses `handleGrep` + all gates; ADR-0005; 51/51 bash tests; adversarial SHIP |
| B (#72) | Bash exploration intercept (`ls`/`find`/`tree`/Glob) | next (P) | directory floods → graph file-tree, gated |
| C (#73) | Cumulative session measurement (replay/live) | blocked by B | feeds Track M |
| D (#74) | Release **v4.3** (Bash bundle) | blocked by B | Nick 2FA |
| E (#75) | git-bugfix-miner hardening | backlog | non-blocking |
| F (#76) | Workload router | **PARKED** | N=3 evidence too weak; gates already route |

### Track M — Proof (honest + user-runnable)
| # | Task | Status | Note |
|---|---|---|---|
| #81 | `engram bench` on the USER's own repo — one command shows the structural reduction on *their* code | new | the "measure it on YOUR repo" moment; doubles as proof + the demo's data |

### Track D — Distribution (the adoption engine — ELEVATED)
| # | Task | Status | Note |
|---|---|---|---|
| #77 | **30-sec before/after demo** (asciinema/GIF): same large repo, same prompt — without engram the agent fans out 40+ Read/Grep calls and stalls; with engram, 3 ranked calls, session continues | **next after A commit** | #1 lever; lowest cost, highest leverage; doubles as proof |
| #78 | Differentiation messaging vs CodeGraphContext/codegraph — README comparison: "they build a graph you must query; engram *ranks* it and answers automatically at the hook" + mistakes-memory | new | own "ranked + auto + memory", don't price-fight |
| #79 | Coordinated launch — Show HN + Product Hunt + r/ClaudeAI + r/cursor, npx one-liner CTA | new (Nick) | OpenClaw playbook |
| #80 | Marketplace/registry presence across the 8 IDE ecosystems (MCP directories, Cursor/Cline plugin lists) | new | distribution > features; where evaluators browse |

### Track E — Audit (`engram-counter`, public OSS)
| # | Task | Status | Note |
|---|---|---|---|
| #65 | LEAK-P2 — purge advisory docs from OLD `engram-counter` history + GATED force-push | pending (Nick) | drafted; awaiting authorization |

_(Broader product/business planning beyond the public OSS surface is tracked separately, outside this repo.)_

## 5. Operating rhythm (every Product/Proof task)

```
Phase-0 measure → ADR → build (gated + recall-safe + opt-out)
  → triple-audit (tsc + full suite + e2e from the built CLI)
  → adversarial review (has caught a real issue on EVERY feature this arc)
  → leak-audit (before any engram-* push/publish)
  → ship + CI-green
```
Update `STATE.md` + the memory anchor after each. Never claim done without the verification output.

## 6. The honest gates (what we never do)

- **No cost claim.** Ever. Structural reduction / capacity / quality only (§1).
- **Leak-audit before any public push/publish** (`/engramx-leak-audit`, Categories A–E).
- **No `npm publish` / `git push --force` / `branch -D` without Nick's explicit ask.** Counter publish +
  LEAK-P2 force-push are Nick's hands (2FA / authorization).

## 7. Success criteria (what winning looks like)

- **Adoption:** GitHub stars + npm downloads trending toward the CodeGraphContext tier (~3K★) on the
  honest pitch — i.e. the demo + launch land.
- **Differentiation holds:** a developer can state in one breath why engram ≠ CodeGraphContext (ranked +
  auto-intercept + mistakes).
- **The claim holds:** no honesty regression; every public number is structural-reduction-framed.
- **The demo exists** and is embedded on every public surface (README, install.html, the IDE listings).
- **Proof is user-runnable:** a developer can measure the reduction on *their own* repo in one command.

## 8. The strategic call (surface for Nick)

Finishing the token-loop (B → C → D) is real product hygiene and completes the **auto-interception moat**.
But the research is unambiguous: **the binding constraint on winning is distribution, not more
interception.** Recommended sequence:

1. **Commit Track-P item A** (Bash-grep — done + audited). _← immediate_
2. **Build Track-D #77 (the before/after demo)** next — it is the single highest-leverage asset, it
   doubles as Track-M proof, and if it *isn't* impressive that's the signal to fix the product before
   spending on launch.
3. Then decide B/C/D (finish the loop → v4.3) **vs** push straight to #78–#80 (differentiation + launch),
   informed by what the demo reveals.

Open to Nick's steer on step 3. Steps 1–2 proceed now.
