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

(Retrofit existing decisions here as you have time. Don't block on backfill — new decisions land in `docs/adr/` from this point forward.)

Suggested retrofits when convenient:
- 0001 — Bi-temporal mistakes (schema v9)
- 0002 — Universal Spine architecture (v3.4)
- 0003 — Mesh: ed25519 + JCS + append-only audit
- 0004 — MCP plugin contract (no custom protocol)
- 0005 — Auto-install hook default-on
