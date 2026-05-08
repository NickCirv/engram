#!/usr/bin/env bash
set -euo pipefail

PORT=${PORT:-7337}
PROJECT_ROOT="$(pwd)"
PIDFILE="$PROJECT_ROOT/.engram/http-server.pid"

echo "[dev-reload] port=$PORT project=$PROJECT_ROOT"

# Kill anything listening on the target port. Try a portable lsof invocation.
# Some lsof builds dislike the 127.0.0.1:PORT form — try a couple of variants.
pids=$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null || true)
if [ -z "$pids" ]; then
  pids=$(lsof -ti "TCP:${PORT}" -sTCP:LISTEN 2>/dev/null || true)
fi
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

# Wait for the target port to be free before starting the server. This
# avoids a race where nodemon spawns a new process while the old one is
# still closing, producing EADDRINUSE errors. We retry a few times with
# short sleeps and proceed even if the port remains busy (best-effort).
WAIT_RETRIES=${WAIT_RETRIES:-16}
SLEEP_INTERVAL=${SLEEP_INTERVAL:-0.5}
for i in $(seq 1 "$WAIT_RETRIES"); do
  pids=$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null || true)
  if [ -z "$pids" ]; then
    echo "[dev-reload] port ${PORT} is free"
    break
  fi
  echo "[dev-reload] waiting for port ${PORT} to be free (still: $pids) — attempt $i/$WAIT_RETRIES"
  sleep "$SLEEP_INTERVAL"
done

# Start server via the CLI auto-start entrypoint (ui) so PID/lock semantics are consistent
# Use --no-open to avoid launching a browser from dev script
echo "[dev-reload] starting server via: node dist/cli.js ui --no-open --port ${PORT} -p ${PROJECT_ROOT}"
node dist/cli.js ui --no-open --port "${PORT}" -p "${PROJECT_ROOT}"

echo "[dev-reload] done"
