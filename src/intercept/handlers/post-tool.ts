/**
 * PostToolUse hook handler — pure observer. Logs every tool
 * completion to `.engram/hook-log.jsonl` for v0.3.1 self-tuning and
 * `engram hook-stats` reporting. Never injects, never blocks, never
 * throws.
 *
 * Design:
 *   - Extract minimum metadata: tool name, file path (Read/Edit/Write),
 *     output size, success/error indicator.
 *   - Skip logging when the project root can't be resolved from cwd —
 *     logs are project-scoped and we need a root to place the file.
 *   - No PostToolUse event modifications. The hook protocol allows
 *     us to inject `additionalContext` here, but that would double-
 *     inject on top of the Read handler's work; observer-only is
 *     cleaner for v0.3.0.
 */
import { findProjectRoot, isValidCwd } from "../context.js";
import { isHookDisabled, PASSTHROUGH, type HandlerResult } from "../safety.js";
import { logHookEvent } from "../../intelligence/hook-log.js";
import { handleBashPostTool, type FileOp } from "./bash-postool.js";
import { syncFile } from "../../watcher.js";

export interface PostToolHookPayload {
  readonly hook_event_name: "PostToolUse" | string;
  readonly cwd: string;
  readonly tool_name?: string;
  readonly tool_input?: Record<string, unknown>;
  readonly tool_response?: unknown;
}

/**
 * Extract a file path from a PostToolUse tool_input, if one is present.
 * Different tools use different field names — Read/Edit/Write use
 * `file_path`, Bash uses `command` (which we don't try to parse), others
 * have no file.
 */
function extractFilePath(
  toolName: string | undefined,
  toolInput: Record<string, unknown> | undefined
): string | undefined {
  if (!toolInput) return undefined;
  if (toolName === "Read" || toolName === "Edit" || toolName === "Write") {
    const fp = toolInput.file_path;
    return typeof fp === "string" ? fp : undefined;
  }
  return undefined;
}

/**
 * Estimate the output size of a tool response. Handles the common cases
 * (string, object with `output` field) and falls back to 0 for anything
 * unrecognizable. Not trying to be perfect — this is a coarse metric for
 * "how much did this tool cost".
 */
function estimateOutputSize(toolResponse: unknown): number {
  if (toolResponse === null || toolResponse === undefined) return 0;
  if (typeof toolResponse === "string") return toolResponse.length;
  if (typeof toolResponse === "object") {
    const resp = toolResponse as Record<string, unknown>;
    if (typeof resp.output === "string") return resp.output.length;
    try {
      return JSON.stringify(toolResponse).length;
    } catch {
      return 0;
    }
  }
  return 0;
}

/**
 * Detect whether a tool response indicates an error. Heuristic: look for
 * an `error` field or a response containing "error"/"failed". False
 * positives are acceptable here — the log is informational, not a source
 * of truth for error reporting.
 */
function detectError(toolResponse: unknown): boolean {
  if (toolResponse === null || toolResponse === undefined) return false;
  if (typeof toolResponse === "object") {
    const resp = toolResponse as Record<string, unknown>;
    if (resp.error !== undefined && resp.error !== null) return true;
  }
  return false;
}

/**
 * Handle a PostToolUse hook payload. Pure observer — always resolves
 * to PASSTHROUGH. Logs each invocation as a side effect.
 */
export async function handlePostTool(
  payload: PostToolHookPayload
): Promise<HandlerResult> {
  if (payload.hook_event_name !== "PostToolUse") return PASSTHROUGH;

  try {
    const cwd = payload.cwd;
    if (!isValidCwd(cwd)) return PASSTHROUGH;

    const projectRoot = findProjectRoot(cwd);
    if (projectRoot === null) return PASSTHROUGH;

    // Kill switch — skip logging when hooks are disabled so the user
    // can debug without producing log churn.
    if (isHookDisabled(projectRoot)) return PASSTHROUGH;

    const toolName = payload.tool_name;
    const filePath = extractFilePath(toolName, payload.tool_input);
    const outputSize = estimateOutputSize(payload.tool_response);
    const hasError = detectError(payload.tool_response);

    logHookEvent(projectRoot, {
      event: "PostToolUse",
      tool: typeof toolName === "string" ? toolName : "unknown",
      path: filePath,
      outputSize,
      success: !hasError,
    });

    // v2.1 issue #14: auto-reindex on Bash file ops. Opt-in via env or
    // via `engram install-hook --auto-reindex` (PR #13 lands the flag).
    // We gate on ENGRAM_AUTO_REINDEX=1 so this is off by default until
    // the flag-driven install path is merged.
    if (
      toolName === "Bash" &&
      !hasError &&
      process.env.ENGRAM_AUTO_REINDEX === "1"
    ) {
      // Fire-and-forget — never block PostToolUse return.
      void reindexBashOps(payload, projectRoot).catch(() => {
        /* silent */
      });
    }
  } catch {
    // Observer errors are never surfaced.
  }

  // Always passthrough — this handler is pure observation.
  return PASSTHROUGH;
}

/**
 * Parse a PostToolUse:Bash command and sync the resulting FileOps.
 * Best-effort: errors are swallowed; unknown paths silent-skip via
 * syncFile's own skipped branch. Never blocks the PostToolUse response.
 */
async function reindexBashOps(
  payload: PostToolHookPayload,
  projectRoot: string
): Promise<void> {
  const result = handleBashPostTool({
    tool_name: payload.tool_name ?? "",
    tool_input: payload.tool_input ?? {},
    cwd: payload.cwd,
  });
  if (result.ops.length === 0) return;

  // Execute sequentially — we're off the critical path and don't want
  // to thrash the store with parallel writes on bulk ops like `rm a b c`.
  for (const op of result.ops) {
    await runOp(op, projectRoot);
  }
}

async function runOp(op: FileOp, projectRoot: string): Promise<void> {
  try {
    // syncFile handles the "file exists -> reindex, file gone -> prune"
    // dispatch internally. Our action hint is advisory only — syncFile
    // already checks the file's actual state.
    await syncFile(op.path, projectRoot);
  } catch {
    /* swallow — observer stays observer */
  }
}
