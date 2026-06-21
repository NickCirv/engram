/**
 * Stop hook handler — shows the DEVELOPER a one-line "engram earned its
 * keep" summary, so the value the agent silently received becomes visible.
 *
 * Why this exists: every other engram surface (SessionStart brief, Read
 * graph-summaries, mistake-guard warnings) is delivered to the AGENT via
 * additionalContext — the human never sees it. A dev installs engram,
 * Claude just answers, nothing says "engram did that" → they uninstall.
 * This is the one place engram speaks to the human.
 *
 * Output contract (verified against Claude Code hooks docs, 2026-06-02):
 *   - A user-visible line on Stop = JSON `{ "systemMessage": "..." }` on
 *     stdout, exit 0. (Plain stdout is debug-only; stderr+exit2 blocks.)
 *   - Stop fires after EVERY assistant turn, so we debounce to once per
 *     session via a marker keyed on the payload's `session_id`.
 *
 * Honesty: the token figure is a STRUCTURAL context-packet reduction
 * (tokens kept out of context), not a bill saving — labelled as such,
 * consistent with the rest of the v4.x honesty pass.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findProjectRoot, isValidCwd } from "../context.js";
import { isHookDisabled, PASSTHROUGH, type HandlerResult } from "../safety.js";
import { readHookLog, type HookLogEntry } from "../../intelligence/hook-log.js";
import { summarizeHookLog } from "../stats.js";
import { formatThousands } from "../../graph/render-utils.js";

export interface StopHookPayload {
  readonly hook_event_name: "Stop" | string;
  readonly cwd: string;
  /** Claude Code session identifier — used to debounce to once per session. */
  readonly session_id?: string;
}

/** Marker file (inside `.engram/`) holding the session_id we last summarised. */
const SUMMARY_MARKER = ".summary-shown";

/**
 * Count past-mistake warnings in the log. Best-effort: matches entries
 * whose `reason` mentions a mistake/landmine. Returns 0 if the field is
 * absent — we never invent a number.
 */
function countMistakeWarnings(
  entries: readonly { reason?: string }[]
): number {
  let n = 0;
  for (const e of entries) {
    if (typeof e.reason === "string" && /mistake|landmine/i.test(e.reason)) {
      n += 1;
    }
  }
  return n;
}

/**
 * Build the one-line summary, or null if there's nothing worth showing.
 * Pure over its inputs so it's trivially testable.
 */
export function buildStopSummary(
  entries: readonly HookLogEntry[]
): string | null {
  const summary = summarizeHookLog(entries);
  const reads = summary.readDenyCount;
  const tokens = summary.estimatedTokensSaved;
  const displaced = summary.tokensDisplaced;

  // Nothing engram visibly did → stay silent (don't write a marker either).
  if (reads === 0 && tokens === 0 && displaced === 0) return null;

  const parts: string[] = [];
  if (reads > 0) {
    parts.push(`${reads} file-read${reads === 1 ? "" : "s"} answered from the graph`);
  }
  const mistakeWarnings = countMistakeWarnings(
    entries as readonly { reason?: string }[]
  );
  if (mistakeWarnings > 0) {
    parts.push(
      `${mistakeWarnings} past-mistake warning${mistakeWarnings === 1 ? "" : "s"}`
    );
  }
  if (tokens > 0) {
    parts.push(`~${formatThousands(tokens)} tokens kept out of context`);
  }
  if (displaced > 0) {
    parts.push(
      `~${formatThousands(displaced)} redundant tokens displaced across providers`
    );
  }

  return `⚡ engram so far: ${parts.join(" · ")} (structural — not a bill saving)`;
}

/**
 * Stop hook handler. Returns a `systemMessage` JSON result the human sees,
 * once per session; PASSTHROUGH otherwise. Any error falls through to
 * PASSTHROUGH via the dispatcher's safety wrapper.
 */
export async function handleStop(
  payload: StopHookPayload
): Promise<HandlerResult> {
  const cwd = payload.cwd;
  if (!isValidCwd(cwd)) return PASSTHROUGH;

  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) return PASSTHROUGH;
  if (isHookDisabled(projectRoot)) return PASSTHROUGH;

  // Debounce: only summarise once per session. Without a session_id we
  // cannot debounce, so we stay silent rather than risk spamming every turn.
  const sessionId = payload.session_id;
  if (!sessionId) return PASSTHROUGH;

  const markerPath = join(projectRoot, ".engram", SUMMARY_MARKER);
  try {
    if (existsSync(markerPath) && readFileSync(markerPath, "utf-8").trim() === sessionId) {
      return PASSTHROUGH; // already shown this session
    }
  } catch {
    // Unreadable marker → treat as "not shown yet" and continue.
  }

  const entries = readHookLog(projectRoot);
  const line = buildStopSummary(entries);
  if (line === null) return PASSTHROUGH; // no activity worth surfacing yet

  // Mark this session as summarised so later Stops this session stay quiet.
  try {
    writeFileSync(markerPath, sessionId);
  } catch {
    // If we can't persist the marker we'd re-show next turn; accept that
    // over throwing. The summary itself is still worth showing once.
  }

  return { systemMessage: line };
}
