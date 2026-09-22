# Engram benchmark harnesses

The repository contains several evaluation paths. Their outputs must be interpreted according to what the code actually measures.

| Script | Purpose and evidence boundary |
| --- | --- |
| `npm run bench` | `bench/runner.ts` reads fixture `expected_tokens` and simulates comparisons; it does not run four live agents |
| `npm run bench:recall` | Runs the declared recall-coverage harness |
| `npm run stress` | Runs the declared stress-test harness |
| `npm run demo` | Runs the separate rg/interception demonstration |

The main runner parses a restricted YAML fixture shape, derives baseline and Engram token figures from the fixtures, and writes a dated JSON report. A simulated savings percentage is not a measured reduction in customer bills or an accuracy result. Historical result files remain historical artifacts.

## Reproduce responsibly

Read the selected harness, fixture set, and output paths first. Record the repository commit, runtime, graph state, task inputs, and whether any values are simulated. Execute in a disposable checkout because harnesses can write reports or local graph state. No harness was run for this documentation review.

For a live comparison, collect paired tasks with equivalent inputs and tools, retain provider usage records, score task correctness independently, and report failures as well as successes. Do not compare fixture estimates with live invoice totals.

## Evidence and verification

This guide describes the pinned source below. Commands and client integrations were inspected, not executed; external client compatibility remains unverified.

- [package.json](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/package.json)
- [bench/runner.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/bench/runner.ts)
- [bench/recall-coverage.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/bench/recall-coverage.ts)
- [bench/stress-test.ts](https://github.com/NickCirv/engram/blob/9fa2a4b74ca8e66560d74d1255c16c43157d32bd/bench/stress-test.ts)
