# engram — marketplace / registry submission kit (#89)

Ready-to-submit entries for the highest-discovery channels. Every description is
written to the **honest spine** (no cost claims — engram delivers a *structural*
context-token reduction, not a bill saving) and is **leak-clean** (nothing about
pricing, business model, or internal process). All submissions are outward
actions under the owner's own accounts.

---

## 1. awesome-mcp-servers — punkpeye (~70k★, highest discovery)

Fork <https://github.com/punkpeye/awesome-mcp-servers>, add this single line
under the **🛠️ Developer Tools** category (placed alphabetically by `owner/repo`),
then open a PR. Legend: `📇` = TypeScript codebase, `🏠` = local service.

```
- [NickCirv/engram](https://github.com/NickCirv/engram) 📇 🏠 - Ranked local code-graph context for AI coding agents. Intercepts file reads + greps, surfaces call-site context and bi-temporal mistakes mined from git revert history. Apache-2.0, local SQLite, zero cloud.
```

---

## 2. Cline MCP Marketplace

Open an issue with the submission template:
<https://github.com/cline/mcp-marketplace/issues/new?template=mcp-server-submission.yml>

- **GitHub Repo URL:** `https://github.com/NickCirv/engram`
- **Logo:** a 400×400 PNG (owner to provide — the engram mark on the brand
  background).
- **Reason for addition:**
  > engram is a local-first code-graph context layer for AI coding agents. It
  > indexes a repo into a SQLite knowledge graph and serves code structure,
  > call-site context, and git-mined mistakes over MCP — so Cline can answer
  > "where is X used / what changes with Y / what bug did we already fix here"
  > without re-reading whole files. Apache-2.0, runs entirely locally, no API key.
- **Installation testing confirmation:** confirm you have tested giving Cline
  only the repo `README.md` + `llms-install.md` and it set the server up
  successfully. (`llms-install.md` is now in the repo root — it covers the
  global install, `engram init`, and the `mcpServers` config block.)

---

## 3. cursor.directory (P2)

Submit at <https://cursor.directory/> (MCP section) with the same honest
description as the awesome-mcp line above.

---

## 4. Official MCP registry — REPUBLISH (fixes a stale listing)

The official registry (`registry.modelcontextprotocol.io`) still serves the OLD
**v3.0.2** entry, whose description carries the discredited "89.1% saved"
over-claim. `server.json` in the repo is already current (v4.3.1, honest
description ≤100 chars). Republish to replace it:

```bash
cd ~/engram
mcp-publisher login github   # token expires; re-login if needed
mcp-publisher publish
```

This is the single highest-value registry fix — it removes the last live cost
over-claim on an official surface.

---

## Honesty guardrail (applies to every listing)

Do **not** let any description say engram "saves X% cost", "saves $N", or
"cuts your bill". engram delivers a **structural context-token reduction** that
varies by repo; the dollar cost is dominated by prompt caching (engram's net
over caching ≈ 0). Keep every description to what engram **does**, never a cost
number. This is the same discipline applied across the README, bench, dashboard,
cost digest, and the VS Code listing.
