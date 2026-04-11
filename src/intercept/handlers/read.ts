/**
 * PreToolUse:Read handler — the highest-leverage interception point in
 * v0.3 Sentinel. Replaces full file reads with ~300-token graph summaries
 * when engram has high-confidence coverage of the file.
 *
 * Wire protocol: empirically verified on 2026-04-11.
 *   - Returns `{ permissionDecision: "deny", permissionDecisionReason: <summary> }`
 *     when confident. Claude Code blocks the Read and delivers the reason
 *     to the agent as a system-reminder containing the engram summary.
 *   - Returns PASSTHROUGH (null) when not confident, so Claude Code
 *     executes the Read normally.
 *
 * Never throws. Every error path resolves to PASSTHROUGH via wrapSafely
 * in the caller (dispatch). This handler's internal try/catch is a second
 * line of defense only; the primary safety net is `runHandler`.
 */
import { getFileContext } from "../../core.js";
import {
  resolveInterceptContext,
  isContentUnsafeForIntercept,
} from "../context.js";
import { isHookDisabled, PASSTHROUGH, type HandlerResult } from "../safety.js";
import { buildDenyResponse } from "../formatter.js";

/**
 * Input payload shape for PreToolUse:Read hook. Only the fields we
 * actually use — the rest of Claude Code's hook payload is ignored.
 */
export interface ReadHookPayload {
  readonly tool_name: string;
  readonly tool_input: {
    readonly file_path?: string;
    readonly offset?: number;
    readonly limit?: number;
  };
  readonly cwd: string;
}

/**
 * Confidence threshold below which the handler falls through to
 * passthrough. Tuned conservatively: we prefer letting the Read run
 * (costing tokens) over feeding Claude a half-empty summary (costing
 * quality). 0.7 means the file needs roughly 5+ nodes at good extraction
 * quality before we'll intercept.
 *
 * v0.3.1 will tune this from real hook-stats data.
 */
export const READ_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Handle a PreToolUse:Read hook payload. Returns either:
 *   - A deny response containing the engram structural summary (Claude
 *     will treat this as if the Read returned the summary text as content)
 *   - PASSTHROUGH (null) — caller writes nothing, exits 0, Claude's Read
 *     proceeds normally
 *
 * Branches that return PASSTHROUGH:
 *   1. tool_name is not Read (defensive — dispatch already filters this)
 *   2. file_path is missing
 *   3. Agent provided explicit offset OR limit (partial read request,
 *      engram has no line-level data to satisfy it)
 *   4. Content safety check fails (binary file, secret file)
 *   5. Context resolution fails (outside project, exempt path, etc.)
 *   6. Kill switch is enabled (.engram/hook-disabled exists)
 *   7. Graph has no nodes for this file
 *   8. Graph is stale (file mtime > graph.db mtime)
 *   9. Confidence below READ_CONFIDENCE_THRESHOLD
 */
export async function handleRead(
  payload: ReadHookPayload
): Promise<HandlerResult> {
  // (1) Sanity check: should always be Read by the time we get here.
  if (payload.tool_name !== "Read") return PASSTHROUGH;

  const filePath = payload.tool_input?.file_path;
  if (!filePath || typeof filePath !== "string") return PASSTHROUGH;

  // (3) Partial-read bypass: if the agent explicitly asked for a slice of
  // the file (offset OR limit), engram has no way to satisfy it — we only
  // have structural data, not arbitrary byte ranges. Fall through so the
  // agent gets exactly what it asked for.
  const offset = payload.tool_input.offset;
  const limit = payload.tool_input.limit;
  if (
    (typeof offset === "number" && offset > 0) ||
    (typeof limit === "number" && limit > 0)
  ) {
    return PASSTHROUGH;
  }

  // (4) Content safety: never summarize binaries or secret files.
  if (isContentUnsafeForIntercept(filePath)) return PASSTHROUGH;

  // (5) Resolve context: absolute path + project root, with exempt-zone
  // rejection baked in. Any failure here → passthrough.
  const ctx = resolveInterceptContext(filePath, payload.cwd);
  if (!ctx.proceed) return PASSTHROUGH;

  // (4b) Re-check content safety on the resolved absolute path — the
  // agent might have sent a relative path that only looks safe once
  // resolved. (E.g., `./secrets.json` vs `/project/secrets.json`.)
  if (isContentUnsafeForIntercept(ctx.absPath)) return PASSTHROUGH;

  // (6) Kill switch check — respects `.engram/hook-disabled` flag.
  if (isHookDisabled(ctx.projectRoot)) return PASSTHROUGH;

  // (7) Query the graph for file context.
  const fileCtx = await getFileContext(ctx.projectRoot, ctx.absPath);
  if (!fileCtx.found || fileCtx.codeNodeCount === 0) return PASSTHROUGH;

  // (8) Staleness — if the file on disk is newer than the last graph
  // mine, the summary may be missing recent declarations. Let the Read
  // proceed and surface the current file contents.
  if (fileCtx.isStale) return PASSTHROUGH;

  // (9) Confidence threshold — ensure we have enough coverage AND quality
  // to trust the summary as a full-file replacement.
  if (fileCtx.confidence < READ_CONFIDENCE_THRESHOLD) return PASSTHROUGH;

  // All checks passed. Build the deny response with the summary as the
  // reason. Claude Code will deliver this to the agent as a
  // system-reminder.
  return buildDenyResponse(fileCtx.summary);
}
