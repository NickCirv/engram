/**
 * v4.0 Mesh — append-only audit log.
 *
 * Every mesh send, receive, reject, and trust event is recorded as a JSONL
 * line at ~/.engram/mesh/audit.jsonl. Append-only, size-capped, never
 * throws.
 *
 * Shape mirrors `intelligence/hook-log.ts` — same atomicity contract, same
 * rotation policy, same swallow-on-error discipline. If logging fails, the
 * mesh keeps working.
 */
import { appendFileSync, existsSync, renameSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { meshDir } from "./identity.js";
import type { AuditEntry } from "./types.js";

/** Maximum size in bytes before rotation fires. 10 MB. */
export const MESH_AUDIT_MAX_BYTES = 10 * 1024 * 1024;

const LOG_FILENAME = "audit.jsonl";
const LOG_ROTATED_FILENAME = "audit.jsonl.1";

/**
 * Append one entry to the audit log. Adds `ts` automatically if not set.
 * Never throws — failures are silently swallowed.
 */
export function logAudit(entry: AuditEntry, dir: string = meshDir()): void {
  try {
    const logPath = join(dir, LOG_FILENAME);
    rotateIfNeeded(dir);
    const withTs = entry.ts ? entry : { ...entry, ts: new Date().toISOString() };
    appendFileSync(logPath, JSON.stringify(withTs) + "\n");
  } catch {
    // Logging must never break the mesh.
  }
}

/** Rotate the audit log if it has crossed the size cap. Destructive on .1. */
export function rotateIfNeeded(dir: string = meshDir()): void {
  try {
    const logPath = join(dir, LOG_FILENAME);
    if (!existsSync(logPath)) return;
    const size = statSync(logPath).size;
    if (size < MESH_AUDIT_MAX_BYTES) return;
    const rotatedPath = join(dir, LOG_ROTATED_FILENAME);
    renameSync(logPath, rotatedPath);
  } catch {
    // Silent failure on rotation — recoverable on the next attempt.
  }
}

/**
 * Read the current audit log as parsed entries. Skips malformed lines.
 * Does NOT include the rotated `.1` file — callers that want history can
 * read both.
 */
export function readAudit(dir: string = meshDir()): AuditEntry[] {
  try {
    const logPath = join(dir, LOG_FILENAME);
    if (!existsSync(logPath)) return [];
    const raw = readFileSync(logPath, "utf8");
    const entries: AuditEntry[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line) as AuditEntry);
      } catch {
        // Skip malformed.
      }
    }
    return entries;
  } catch {
    return [];
  }
}
