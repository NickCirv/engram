# EngramBench Real-World — 2026-04-24

**Project:** `/Users/nicholas/engram`
**Files sampled:** 30

## Aggregate

| Metric | Value |
|---|---|
| Baseline tokens (all files, raw Read) | **67,435** |
| engramx tokens (rich packets) | **6,185** |
| Aggregate savings | **90.8%** |
| Median per-file savings | 85.5% |
| Files where engramx saved tokens | 29 of 30 |

## Top 10 savings

| File | Baseline | Engram | Savings | Providers |
|------|---------:|-------:|--------:|----------:|
| `src/cli.ts` | 18820 | 306 | 98.4% | 2 |
| `src/graph/query.ts` | 5359 | 317 | 94.1% | 2 |
| `src/core.ts` | 5246 | 317 | 94.0% | 2 |
| `src/graph/store.ts` | 4903 | 315 | 93.6% | 2 |
| `src/autogen.ts` | 3660 | 308 | 91.6% | 2 |
| `src/intercept/context.ts` | 3610 | 338 | 90.6% | 2 |
| `src/intelligence/cache.ts` | 3332 | 315 | 90.5% | 2 |
| `src/db/migrate.ts` | 2733 | 263 | 90.4% | 2 |
| `docs/plugins/examples/serena-plugin.mjs` | 620 | 60 | 90.3% | 1 |
| `src/intercept/cursor-adapter.ts` | 1559 | 180 | 88.5% | 2 |

## Reproduce

```bash
cd .
engram init   # if not already initialized
npx tsx bench/real-world.ts --files 30
```