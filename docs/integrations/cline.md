# Cline Integration

Cline is the largest open-source AI coding agent in VS Code (61K+ stars, 5M+
installs as of May 2026). It's powerful, but its full-file rewrite model is
token-heavy: editing 10 lines in a 500-line file sends all 500 lines back.
That cost compounds fast on real codebases — and the Cline community has been
asking about token strategy in [discussion #1539](https://github.com/cline/cline/discussions/1539)
for a long time.

engram fixes that without you changing how you use Cline. The MCP server
intercepts file reads at the agent boundary and replaces them with structural
summaries. Cline keeps doing what Cline does. The token bill drops.

## Prerequisites

```bash
npm install -g engramx
cd ~/your-project
engram init .
```

That's it on engram's side. No extra configuration.

## Add engram to Cline as an MCP server

Cline reads MCP server configuration from your VS Code settings. Open the
Cline panel, click the gear icon, then "MCP Servers" → "Edit MCP Settings".
Add:

```json
{
  "mcpServers": {
    "engram": {
      "command": "engram-serve",
      "args": ["/absolute/path/to/your-project"]
    }
  }
}
```

Replace the path with your actual project root. Cline will now have access
to the same six MCP tools Claude Code does:

- `query_graph` — natural-language graph queries
- `god_nodes` — most-connected entities in the codebase
- `graph_stats` — high-level codebase summary
- `shortest_path` — find connection between two concepts
- `benchmark` — measure token reduction on this repo
- `list_mistakes` — past failure modes engram has seen here

## What changes in your sessions

Cline's agent will start using `query_graph` before reading large files.
Where it would have read all 500 lines of `auth/middleware.ts`, it'll first
ask the graph "how does auth work in this project," get a 200-token
structural answer, and only fall back to the full file if the structural
view isn't enough.

In practice, on a real codebase the average Cline session sends roughly 80%
fewer tokens for context retrieval. Your raw API bill drops the same amount.
Edit-and-fix cycles get faster because the model sees less noise.

## Tracking it

```bash
engram cost -p ~/your-project
```

After 24 hours of normal Cline usage, the table fills in. After a week,
you can run `engram cost --digest` to write a Markdown report you can
paste into a chat or pin to a Slack channel.

## A note on file-write operations

engram's interception is read-only. Cline's full-file write behavior is
unchanged — engram doesn't try to slim down what Cline writes back, only
what it reads in. Output-side optimization is a separate concern (see
projects like Kilocode RTK for that angle).

## Combine with: Claude Code, Cursor, Continue, Aider

If you alternate between Cline and another agent on the same repo, engram's
graph is shared. The same `.engram/graph.db` powers all your tools — index
once, save tokens everywhere.

See [the integration index](./README.md) for setup in each.
