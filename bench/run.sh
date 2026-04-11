#!/usr/bin/env bash
#
# EngramBench v0.1 runner — SCAFFOLD
#
# Usage:
#   ./run.sh --setup <baseline|cursor-memory|anthropic-memorymd|engram> --task <task-id|all>
#   ./run.sh --project <path> --setup engram --task task-01-find-caller
#
# STATUS: v0.1 is a scaffold. This script prints the task prompt and
# expected tokens so you can run it manually against your own agent
# setup, then copy the measured number into results/<setup>.csv.
#
# v0.2 will automate this with direct API calls to Claude Code SDK,
# Cursor's agent mode, and engram's own CLI.
set -euo pipefail

BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASKS_DIR="$BENCH_DIR/tasks"
RESULTS_DIR="$BENCH_DIR/results"
PROJECT="${PROJECT:-$BENCH_DIR/..}"

setup=""
task=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --setup)   setup="$2"; shift 2 ;;
    --task)    task="$2";  shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    *)         echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$setup" || -z "$task" ]]; then
  echo "Usage: ./run.sh --setup <name> --task <id|all>" >&2
  exit 1
fi

case "$setup" in
  baseline|cursor-memory|anthropic-memorymd|engram) ;;
  *) echo "Unknown setup: $setup" >&2; exit 1 ;;
esac

mkdir -p "$RESULTS_DIR"

run_one () {
  local task_file="$1"
  local task_id
  task_id=$(basename "$task_file" .yaml)
  echo "=============================================="
  echo "Task:    $task_id"
  echo "Setup:   $setup"
  echo "Project: $PROJECT"
  echo "=============================================="
  echo ""
  echo "--- Prompt ---"
  sed -n '/^prompt:/,/^[a-z_]*:/p' "$task_file" | sed '1d;$d' | sed 's/^  //'
  echo ""
  echo "--- Expected tokens (for $setup) ---"
  grep "  $setup:" "$task_file" || echo "  (not listed)"
  echo ""
  echo "Run this prompt against the $setup agent setup and record the"
  echo "measured token total in: $RESULTS_DIR/$setup.csv"
  echo ""
}

if [[ "$task" == "all" ]]; then
  for f in "$TASKS_DIR"/task-*.yaml; do
    run_one "$f"
  done
else
  f="$TASKS_DIR/$task.yaml"
  if [[ ! -f "$f" ]]; then
    echo "No such task: $task" >&2
    exit 1
  fi
  run_one "$f"
fi
