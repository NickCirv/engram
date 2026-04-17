# engram v2.0 Roadmap — "Ecosystem"

> Post-v1.0 strategy for market dominance. Informed by competitive analysis of
> Continue.dev, Cursor, Mem0, Aider, Zed, Cody, Copilot, Supermaven, and CCS.

## Strategic Position After v1.0

**What we proved:** Hook-based context interception saves 88.1% of session tokens.
8 providers, 5 IDE integrations, ECP spec published.

**Our moat:** Claude Code hook interception + Context Spine + PreCompact survival.
No competitor has all three. @199-bio/engram is MCP-only (no hooks). Aider has
repo maps but no memory. Mem0 has memory but no codebase awareness.

**What's missing for market dominance:**

1. Real tree-sitter precision (grammar WASMs not bundled yet — graceful fallback only)
2. Live LSP integration (currently best-effort stubs)
3. Community adoption signals (GitHub stars, npm downloads, blog posts)
4. ECP adoption by other tools (Continue, Zed, Aider)
5. Enterprise features (team memory, cloud sync, admin dashboards)

---

## Phase 1: Precision (v1.1-v1.3, ~4 weeks)

### 1.1 Tree-sitter Grammar Bundling
- Bundle WASM grammar files for top 10 languages in the npm package
- CI test: parse TypeScript, Python, Go fixtures → verify symbol extraction
- Result: `engram:ast` actually fires (currently graceful-null without bundled grammars)
- HUD: AST ✓ becomes meaningful (parser loads, not just dep installed)

### 1.2 Live LSP Integration
- Replace stub `hover()` and `getDiagnostics()` with real JSON-RPC calls
- Auto-detect IDE's LSP socket (VS Code exposes at known paths)
- Capture real type errors on Edit → mistake nodes with line-precise locations
- Result: HUD shows LSP ✓ when connected to running tsserver

### 1.3 Consolidation Engine
- Inspired by Mem0's approach: raw memories → LLM-compressed summaries
- `engram consolidate` — batch-process accumulated nodes into higher-level insights
- Example: 50 function nodes in `src/auth/` → 1 pattern node "JWT auth middleware with refresh token rotation"
- Zero-cost mode: only runs when explicitly triggered (no background LLM calls)
- Paid mode: optional API key for auto-consolidation on `engram watch`

### 1.4 Benchmark Harness v0.3
- Run real Claude Code sessions (not fixture replay) via Claude API
- Measure actual session tokens consumed with/without engram
- Publish reproducible benchmark that anyone can run: `engram bench --live`
- Target: verified 85%+ savings on real multi-file editing sessions

---

## Phase 2: Distribution (v1.4-v1.6, ~4 weeks)

### 1.4 Publish engramx-continue to npm
- Currently in `adapters/continue/` — needs separate npm publish
- Add to Continue's community provider directory
- Write a blog post: "How engram saves 88% of Claude Code's token budget"

### 1.5 Cursor Extension
- Beyond MDC generation: build a Cursor extension that auto-refreshes
- Register in Cursor's extension marketplace
- `engram gen-mdc --watch` already works, but native integration is better

### 1.6 ECP Adoption Campaign
- Submit ECP spec to Aider, Continue, Zed as integration proposals
- Open issues/PRs on their repos with ECP adapter implementations
- Goal: at least 1 external tool implements ECP by v2.0
- Position: "If your tool reads files, ECP makes it smarter"

### 1.7 Aider Native Integration
- PR to Aider repo: use engram's graph to improve repo map relevance
- Aider's PageRank on dependency graph + engram's persistent memory = better context
- If accepted: engram becomes Aider's memory layer

---

## Phase 3: Intelligence (v1.7-v1.9, ~4 weeks)

### 1.7 Semantic Search Provider
- Add vector embeddings via local model (nomic-embed-text via Ollama)
- New provider: `engram:semantic` — finds conceptually similar code, not just structural matches
- Complements graph queries with "files that FEEL related" to the current edit
- Zero-cloud: embeddings computed locally, stored in SQLite

### 1.8 Auto-Learning from Sessions
- Parse Claude Code conversation history (if available) to extract decisions
- `PostToolUse:Edit` already logs edits — mine patterns from what gets edited together
- "Files A and B are always edited together" → `co-edited` edge in the graph
- "User corrected approach X to approach Y" → decision node

### 1.9 Cross-Project Intelligence
- Share patterns across projects (global graph, project-scoped queries)
- "This error pattern in auth.ts — I've seen this in 3 other projects"
- Opt-in: `engram learn --global "Always use httpOnly cookies for session tokens"`
- Query: `engram query --global "session token best practices"`

---

## Phase 4: Platform (v2.0, ~4 weeks)

### 2.0 engram Cloud (Optional)
- Self-hosted server: `engram server --cloud` for team memory
- Team members share decisions, patterns, and mistake memories
- Admin dashboard: see which patterns save the most tokens across the team
- Pricing: free for OSS, paid for teams (SaaS revenue stream)
- Privacy: code never leaves the server — only patterns, decisions, node labels

### 2.1 VS Code Extension
- Real-time graph visualization in the sidebar
- Click a node → navigate to file
- "Memory panel" showing active decisions, recent mistakes, hot files
- Integrates with Continue.dev's @engram provider

### 2.2 GitHub App
- Auto-index on push: PR opens → engram analyzes diff → comments with context
- "This PR modifies 3 functions that have known mistakes flagged"
- "This file was edited 15 times in the last month — it's a hot spot"
- Revenue: GitHub Marketplace listing

---

## Revenue Opportunities

| Opportunity | Model | Timeline |
|-------------|-------|----------|
| engram Cloud (team memory) | SaaS $19/seat/mo | v2.0 |
| VS Code Extension (premium features) | Freemium | v2.1 |
| GitHub App (PR analysis) | Usage-based | v2.2 |
| Consolidation Engine (LLM-powered) | API key required | v1.3 |
| Enterprise support | Annual contracts | v2.0+ |

## Key Metrics to Track

- npm weekly downloads (currently ~50, target 1K by v1.5, 10K by v2.0)
- GitHub stars (target 500 by v1.5, 2K by v2.0)
- HN frontpage (with benchmark numbers — ready to post)
- External ECP implementations (target 1 by v2.0)
- Community PRs (target 10 by v2.0)

## Immediate Next Actions (This Week)

1. **HN launch** — post with benchmark numbers, link to ECP spec
2. **Reddit posts** — update existing threads with v1.0 announcement
3. **Context7 integration issue** — update with v1.0 provider details
4. **Continue.dev PR** — submit engramx-continue as community provider
5. **Blog post** — "How We Built a Context Spine That Saves 88% of AI Coding Tokens"
6. **Deploy engram v1.0 on all 3 machines** (laptop, CT 300, CT 100)
