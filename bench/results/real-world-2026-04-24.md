# EngramBench Real-World — 2026-04-24

**Project:** `/Users/nicholas/engram`
**Files sampled:** 87

## Aggregate

| Metric | Value |
|---|---|
| Baseline tokens (all files, raw Read) | **163,122** |
| engramx tokens (rich packets) | **17,722** |
| Aggregate savings | **89.1%** |
| Median per-file savings | 84.2% |
| Files where engramx saved tokens | 85 of 87 |

## Top 10 savings

| File | Baseline | Engram | Savings | Providers |
|------|---------:|-------:|--------:|----------:|
| `src/cli.ts` | 18820 | 306 | 98.4% | 2 |
| `src/server/ui.ts` | 5282 | 94 | 98.2% | 2 |
| `src/server/ui-components.ts` | 2489 | 64 | 97.4% | 2 |
| `src/server/ui-graph.ts` | 1622 | 64 | 96.1% | 2 |
| `src/server/http.ts` | 6819 | 307 | 95.5% | 2 |
| `src/graph/query.ts` | 5359 | 317 | 94.1% | 2 |
| `src/core.ts` | 5246 | 317 | 94.0% | 2 |
| `src/graph/store.ts` | 4903 | 315 | 93.6% | 2 |
| `src/miners/ast-miner.ts` | 4643 | 319 | 93.1% | 2 |
| `src/providers/resolver.ts` | 4575 | 322 | 93.0% | 2 |

## Reproduce

```bash
cd .
engram init   # if not already initialized
npx tsx bench/real-world.ts --files 100
```