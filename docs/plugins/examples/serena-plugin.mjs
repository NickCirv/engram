/**
 * engramx plugin: Serena — LSP-backed semantic code retrieval
 *
 * Serena (https://github.com/oraios/serena) is an open-source MCP server
 * that talks to language servers for 20+ languages and returns precise
 * symbol-level context — far more accurate than regex or tree-sitter
 * alone. This plugin wraps Serena as an engramx Context Spine provider.
 *
 * INSTALL
 *   1. Install Serena if you haven't:
 *      https://github.com/oraios/serena#installation
 *      The quickest path: `pipx install uv` (or uv's own installer),
 *      which gives you `uvx` — the command below then fetches Serena
 *      on-demand at first use.
 *
 *   2. Copy this file to ~/.engram/plugins/serena.mjs:
 *      cp docs/plugins/examples/serena-plugin.mjs ~/.engram/plugins/serena.mjs
 *
 *   3. Verify it loaded:
 *      engram plugin list
 *      (you should see `mcp:serena  SEMANTIC SYMBOLS  (mcp-backed)`)
 *
 * HOW IT WORKS
 *   The `mcpConfig` declaration below tells engramx's plugin loader to
 *   auto-wrap Serena via createMcpProvider(). On every Read, engramx
 *   calls `find_symbol` against Serena with the current file path,
 *   receives back the symbol structure, and merges it into the rich
 *   context packet. If Serena isn't running or the call times out, the
 *   plugin goes dormant for 30 seconds before retry — engramx's built-in
 *   AST miner covers the gap.
 *
 * TUNING
 *   - tools: add more Serena tools to enrich context further. See
 *     `uvx --from git+https://github.com/oraios/serena serena --list-tools`
 *     for the full catalog.
 *   - tokenBudget: Serena can be verbose. 250 tokens per Read is a
 *     reasonable default for symbol-rich files; raise if you find its
 *     output being truncated too aggressively.
 *   - timeoutMs: cold-start for Serena's first request (per-language LSP
 *     boot) is slow — keep ≥2s or you'll get zero results on the first
 *     file of a session.
 */
export default {
  name: "mcp:serena",
  label: "SEMANTIC SYMBOLS",
  version: "0.1.0",
  description: "LSP-backed symbol retrieval via oraios/serena",
  author: "engramx community",
  tokenBudget: 250,
  timeoutMs: 2500,
  mcpConfig: {
    transport: "stdio",
    command: "uvx",
    args: [
      "--from",
      "git+https://github.com/oraios/serena",
      "serena",
      "start-mcp-server",
    ],
    tools: [
      {
        name: "find_symbol",
        args: { name_path: "{fileBasename}" },
        confidence: 0.9,
      },
    ],
  },
};
