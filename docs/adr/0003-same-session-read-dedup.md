# ADR-0003: Same-session read dedup

**Status:** Accepted · **Date:** 2026-06-03 · **Author:** Nicholas

## Context

Phase-0 measurement over 2,983 real Read interceptions (16 hook-logs) found **38–46% are
same-session repeat reads** of a file already read earlier — 38.3% even at the strictest 10-minute
session boundary. Of those repeats, **~88% are `passthrough` full-file re-reads** (the agent re-reads
the raw file at full token cost), only ~12% are re-served packets. So a large, real slice of the read
budget is spent re-reading files whose content the agent already has in context.

## Decision

Within a session, the Read handler records every full read in
`<projectRoot>/.engram/served-reads-<session_id>.json` (relative paths). On a subsequent Read of the
**same, byte-unchanged** file (mtime+size match), it returns a small pointer ("you already read this
unchanged file earlier; it's in your context above") instead of re-serving the packet or letting the
raw re-read through. `ENGRAM_READ_DEDUP=0` opts out.

It dedups **both** re-served-packet repeats *and* passthrough (raw) repeats — excluding passthrough
would forfeit ~88% of the opportunity. Three guards make the assertive passthrough case sound:

1. **Unchanged only** — mtime+size must match what was recorded; a changed file re-serves (the agent
   rightly wants new content). mtime+size is the same cheap proxy engram's incremental indexer uses.
2. **Full reads only** — the dedup check sits *after* the offset/limit passthrough gate, so a partial
   read (the agent wanting specific lines) is never deduped.
3. **Compaction reset** — the PreCompact hook deletes the session's served-set, so after context
   compaction every read re-serves. An agent re-reads a file *because* compaction evicted it, and
   dedup must never answer "you already have this" when the agent provably doesn't.
4. **SessionStart reset** (added after adversarial review) — PreCompact is *not* the only way context
   empties: `/clear` and session-resume reuse/retain a `session_id` while emptying the window, with no
   PreCompact event. So a fresh / cleared / compacted SessionStart also clears the served-set. (A
   `resume` SessionStart does not — its conversation context is restored, so its set stays valid.)
   This closes the highest-severity hole the review found.
5. **TTL + cap** (added after adversarial review) — a 30-minute per-entry TTL and a 256-entry cap bound
   the blast radius of any *unsignalled* eviction (silent overflow, micro-compaction): only recent,
   most-recently-read files are dedup-eligible. Expiry/eviction causes a re-serve — the safe direction.

A **400-byte (~100-token) floor** skips tiny files where the dedup pointer saves little and the
"scroll up" friction isn't worth it.

## The trade-off

The risk is recall: telling an agent "you already have this" when it doesn't, blinding it. The three
guards bound it — content is byte-identical AND still in the (un-compacted) context window AND it was a
full read. The residual case is an agent re-reading within a non-compacted window because attention
faded; there the content *is* still in context, so the pointer redirects rather than blinds — mild
friction, not data loss, and the opt-out covers it. The discarded alternative — dedup only the safe
deny-repeats — is provably too small to matter (12% of repeats). The other discarded alternative —
content hashing instead of mtime+size — costs a read+hash on every Read for a vanishingly rare failure
(same-size edit within mtime resolution) whose blast radius is "a structural summary is one line stale."
