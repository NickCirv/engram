#!/usr/bin/env bash
set -euo pipefail

PORT=${PORT:-7337}
PROJECT_ROOT="$(pwd)"
PIDFILE="$PROJECT_ROOT/.engram/http-server.pid"

echo "[dev-reload] port=$PORT project=$PROJECT_ROOT"

# Kill anything listening on the target port (127.0.0.1:$PORT)
pids=$(lsof -ti TCP:127.0.0.1:${PORT} -sTCP:LISTEN || true)
if [ -n "$pids" ]; then
  echo "[dev-reload] killing processes listening on 127.0.0.1:${PORT}: $pids"
  echo "$pids" | xargs -r kill -9 || true
fi

# Also remove pidfile if present
if [ -f "$PIDFILE" ]; then
  echo "[dev-reload] found pidfile: $PIDFILE"
  pidfile_pid=$(cat "$PIDFILE" 2>/dev/null || true)
  if [ -n "$pidfile_pid" ]; then
    echo "[dev-reload] killing pid from pidfile: $pidfile_pid"
    kill -9 "$pidfile_pid" 2>/dev/null || true
  fi
  rm -f "$PIDFILE" || true
fi

# Build artifacts
echo "[dev-reload] running npm run build"
npm run build

# Start server via the CLI auto-start entrypoint (ui) so PID/lock semantics are consistent
# Use --no-open to avoid launching a browser from dev script
echo "[dev-reload] starting server via: node dist/cli.js ui --no-open --port ${PORT} -p ${PROJECT_ROOT}"
node dist/cli.js ui --no-open --port "${PORT}" -p "${PROJECT_ROOT}"

echo "[dev-reload] done"
