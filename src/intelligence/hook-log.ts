/**
 * Hook event log — append-only JSONL logger for v0.3.0 Sentinel
 * instrumentation.
 *
 * Every hook invocation (pre or post) logs a single line here so that
 * `engram hook-stats` and future v0.3.1 self-tuning can read back a
 * complete history of what the Sentinel did and why.
 *
 * Design contracts:
 *   1. NEVER throws. Logging must never break a hook. Every I/O error
 *      is swallowed. The result is "log entry lost" which is far better
 *      than "hook crashes and tool call fails".
 *   2. APPEND-ONLY. Each entry is one JSON object followed by a newline.
 *      Atomic on POSIX for small writes (<4KB) via appendFileSync — no
 *      explicit locking needed because JSONL lines are always <1KB.
 *   3. SIZE-CAPPED. Rotate at 10MB. Old log moves to .jsonl.1, new log
 *      starts fresh. Only two files kept; older history is dropped.
 *   4. PROJECT-SCOPED. Logs live at `<projectRoot>/.engram/hook-log.jsonl`.
 *      Different projects have different logs; cleanup is per-project.
 *   5. PRIVACY-AWARE. Callers must not put user prompt content in log
 *      entries. The logger itself has no way to enforce this — it's on
 *      the handler to pass only non-sensitive fields.
 */
import {
  appendFileSync,
  existsSync,
  renameSync,
  statSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";

/** Maximum size in bytes before rotation fires. 10 MB. */
export const HOOK_LOG_MAX_BYTES = 10 * 1024 * 1024;

/** Log filename inside `.engram/`. */
const LOG_FILENAME = "hook-log.jsonl";

/** Rotated filename. We keep exactly one rotation; older entries are dropped. */
const LOG_ROTATED_FILENAME = "hook-log.jsonl.1";

/**
 * A single log entry. All fields are optional because different hook
 * events capture different metadata. The two required fields (`ts`,
 * `event`) are added automatically by `logHookEvent`.
 */
export interface HookLogEntry {
  readonly event: string;
  readonly tool?: string;
  readonly path?: string;
  readonly decision?: "allow" | "deny" | "passthrough";
  readonly confidence?: number;
  readonly nodeCount?: number;
  readonly injection?: boolean;
  readonly outputSize?: number;
  readonly success?: boolean;
  readonly error?: string;
  readonly tokensSaved?: number;
  readonly reason?: string;
}

/**
 * Attempted-atomic append to the hook log. Composed of two phases:
 *   1. Rotation check — if the file is already over the size cap,
 *      rename it to .jsonl.1 (overwriting any previous rotation) and
 *      start fresh.
 *   2. Append — write one JSON line.
 *
 * Both phases swallow errors. A failed rotation means the log grows
 * past the cap (which is recoverable). A failed append means the entry
 * is lost (which is acceptable — logging is observability, not state).
 */
export function logHookEvent(
  projectRoot: string,
  entry: HookLogEntry
): void {
  if (!projectRoot) return;
  try {
    const logPath = join(projectRoot, ".engram", LOG_FILENAME);
    rotateIfNeeded(projectRoot);
    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        ...entry,
      }) + "\n";
    appendFileSync(logPath, line);
  } catch {
    // Swallow. Logging must never break the hook.
  }
}

/**
 * If the current log file is at or above the max size, rotate it.
 * Rotation is destructive: any previous .jsonl.1 file is overwritten.
 * Errors are swallowed — a failed rotation means the log grows past
 * the cap (recoverable on the next attempt).
 */
export function rotateIfNeeded(projectRoot: string): void {
  try {
    const logPath = join(projectRoot, ".engram", LOG_FILENAME);
    if (!existsSync(logPath)) return;
    const size = statSync(logPath).size;
    if (size < HOOK_LOG_MAX_BYTES) return;
    const rotatedPath = join(projectRoot, ".engram", LOG_ROTATED_FILENAME);
    renameSync(logPath, rotatedPath);
  } catch {
    // Silent failure on rotation — not critical.
  }
}

/**
 * Read the entire current hook log as an array of parsed entries.
 * Used by `engram hook-stats` (Day 5) to summarize recent activity.
 *
 * Returns [] on any error (missing file, malformed content, etc.).
 * Does NOT include the rotated .jsonl.1 file — callers that want
 * historical data can read both.
 */
export function readHookLog(projectRoot: string): HookLogEntry[] {
  try {
    const logPath = join(projectRoot, ".engram", LOG_FILENAME);
    if (!existsSync(logPath)) return [];
    const raw = readFileSync(logPath, "utf-8");
    const entries: HookLogEntry[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line) as HookLogEntry);
      } catch {
        // Skip malformed line but continue.
      }
    }
    return entries;
  } catch {
    return [];
  }
}
