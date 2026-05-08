Dev-reload: port wait and startup audit

Summary

This document records the recent changes made to reduce transient EADDRINUSE errors during development reloads and to add a small startup audit line when the HTTP server writes its PID file.

What was changed

1) scripts/dev-reload.sh

- After building the project, the script now waits (best-effort) for the configured PORT to be free before starting the server. This reduces races where nodemon spawns a new process while the old one is still closing and listening on the port.
- Behavior is configurable via environment variables:
  - WAIT_RETRIES (default: 16)
  - SLEEP_INTERVAL (default: 0.5 seconds)
- If the port remains busy after the retry loop the script proceeds anyway (non-blocking fallback) to avoid hanging CI or developer shells.

2) src/server/http.ts

- The writePid(projectRoot) helper still writes .engram/http-server.pid but now also appends an audit line with timestamp, pid, port, and project to two locations:
  - <projectRoot>/.engram/http-server.start.log (project-scoped audit log)
  - ~/.engram/http-server.log (user-level co-log)
- Audit line format: <ISO timestamp> START pid=<pid> port=<port> project=<projectRoot>
- Audit writes are best-effort; failures are swallowed so they don't block server startup.

Why

- Frequent EADDRINUSE errors were observed during rapid dev reloads. These are usually harmless (old process still closing) but they spam stderr and can hide real issues. Waiting briefly for the port to be released reduces noise and stabilizes local dev workflow.
- The PID file used by the HUD / component-status can sometimes be missing during restart windows. The audit log makes it trivial to confirm when the server wrote the PID (and which pid/port it recorded), which aids debugging.

Files modified

- scripts/dev-reload.sh
- src/server/http.ts

How to test locally

1) Force a dev rebuild (touch a source file and allow nodemon/dev watcher to run dev-reload)
2) Watch the script output: you should see lines like:
   [dev-reload] waiting for port 7337 to be free (still: <pids>) — attempt X/Y
   [dev-reload] starting server via: node dist/cli.js ui ...
3) After server starts, verify:
   - cat <projectRoot>/.engram/http-server.pid → should contain the pid
   - tail -n 50 <projectRoot>/.engram/http-server.start.log → last line is the START audit line
   - tail -n 50 ~/.engram/http-server.log → contains the START audit line
4) Exercise the dashboard/UI or POST a SessionStart hook to confirm the updated server responds with the injected project brief.

Environment knobs

- WAIT_RETRIES= number of attempts waiting for port to be free (default 16)
- SLEEP_INTERVAL= seconds to sleep between attempts (default 0.5)

Todo / Follow-ups (issues created)

- [ ] Add a small integration test that verifies the audit line is written on server startup (requires test harness that can spawn the server).
- [ ] Consider making the dev-reload script fail-hard if the port remains busy (configurable via env var) to avoid accidental double-runs in CI.
- [ ] Rotate/trim the audit logs (project-level and user-level) to avoid unbounded disk growth.
- [ ] Improve portability for environments without lsof (Windows) — consider a Node-based port probe helper or use netstat variations.
- [ ] Expose the startup audit via component-status so the UI can show "Last startup at <ts> (pid)".

Link to changes

- Branch: feat/sessionstart-resume-auto-memory
- Commits:
  - dev: wait for port free in dev-reload; http: append startup audit line when writing pid

If you'd like any of the follow-ups implemented now (tests, log rotation, stricter dev-reload behavior), tell me which ones and I'll implement them in follow-up commits/PRs.
