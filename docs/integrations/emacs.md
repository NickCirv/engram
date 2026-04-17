# Emacs Integration

engram works with Emacs AI packages that support MCP. The most common —
**gptel** via the `gptel-mcp` extension — can register engram as an
additional tool source.

## Prerequisites

```bash
npm install -g engramx
cd ~/your-project
engram init .
```

## Setup — gptel + gptel-mcp

**1. Install packages**

```elisp
;; straight.el
(use-package gptel)
(use-package gptel-mcp
  :straight (gptel-mcp :type git :host github :repo "lizqwerscott/gptel-mcp.el"))
```

For `use-package` with `:ensure t`, both packages are on MELPA.

**2. Configure the MCP server**

Add to your `~/.emacs.d/init.el` (or `init.el` of your choice):

```elisp
(setq gptel-mcp-servers
      '(("engram"
         :command "engram-serve"
         :args ())))
```

**3. Start the engram MCP server inside Emacs**

```elisp
M-x gptel-mcp-start-server RET engram RET
```

Or start all configured servers on Emacs startup:

```elisp
(add-hook 'after-init-hook #'gptel-mcp-start-all-servers)
```

**4. Use it**

Open a gptel buffer (`M-x gptel`) and ask a structural question:

> "Use the engram tools to show me the god nodes in this project."

gptel will route the tool calls through the MCP connection and surface
the results inline.

## Alternative — ellama

[ellama](https://github.com/s-kostyaev/ellama) is a local-first LLM
client for Emacs that also supports tool use. MCP support is less
built-in than gptel-mcp's, so the preferred path is:

1. Run engram's HTTP server: `engram server --port 7337`
2. Use `ellama-make-tool` to register `http://127.0.0.1:7337/query` as
   a tool the LLM can call.

See the ellama README for `ellama-make-tool` examples.

## Available MCP tools

| Tool | What it returns |
|------|-----------------|
| `query_graph` | Natural-language graph query → structural summary |
| `god_nodes` | Top-connected entities (core architecture) |
| `graph_stats` | Node count, edge count, confidence distribution |
| `shortest_path` | Call path between two symbols |
| `benchmark` | Measured token savings vs raw file reads |
| `list_mistakes` | Known landmines mined from git history |

## Keeping the graph fresh

engram's MCP server reads from `.engram/graph.db`. Re-index after big
changes:

```bash
engram init . --incremental
```

Or run the watcher in a shell buffer:

```elisp
M-x shell RET
cd ~/your-project
engram watch -p .
```

## Tips

**Set project root via directory-local variables**

In a `.dir-locals.el` at your project root:

```elisp
((nil . ((gptel-mcp-server-env . (("ENGRAM_PROJECT" . "~/your-project"))))))
```

This way, gptel picks up the right project even when buffers are in
subdirectories.

**Combine with a static context file**

Generate `.aider-context.md` (or a markdown snippet of your own) and
include it in your default gptel system prompt. Gives the LLM a cheap
overview without spending tokens on a tool call every turn:

```bash
engram gen-aider -p .
```

```elisp
(setq gptel-directives
      '((default . "You are an assistant. Project context:\n\n"
         . (lambda () (with-temp-buffer
                        (insert-file-contents ".aider-context.md")
                        (buffer-string))))))
```
