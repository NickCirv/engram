/**
 * PreToolUse:Edit and PreToolUse:Write handler.
 *
 * Unlike the Read handler (which BLOCKS and returns a summary), this
 * handler NEVER blocks. Its only job is to surface landmine warnings
 * from the mistake graph when the agent is about to modify a file that
 * has known past failures.
 *
 * Mechanism: empirically verified PreToolUse `allow + additionalContext`
 * shape (v5 spike, 2026-04-11). Claude Code runs the Edit/Write normally
 * and delivers the warning alongside the tool result as a system-reminder.
 *
 * Decision matrix:
 *   - Missing file_path → passthrough
 *   - Content unsafe (binary/secret) → passthrough
 *   - Outside project → passthrough
 *   - Kill switch → passthrough
 *   - No mistakes for this file → passthrough (empty context adds no value)
 *   - Mistakes found → buildAllowWithContextResponse(warning)
 *
 * Safety invariant: this handler must NEVER return a deny response. The
 * whole point is to let writes proceed with context, not gate them.
 */
import { relative, resolve as resolvePath } from "node:path";
import { mistakes } from "../../core.js";
import { toPosixPath } from "../../graph/path-utils.js";
import {
  isContentUnsafeForIntercept,
  resolveInterceptContext,
} from "../context.js";
import { isHookDisabled, PASSTHROUGH, type HandlerResult } from "../safety.js";
import { buildAllowWithContextResponse } from "../formatter.js";

/**
 * Input payload shape for PreToolUse:Edit and PreToolUse:Write. We only
 * use `tool_input.file_path` — the old_string/new_string/content fields
 * are ignored because we never inspect write payloads for secrets (that
 * would be a security risk and runtime cost).
 */
export interface EditWriteHookPayload {
  readonly tool_name: "Edit" | "Write" | string;
  readonly tool_input: {
    readonly file_path?: string;
  };
  readonly cwd: string;
}

/**
 * Maximum number of landmines to include in the warning. More than this
 * creates noise — a file with 8+ known mistakes probably needs a refactor,
 * not a line-item warning list. We show the 5 most recent.
 */
const MAX_LANDMINES_IN_WARNING = 5;

/**
 * Format a list of mistakes as an agent-readable warning block suitable
 * for the `additionalContext` field of an allow response. Kept compact
 * so the injection doesn't dwarf the actual tool result.
 */
function formatLandmineWarning(
  projectRelativeFile: string,
  mistakeList: readonly {
    readonly label: string;
    readonly sourceFile: string;
    readonly confidence: string;
  }[]
): string {
  const header = `[engram landmines] ${mistakeList.length} past mistake${
    mistakeList.length === 1 ? "" : "s"
  } recorded for ${projectRelativeFile}:`;
  const items = mistakeList.map((m) => {
    const conf = m.confidence === "EXTRACTED" ? "" : ` [${m.confidence.toLowerCase()}]`;
    return `  - ${m.label}${conf}`;
  });
  const footer =
    "Review these before editing to avoid re-introducing a known failure mode. " +
    "engram recorded these from past session notes (bug:/fix: lines in your CLAUDE.md).";
  return [header, ...items, "", footer].join("\n");
}

/**
 * Handle a PreToolUse:Edit or PreToolUse:Write hook payload.
 *
 * Returns either:
 *   - `allow + additionalContext` with landmine warning, OR
 *   - PASSTHROUGH (no output)
 *
 * NEVER returns a deny response.
 */
export async function handleEditOrWrite(
  payload: EditWriteHookPayload
): Promise<HandlerResult> {
  // Only Edit and Write are supported. Other tool_names should have been
  // filtered out by the dispatcher but we defend here too.
  if (payload.tool_name !== "Edit" && payload.tool_name !== "Write") {
    return PASSTHROUGH;
  }

  const filePath = payload.tool_input?.file_path;
  if (!filePath || typeof filePath !== "string") return PASSTHROUGH;

  // Content safety — never inspect secret files or binaries, even for
  // landmine warnings. Same rule as the Read handler.
  if (isContentUnsafeForIntercept(filePath)) return PASSTHROUGH;

  // Resolve context.
  const ctx = resolveInterceptContext(filePath, payload.cwd);
  if (!ctx.proceed) return PASSTHROUGH;

  // Re-check safety on the resolved absolute path.
  if (isContentUnsafeForIntercept(ctx.absPath)) return PASSTHROUGH;

  // Kill switch.
  if (isHookDisabled(ctx.projectRoot)) return PASSTHROUGH;

  // Query for mistakes. We look up by project-relative path because
  // that's how the session miner stores sourceFile on mistake nodes.
  // POSIX-normalize for consistent lookup against the graph.
  const relPath = toPosixPath(
    relative(resolvePath(ctx.projectRoot), ctx.absPath)
  );
  if (!relPath || relPath.startsWith("..")) return PASSTHROUGH;

  let found;
  try {
    found = await mistakes(ctx.projectRoot, {
      sourceFile: relPath,
      limit: MAX_LANDMINES_IN_WARNING,
    });
  } catch {
    // getStore or store.getAllNodes could throw on a corrupt DB. Fail
    // safe — let the write proceed with no warning.
    return PASSTHROUGH;
  }

  if (found.length === 0) return PASSTHROUGH;

  // Format and return.
  const warning = formatLandmineWarning(relPath, found);
  return buildAllowWithContextResponse(warning);
}
