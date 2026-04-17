# Neovim Integration

engram works with Neovim AI plugins that support the Model Context Protocol
(MCP). The two most common — **avante.nvim** and **codecompanion.nvim** —
both let you register engram's MCP server as an additional context source.

No special Neovim plugin is required from engram — we just register as an
MCP server that your existing AI plugin already knows how to speak to.

## Prerequisites

```bash
# Install engram (if you haven't already)
npm install -g engramx

# Index your project
cd ~/your-project
engram init .
```

## Option A — codecompanion.nvim (recommended)

[codecompanion.nvim](https://github.com/olimorris/codecompanion.nvim) has
first-class MCP support via `mcphub.nvim`.

**1. Install mcphub**

```lua
-- lazy.nvim
{
  "ravitemer/mcphub.nvim",
  dependencies = { "nvim-lua/plenary.nvim" },
  build = "npm install -g mcp-hub@latest",
}
```

**2. Register engram as an MCP server**

Add to your mcphub config (`~/.config/mcphub/servers.json`):

```json
{
  "mcpServers": {
    "engram": {
      "command": "engram-serve",
      "args": []
    }
  }
}
```

**3. Enable in codecompanion**

```lua
require("codecompanion").setup({
  extensions = {
    mcphub = {
      callback = "mcphub.extensions.codecompanion",
      opts = { make_vars = true, make_slash_commands = true },
    },
  },
})
```

**4. Use it**

```vim
:CodeCompanionChat
```

Then ask *"What are the core entities in this project?"* — the assistant
will call engram's `god_nodes` tool and ground its answer in your graph.

## Option B — avante.nvim

[avante.nvim](https://github.com/yetone/avante.nvim) supports MCP via
[avante-mcp](https://github.com/ravitemer/mcphub.nvim) (same underlying
plugin). The config is identical to codecompanion — just swap the
consumer:

```lua
require("avante").setup({
  -- ...your existing config...
  system_prompt = function()
    local hub = require("mcphub").get_hub_instance()
    return hub:get_active_servers_prompt()
  end,
})
```

## Available MCP tools

Once registered, your AI plugin will see these engram tools:

| Tool | Purpose |
|------|---------|
| `query_graph` | Natural-language structural query |
| `god_nodes` | Most-connected entities in the codebase |
| `graph_stats` | Node/edge counts, confidence distribution |
| `shortest_path` | Find the call path between two symbols |
| `benchmark` | Measure token savings vs raw file reads |
| `list_mistakes` | Known failure patterns mined from git history |

## Keeping the graph fresh

engram doesn't watch your filesystem by default when running as an MCP
server. Re-index on demand:

```bash
engram init . --incremental   # fast: only re-extract changed files
```

Or run the file watcher in a separate terminal so every save re-indexes:

```bash
engram watch -p .
```

## Troubleshooting

**MCP tools don't appear in codecompanion's slash menu**

Run `:checkhealth mcphub` inside Neovim. If engram isn't listed, verify
`engram-serve --help` runs successfully from the same shell as Neovim.
PATH issues are the most common cause on macOS with GUI launchers.

**Queries return empty results**

```bash
engram stats -p .
```

If `nodes: 0`, run `engram init .` to build the graph.
