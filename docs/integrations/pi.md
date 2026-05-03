# PI integration (example)

This project ships a small HTTP server that exposes engram's query, learn,
and context streaming endpoints. To integrate with external tooling (like
`pi`), you can call the server from your agent process to run the same
hook handlers engram uses internally.

Quick example (requires Node 20+ and the engram HTTP server running):

1. Start the engram HTTP server for your project:

   - From a built installation: `engramx serve --port 7337 --project /path/to/project`
   - Or run the server via the CLI: `node dist/cli.js serve --port 7337 --project /path/to/project`

   The server writes an auth token to `~/.engram/http-server.token` on first start.

2. Run the example PI client that demonstrates the flow:

   ```bash
   node examples/pi-client.js /path/to/project
   ```

   The script will:
   - Call `POST /hook` with a `SessionStart` payload (project brief + provider warmup)
   - Call `POST /hook` with a `UserPromptSubmit` payload (pre-query injection)
   - POST a session summary to `/learn` so engram can persist session learnings

3. Production integration suggestions:

   - Call `POST /hook` with `SessionStart` at the beginning of a user session
     to warm provider caches and inject both project and global memory.
   - During request processing, call `POST /hook` for `UserPromptSubmit` and
     `PreToolUse` events (or use `GET /context/stream` and `/query`) to
     resolve context on-demand.
   - When the request completes and you have a session summary, call `POST /learn`
     with the summary text so engram persists the learning in its graph.

Security: all HTTP endpoints require an auth token (read from
`~/.engram/http-server.token` or supplied via `Authorization: Bearer <token>`).
This keeps the server local-only and fail-closed.

If you want, I can add a small PI-side wrapper that calls these endpoints
from the pi harness directly (example: a `pi` skill or integration).