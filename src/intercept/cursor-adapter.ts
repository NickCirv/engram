/**
 * Cursor 1.7 hook adapter — scaffold (v0.3.1)
 *
 * Cursor shipped lifecycle hooks in v1.7 (October 2025). Of the events
 * Cursor exposes, `beforeReadFile` is the one engram can exploit to do
 * the same thing its Claude Code `PreToolUse:Read` hook does: replace
 * raw file reads with a structural summary.
 *
 * IMPORTANT CONSTRAINT — `beforeReadFile` is BINARY:
 *   Input:  { file_path, content, attachments, ... }
 *   Output: { permission: "allow" | "deny", user_message?: string }
 *
 * Cursor's hook can't rewrite the file content the way Claude Code's
 * permissionDecisionReason can. The only lever is `user_message` on a
 * `deny`, which Cursor surfaces to the agent as the denial reason.
 *
 * Our adaptation strategy:
 *   1. Receive Cursor's beforeReadFile JSON on stdin.
 *   2. Normalise it into the shape engram's existing `handleRead`
 *      expects (a synthetic Claude-style ReadHookPayload).
 *   3. Run the existing handler unchanged. This is the point — the
 *      graph, confidence threshold, staleness check, and summary
 *      builder all work identically across IDEs because they operate
 *      on file paths, not on IDE payloads.
 *   4. Translate the Claude-style HandlerResult back into Cursor's
 *      allow/deny shape:
 *        - PASSTHROUGH (null)        → { permission: "allow" }
 *        - deny + reason <summary>    → { permission: "deny", user_message: <summary> }
 *
 * Failure mode: Cursor defaults to fail-open (read allowed on hook
 * crash / timeout / invalid JSON). engram inherits this — any error
 * in the adapter returns `{ permission: "allow" }` so the read
 * proceeds normally. The graph has no business blocking the IDE.
 *
 * Wire to Cursor by writing `.cursor/hooks.json` with:
 *   {
 *     "version": 1,
 *     "hooks": {
 *       "beforeReadFile": [
 *         { "command": "engram cursor-intercept" }
 *       ]
 *     }
 *   }
 *
 * STATUS: scaffold only. Marked experimental; real wiring and an
 * integration test land in v0.3.2. This file exists in v0.3.1 as a
 * down-payment so the shape is pinned before the Cursor port sprint.
 */
import type { ReadHookPayload } from "./handlers/read.js";
import { handleRead } from "./handlers/read.js";
import { PASSTHROUGH } from "./safety.js";

/**
 * Cursor beforeReadFile input payload (v1.7).
 *
 * We only consume `file_path` and optionally `workspace_roots[0]` to
 * stand in for cwd. Everything else is ignored — attachments and
 * content are expensive to serialise and we don't need them because
 * engram answers from the graph, not from file content.
 */
export interface CursorBeforeReadFilePayload {
  readonly hook_event_name?: string;
  readonly file_path?: string;
  readonly content?: string;
  readonly workspace_roots?: ReadonlyArray<string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly [key: string]: any;
}

/**
 * Cursor hook response shape. `permission` is required; `user_message`
 * is optional and only surfaces to the agent on deny.
 */
export interface CursorHookResponse {
  readonly permission: "allow" | "deny";
  readonly user_message?: string;
}

/**
 * Allow response — used for every passthrough case: missing fields,
 * no coverage, below confidence, kill switch on, etc.
 */
const ALLOW: CursorHookResponse = { permission: "allow" };

/**
 * Translate a Cursor beforeReadFile payload into the synthetic
 * Claude-style ReadHookPayload that engram's existing handler expects.
 *
 * We synthesise tool_name = "Read" and leave tool_input.offset/limit
 * undefined — partial-read gating in handleRead would bypass the
 * intercept, and Cursor doesn't tell us whether the agent wanted a
 * slice. Default to "full file" semantics; if Cursor later adds range
 * info we can thread it through here.
 */
function toClaudeReadPayload(
  cursorPayload: CursorBeforeReadFilePayload
): ReadHookPayload | null {
  const filePath = cursorPayload.file_path;
  if (!filePath || typeof filePath !== "string") return null;

  const workspaceRoot =
    Array.isArray(cursorPayload.workspace_roots) &&
    cursorPayload.workspace_roots.length > 0
      ? cursorPayload.workspace_roots[0]
      : process.cwd();

  return {
    tool_name: "Read",
    tool_input: { file_path: filePath },
    cwd: workspaceRoot,
  };
}

/**
 * Extract the engram summary from a Claude-style handler result.
 *
 * handleRead returns either PASSTHROUGH or a Claude PreToolUse deny
 * response of shape:
 *   {
 *     hookSpecificOutput: {
 *       hookEventName: "PreToolUse",
 *       permissionDecision: "deny",
 *       permissionDecisionReason: <summary text>
 *     }
 *   }
 *
 * We pull the reason string out — that's the actual structural
 * summary Claude would have shown the agent — and surface it as
 * Cursor's user_message.
 */
function extractSummaryFromClaudeResult(
  result: unknown
): string | null {
  if (result === PASSTHROUGH || result === null) return null;
  if (typeof result !== "object") return null;

  const hookSpecific = (result as Record<string, unknown>).hookSpecificOutput;
  if (!hookSpecific || typeof hookSpecific !== "object") return null;

  const reason = (hookSpecific as Record<string, unknown>)
    .permissionDecisionReason;
  if (typeof reason !== "string" || reason.length === 0) return null;

  return reason;
}

/**
 * Main entry point — process one Cursor beforeReadFile hook payload
 * and return the Cursor response shape. Never throws; any error
 * returns an allow response so the IDE proceeds normally.
 *
 * This is the function the `engram cursor-intercept` CLI command
 * calls after reading JSON from stdin.
 */
export async function handleCursorBeforeReadFile(
  payload: CursorBeforeReadFilePayload
): Promise<CursorHookResponse> {
  try {
    if (!payload || typeof payload !== "object") return ALLOW;

    const claudePayload = toClaudeReadPayload(payload);
    if (claudePayload === null) return ALLOW;

    const result = await handleRead(claudePayload);
    const summary = extractSummaryFromClaudeResult(result);

    if (summary === null) return ALLOW;

    return {
      permission: "deny",
      user_message: summary,
    };
  } catch {
    // Fail-open: match Cursor's default for hook crashes.
    return ALLOW;
  }
}
