# engram — the honest before/after demo

A 30-second, **reproducible** demo of engram's structural context-token collapse, run against
engram's own repo using the **real shipped handler** (`handleGrep`) — nothing is staged.

```bash
npm run demo            # paced, for watching / recording
DEMO_FAST=1 npm run demo   # no delays (CI / quick check)
```

## What it shows

For a fixed, disclosed set of real symbols, it compares — per search:

- **without engram:** the real `rg` output (every match line floods the context window), and
- **with engram:** the real `handleGrep` ranked call-site packet.

This is exactly the grep-step model the audited `bench/session-level.ts` uses — **rg output only; whole-
file reads are NOT billed to the "before" side**. Four high-fan-out searches that engram intercepts, plus
one (`Node`, 400+ matches) that **passes through** (the floor — engram never makes it worse). On engram's
own repo today: roughly **−78% structural context on the intercepted searches (~4.5× more searching before
the context wall)** — a **ceiling** that assumes the ranked call-sites answer the search (real recall
~22%; the honest P-modelled figure is in `npm run bench`).

## Why it's honest (and how that's the point)

- **Structural, not cost.** Every number is context tokens entering the model, **not** your bill. Prompt
  caching owns the dollar cost; engram's net over caching ≈ 0. The win is **capacity + ranked quality**.
- **The packet is a ranked subset, and the reductions are a ceiling.** engram returns the PageRank-ranked
  call-sites and **always prints the exact `rg -n`** to recover the raw matches. The per-search % assumes
  the ranked call-sites answer the search with no raw follow-up (real recall-coverage here ~22%); the
  honest P-modelled aggregate is `npm run bench`. (The competitors that flash "~35% cheaper" omit this.)
- **Selective by design.** engram intercepts only ~20% of searches on this repo (the high-fan-out ones,
  ≥4 caller files — the ones that actually flood context). The rest pass through unchanged.
- **Illustrative, not the benchmark.** The rigorous, P-modelled aggregate (with recall-coverage and the
  same-epoch caveat) lives in `npm run bench`. This demo makes the value visceral; the bench proves it.

See `docs/adr/0006-honest-before-after-demo.md` for the full rationale.

## Re-recording the cast

The committed reference cast is `docs/demos/before-after.cast` (asciicast v3). Re-record:

```bash
asciinema rec --overwrite --command "npm run demo" docs/demos/before-after.cast
```

Upload to asciinema.org (your account) and embed the SVG poster in the top-level README as the hero asset.

## Determinism

`rg --sort=path` forces a stable file order (ripgrep walks in parallel by default, which would make the
"top caller files" — and the numbers — vary run-to-run). Same repo + same graph → identical output.
