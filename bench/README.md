# EngramBench v0.1

> A reproducible benchmark for structural code memory. Four setups, ten tasks, one number per cell.

## Why this exists

Every tool in the "AI coding memory" space makes a savings claim. None of them
publish a benchmark you can run yourself. EngramBench is engram's down-payment
on that: a harness, a task set, a scoring rule, and a reference report.

You should not trust engram's "82% token reduction" claim just because engram
says so. You should run this benchmark against your own codebase — or against
the reference project — and see the number for yourself. If it holds, cite it.
If it doesn't, file an issue.

## What it measures

For each benchmark task, we measure **total prompt tokens consumed** to reach
a correct answer, under four setups:

| Setup | Description |
|-------|-------------|
| **baseline** | Bare Claude Code, no memory tool. The agent uses Read/Grep/Glob directly. |
| **cursor-memory** | Simulates Cursor's prose memory approach. (v0.2 will replace this with a live Cursor run.) |
| **anthropic-memorymd** | Uses Anthropic's native MEMORY.md (prose block). |
| **engram** | engram v0.3.1+ with PreToolUse hooks enabled. |

Lower is better. The primary metric is **relative reduction vs. baseline**.
Secondary metrics: Read hit rate, false-injection rate, time-to-answer.

## The tasks

v0.1 ships 10 structural tasks — the kind of question an agent actually asks
before editing code. Each task has a canonical correct answer and a scoring
rubric. See `tasks/` for the full definitions.

1. **task-01-find-caller** — "What calls `validateToken`?" Graph traversal.
2. **task-02-parent-class** — "What does `SessionStore` extend?" Inheritance edge lookup.
3. **task-03-file-for-class** — "Which file defines `AuthService`?" Label → file resolution.
4. **task-04-import-graph** — "What modules import `src/auth.ts`?" Incoming import edges.
5. **task-05-exported-api** — "What does `src/cli.ts` export?" File → export nodes.
6. **task-06-landmine-check** — "Have we fixed a bug in `src/query.ts` recently?" Mistake node lookup.
7. **task-07-architecture-sketch** — "Summarize the architecture of this repo in ≤200 tokens." Top-connected-nodes query.
8. **task-08-refactor-scope** — "If I rename `queryGraph`, what files break?" 2-hop reverse dependency.
9. **task-09-hot-files** — "What files change most often?" Git log integration.
10. **task-10-cross-file-flow** — "Trace the path from `handleRead` to the graph query." Path-finding.

Each task is defined as a YAML file under `tasks/` with:

```yaml
id: task-01-find-caller
description: ...
reference_answer: ...
scoring_rubric: ...
expected_tokens:
  baseline: 4500
  engram: 800
```

## Running the benchmark

```bash
# Reference project: engram itself (self-host)
cd bench
./run.sh --setup engram --task all

# Custom project
./run.sh --project ~/my-repo --setup engram --task task-01-find-caller
```

**STATUS:** v0.1 is scaffolding only. The runner (`run.sh`) is a stub; the
reference answers come from manual Claude Code runs I've done on engram's own
codebase. v0.2 will automate the runner, add a cursor-memory setup, and ship
the first public leaderboard.

## The ground rule

Every number in this benchmark must be **reproducible by a stranger on a
different machine**. If you can't run it and get within 10% of the published
number, it's a bug — file it.

## License

Apache 2.0, same as engram.
