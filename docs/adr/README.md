# Architecture Decision Records (engramx)

Versioned record of architectural decisions. Adopted from mattpocock/skills + project-discipline.md convention.

## When to write an ADR

- A decision that closes a path you cannot easily reopen (schema choice, protocol, public API surface)
- A decision that future-you will ask "why?" about
- A trade-off that took more than one session to resolve
- A reversal of a prior decision (write the new ADR, mark the old as superseded)

## File format

`docs/adr/NNNN-kebab-title.md` — 4-digit zero-padded, sequential.

```markdown
# ADR-NNNN: Title

**Status:** Accepted | Superseded by ADR-XXXX | Deprecated
**Date:** YYYY-MM-DD
**Deciders:** Nicholas, [+ others if any]

## Context
What forced this decision? What are the constraints?

## Decision
The choice. One paragraph.

## Consequences
Positive, negative, neutral. Things downstream code can rely on.

## Alternatives considered
What we did NOT pick and why.

## References
Links to PRs, commits, related ADRs, prior art.
```

## Index

| ADR | Decision | Status |
|----|----------|--------|
| [0001](0001-grep-symbol-intercept.md) | Intercept symbol-search Grep with the reference graph (recall-safe) | Accepted (evolved by 0004) |
| [0002](0002-session-level-bench.md) | Session-level token bench (deterministic trace replay) | Accepted |
| [0003](0003-same-session-read-dedup.md) | Same-session read dedup | Accepted |
| [0004](0004-grep-richer-find-usages.md) | Richer find-usages in the Grep packet (call-site lines) | Accepted |
| [0005](0005-bash-grep-interception.md) | Intercept Bash `rg`/`grep` via the Grep handler | Accepted |
| [0006](0006-honest-before-after-demo.md) | The honest before/after demo | Accepted |
| [0007](0007-grep-never-worse-gate.md) | A measured "never worse" gate for grep interception | Accepted |
| [0008](0008-subagent-context-broker.md) | Sub-agent context broker (the SubagentStart slice) | Accepted |
| [0009](0009-recall-coverage-benchmark.md) | Recall-coverage benchmark (deterministic half of #85) | Accepted |
| [0010](0010-compaction-session-ledger.md) | Compaction session ledger — "previously explored" at PreCompact | Accepted |
| [0011](0011-defer-bash-explore-interception.md) | Defer Bash directory-exploration interception (#72) | Accepted (do not build) |
