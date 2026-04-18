/**
 * Hook stats — pure summary functions over HookLogEntry[].
 *
 * Given the raw log data from `.engram/hook-log.jsonl`, produce
 * aggregated statistics suitable for the `engram hook-stats` CLI
 * command. All functions are pure over the input array and never do
 * any I/O.
 */
import type { HookLogEntry } from "../intelligence/hook-log.js";
import { formatThousands } from "../graph/render-utils.js";

/**
 * Averaged token estimate per intercepted Read. This is the difference
 * between a typical file Read (~1500 tokens) and the structural summary
 * engram replaces it with (~300 tokens). Updated in v0.3.1 based on
 * real hook-log data once measurements are available.
 */
export const ESTIMATED_TOKENS_PER_READ_DENY = 1200;

/**
 * Fully-computed summary of a hook log span.
 */
export interface HookStatsSummary {
  /** Total number of log entries considered. */
  readonly totalInvocations: number;
  /** Count by hook event name (PreToolUse, PostToolUse, etc.). */
  readonly byEvent: Readonly<Record<string, number>>;
  /** Count by tool name. "unknown" bucket for unset tool field. */
  readonly byTool: Readonly<Record<string, number>>;
  /** Count by PreToolUse decision (deny/allow/passthrough). */
  readonly byDecision: Readonly<Record<string, number>>;
  /** Number of PreToolUse:Read entries with decision=deny. */
  readonly readDenyCount: number;
  /** Rough token savings estimate from Read denies. */
  readonly estimatedTokensSaved: number;
  /** Earliest entry timestamp, or null if log is empty. */
  readonly firstEntry: string | null;
  /** Latest entry timestamp, or null if log is empty. */
  readonly lastEntry: string | null;
}

/**
 * Compute a summary of a hook log. Pure over the input array.
 *
 * Entries with missing fields are tolerated — they contribute to the
 * total count but are dropped from per-event/per-tool/per-decision
 * buckets.
 */
export function summarizeHookLog(
  entries: readonly HookLogEntry[]
): HookStatsSummary {
  const byEvent: Record<string, number> = {};
  const byTool: Record<string, number> = {};
  const byDecision: Record<string, number> = {};
  let readDenyCount = 0;
  let firstEntryTs: string | null = null;
  let lastEntryTs: string | null = null;

  for (const entry of entries) {
    const event = entry.event ?? "unknown";
    byEvent[event] = (byEvent[event] ?? 0) + 1;

    const tool = entry.tool ?? "unknown";
    byTool[tool] = (byTool[tool] ?? 0) + 1;

    if (entry.decision) {
      byDecision[entry.decision] = (byDecision[entry.decision] ?? 0) + 1;
    }

    // Count Read denies specifically — this is the savings driver.
    if (
      event === "PreToolUse" &&
      tool === "Read" &&
      entry.decision === "deny"
    ) {
      readDenyCount += 1;
    }

    // Track time range. We don't assume the log is sorted.
    const ts = (entry as HookLogEntry & { ts?: string }).ts;
    if (typeof ts === "string") {
      if (firstEntryTs === null || ts < firstEntryTs) firstEntryTs = ts;
      if (lastEntryTs === null || ts > lastEntryTs) lastEntryTs = ts;
    }
  }

  return {
    totalInvocations: entries.length,
    byEvent: Object.freeze(byEvent),
    byTool: Object.freeze(byTool),
    byDecision: Object.freeze(byDecision),
    readDenyCount,
    estimatedTokensSaved: readDenyCount * ESTIMATED_TOKENS_PER_READ_DENY,
    firstEntry: firstEntryTs,
    lastEntry: lastEntryTs,
  };
}

/**
 * Format a HookStatsSummary as human-readable text suitable for
 * `engram hook-stats` terminal output. Keeps it compact — one line per
 * event, one line per tool, no ASCII art.
 */
export function formatStatsSummary(summary: HookStatsSummary): string {
  if (summary.totalInvocations === 0) {
    return "engram hook stats: no log entries yet.\n\nRun engram install-hook in a project, then use Claude Code to see interceptions.";
  }

  const lines: string[] = [];
  lines.push(`engram hook stats (${summary.totalInvocations} invocations)`);
  lines.push("────────────────────────────────────────────────");

  if (summary.firstEntry && summary.lastEntry) {
    lines.push(`Time range: ${summary.firstEntry} → ${summary.lastEntry}`);
    lines.push("");
  }

  lines.push("By event:");
  const eventEntries = Object.entries(summary.byEvent).sort(
    (a, b) => b[1] - a[1]
  );
  for (const [event, count] of eventEntries) {
    const pct = ((count / summary.totalInvocations) * 100).toFixed(1);
    lines.push(`  ${event.padEnd(18)} ${String(count).padStart(5)} (${pct}%)`);
  }
  lines.push("");

  lines.push("By tool:");
  const toolEntries = Object.entries(summary.byTool)
    .filter(([k]) => k !== "unknown")
    .sort((a, b) => b[1] - a[1]);
  for (const [tool, count] of toolEntries) {
    lines.push(`  ${tool.padEnd(18)} ${String(count).padStart(5)}`);
  }
  if (toolEntries.length === 0) {
    lines.push("  (no tool-tagged entries)");
  }
  lines.push("");

  const decisionEntries = Object.entries(summary.byDecision);
  if (decisionEntries.length > 0) {
    lines.push("PreToolUse decisions:");
    for (const [decision, count] of decisionEntries.sort(
      (a, b) => b[1] - a[1]
    )) {
      lines.push(`  ${decision.padEnd(18)} ${String(count).padStart(5)}`);
    }
    lines.push("");
  }

  if (summary.readDenyCount > 0) {
    lines.push(
      `Estimated tokens saved: ~${formatThousands(summary.estimatedTokensSaved)}`
    );
    lines.push(
      `  (${summary.readDenyCount} Read denies × ${ESTIMATED_TOKENS_PER_READ_DENY} tok/deny avg)`
    );
  } else {
    lines.push("Estimated tokens saved: 0");
    lines.push("  (no PreToolUse:Read denies recorded yet)");
  }

  return lines.join("\n");
}
