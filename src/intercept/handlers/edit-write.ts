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

/** Format a unix-ms timestamp as YYYY-MM-DD (UTC) for the bi-temporal layout. */
function formatLandmineDate(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "unknown";
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

/**
 * Format a list of mistakes as an agent-readable warning block suitable
 * for the `additionalContext` field of an allow response. Kept compact
 * so the injection doesn't dwarf the actual tool result.
 *
 * v4.0: when a mistake has the schema-v9 bi-temporal fields populated
 * (thenBelieved + foundFalseAt OR truthNow), the entry renders as a
 * structured "then you believed / found false / truth now" block. v3.x
 * mistakes without those fields fall back to the single-line legacy
 * format. The footer is generic (multi-source) — git-revert miner,
 * session miner, AST miner, and explicit `engram learn` can all
 * contribute mistakes here.
 */
function formatLandmineWarning(
  projectRelativeFile: string,
  mistakeList: readonly {
    readonly label: string;
    readonly sourceFile: string;
    readonly confidence: string;
    readonly thenBelieved?: string;
    readonly foundFalseAt?: number;
    readonly truthNow?: string;
    readonly appliesTo?: string;
  }[]
): string {
  const header = `[engram landmines] ${mistakeList.length} past mistake${
    mistakeList.length === 1 ? "" : "s"
  } recorded for ${projectRelativeFile}:`;

  const isBiTemporal = (m: { thenBelieved?: string; foundFalseAt?: number; truthNow?: string }) =>
    typeof m.thenBelieved === "string" &&
    m.thenBelieved.length > 0 &&
    (typeof m.foundFalseAt === "number" || typeof m.truthNow === "string");

  const items = mistakeList.map((m) => {
    const conf = m.confidence === "EXTRACTED" ? "" : ` [${m.confidence.toLowerCase()}]`;
    if (!isBiTemporal(m)) {
      return `  - ${m.label}${conf}`;
    }
    const title = m.appliesTo ?? m.label;
    const lines = [`  - ${title}${conf}`];
    lines.push(`     then you believed: ${m.thenBelieved}`);
    if (typeof m.foundFalseAt === "number") {
      lines.push(`     found false:       ${formatLandmineDate(m.foundFalseAt)}`);
    }
    if (typeof m.truthNow === "string" && m.truthNow.length > 0) {
      lines.push(`     truth now:         ${m.truthNow}`);
    }
    return lines.join("\n");
  });

  const anyBiTemporal = mistakeList.some(isBiTemporal);
  const separator = anyBiTemporal ? "\n\n" : "\n";
  const footer =
    "Review these before editing to avoid re-introducing a known failure mode. " +
    "Sources: git-revert pairs, AST mining, agent self-corrections, and explicit `engram learn`.";
  return [header, items.join(separator), "", footer].join("\n");
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
