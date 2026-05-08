import { findProjectRoot, isValidCwd } from "../context.js";
import { isHookDisabled, PASSTHROUGH, type HandlerResult } from "../safety.js";
import { learn } from "../../core.js";
import { logHookEvent } from "../../intelligence/hook-log.js";

export interface AssistantMessagePayload {
  readonly hook_event_name: "AssistantMessage" | string;
  readonly cwd: string;
  readonly content?: string;
  readonly summary?: string;
  readonly memoryScope?: string; // project | global | entity
  readonly sourceLabel?: string;
}

/**
 * Handle an AssistantMessage hook payload. This is an opt-in hook that
 * external clients (the agent host) can call to tell engram that the
 * assistant produced content that should be persisted as memory.
 *
 * Behaviour:
 *  - Validates cwd and project root
 *  - If a textual `content` or `summary` is provided, calls core.learn()
 *    asynchronously to persist conclusions/fragments into the graph.
 *  - Returns PASSTHROUGH (observer-only). Any internal error is swallowed.
 */
export async function handleAssistantMessage(
  payload: AssistantMessagePayload
): Promise<HandlerResult> {
  if (payload.hook_event_name !== "AssistantMessage") return PASSTHROUGH;

  try {
    const cwd = payload.cwd;
    if (!isValidCwd(cwd)) return PASSTHROUGH;

    const projectRoot = findProjectRoot(cwd);
    if (projectRoot === null) return PASSTHROUGH;

    if (isHookDisabled(projectRoot)) return PASSTHROUGH;

    const raw = typeof payload.content === "string" && payload.content.trim().length > 0
      ? payload.content
      : typeof payload.summary === "string" && payload.summary.trim().length > 0
        ? payload.summary
        : null;

    if (!raw) return PASSTHROUGH;

    // Short-circuit tiny fragments — require at least a short sentence.
    const trimmed = raw.trim();
    if (trimmed.length < 20) return PASSTHROUGH;

    const scope = (typeof payload.memoryScope === "string" && payload.memoryScope) ? payload.memoryScope : "project";
    const src = payload.sourceLabel ?? "assistant";

    // Fire-and-forget: persist the assistant's content as a learned memory.
    try {
      void learn(projectRoot, trimmed, src, scope).catch(() => {});
    } catch {
      /* swallow */
    }

    try {
      // Dashboard-friendly lightweight event log. Do NOT include the
      // learned content in the log to avoid accidental leakage.
      logHookEvent(projectRoot, { event: "Learn", tool: "Assistant", path: null, tokensSaved: 0 });
    } catch {
      // best-effort
    }
  } catch {
    // swallow
  }

  return PASSTHROUGH;
}
