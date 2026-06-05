## v4.3.0 "Proof" — the saving made provable

engram's value is now real *and* something you can verify yourself.

### Prove it on your own repo
- **`engram measure`** — the honest structural context-token reduction on YOUR code, every disclosure computed live (it's a ceiling; here's the recall; here's the intercept rate; structural tokens, **not your bill**).
- **`npm run bench:recall`** — reproducible proof that engram surfaces the files a change actually touches. recall@10 33% on engram's own repo, decomposed honestly: candidate generation reaches 43%, the PageRank ranker adds +3.2pp over random-within-candidate (10.4% blind chance).

### New
- **Never-worse gate on Grep** — engram passes through whenever its call-site packet isn't actually smaller, sized to your grep's exact `cwd`/`path`/`glob` scope.
- **Bash-grep interception** — the shell-only IDEs (Aider, Codex CLI, Cline) now get the call-site packet too.
- **Sub-agent context broker** — a tight ~100-token ranked slice into each spawned Claude Code sub-agent (the one regime prompt caching can't help). *(engram emits the slice correctly; live in-agent delivery pending a real-session smoke test.)*
- **Compaction ledger** — a "previously read" list injected at `/compact` so the agent doesn't re-explore.
- **Honest before/after demo** — `npm run demo`.

### The honesty discipline
Every number is a measured fact or a labelled bet — **no cost claims**; a *structural* context reduction, not a bill saving (engram's net over prompt caching ≈ 0). We also documented the honest decision *not* to intercept directory listings (ADR-0011): engram's graph is a code-symbol graph, not a file index. Decisions in `docs/adr/0005–0011`; comparison vs the other local code-graph tools in `docs/COMPARISON.md` (ranking isn't unique — the *combination* is: ranked + hook-auto-injected + mistakes-memory + honestly measured).

Apache-2.0 · local SQLite · zero cloud · 1128 tests · `npm i -g engramx`
