/**
 * Hook response formatter — builds JSON responses matching the Claude Code
 * hook protocol, empirically verified on 2026-04-11.
 *
 * All outputs pass through length truncation to stay under Claude Code's
 * 10,000-character hook output cap. We target 8,000 to leave headroom for
 * surrounding JSON wrapping.
 *
 * VERIFIED working mechanisms (do NOT change without re-running the spike):
 *   - PreToolUse deny + permissionDecisionReason → blocks tool, reason
 *     arrives at agent as system-reminder.
 *   - PreToolUse allow + additionalContext → tool runs, context injected
 *     alongside the tool result.
 *
 * VERIFIED NOT working (do NOT attempt):
 *   - PreToolUse updatedInput.file_path for Read → silently ignored. The
 *     docs say it works; empirical test says it doesn't. See
 *     `reference_claude_code_hook_protocol_empirical.md` in memory.
 */

/**
 * Maximum character budget for a hook response body (reason or additional
 * context). Claude Code caps hook output at 10,000 chars total; we target
 * 8,000 to leave headroom for surrounding JSON punctuation and key names.
 */
export const MAX_RESPONSE_CHARS = 8000;

/**
 * Suffix appended to truncated strings so the agent knows content was cut.
 */
const TRUNCATION_MARKER = "\n\n[... engram summary truncated to fit hook response limit ...]";

/**
 * Truncate a string to at most `MAX_RESPONSE_CHARS` characters, appending
 * a visible marker when truncation occurs. UTF-16 surrogate-safe: if the
 * raw cut would fall inside a surrogate pair, back off by one code unit.
 */
export function truncateForHook(text: string): string {
  if (!text) return "";
  if (text.length <= MAX_RESPONSE_CHARS) return text;

  const budget = MAX_RESPONSE_CHARS - TRUNCATION_MARKER.length;
  let cut = budget;
  // If cutting inside a surrogate pair, back off by one.
  const code = text.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1;

  return text.slice(0, cut) + TRUNCATION_MARKER;
}

/**
 * Build a PreToolUse response that DENIES the tool call with a reason.
 * The reason is delivered to the agent as a system-reminder containing
 * the block explanation — this is how engram replaces a Read with a
 * graph summary.
 *
 * Empirically verified on 2026-04-11: the reason arrives as formatted
 * system-reminder text, parseable by the agent as context.
 */
export function buildDenyResponse(reason: string): Record<string, unknown> {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: truncateForHook(reason),
    },
  };
}

/**
 * Build a PreToolUse response that ALLOWS the tool call to proceed but
 * injects `additionalContext` alongside the tool result. Used for
 * augmentation (e.g., landmine warnings on Edit) where we want the full
 * tool to run AND add engram context on top.
 *
 * If `additionalContext` is empty or whitespace-only, returns a plain
 * allow response with no context (never wastes tokens on empty injections).
 *
 * Empirically verified on 2026-04-11 across multiple Read calls: the
 * additionalContext is delivered as a system-reminder alongside the tool
 * result.
 */
export function buildAllowWithContextResponse(
  additionalContext: string
): Record<string, unknown> {
  const trimmed = additionalContext?.trim() ?? "";
  if (trimmed.length === 0) {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
      },
    };
  }
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      additionalContext: truncateForHook(trimmed),
    },
  };
}

/**
 * Build a SessionStart or UserPromptSubmit response that injects context.
 * These events use a different response shape — `additionalContext` at
 * `hookSpecificOutput.additionalContext` with the appropriate event name.
 *
 * For SessionStart: adds context at session start (visible in transcript
 * as a system-reminder).
 *
 * For UserPromptSubmit: adds context alongside the user's prompt before
 * Claude processes it.
 *
 * Empty/whitespace context returns null (passthrough) to avoid wasted
 * injection.
 */
export function buildSessionContextResponse(
  eventName: "SessionStart" | "UserPromptSubmit",
  additionalContext: string
): Record<string, unknown> | null {
  const trimmed = additionalContext?.trim() ?? "";
  if (trimmed.length === 0) return null;
  return {
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: truncateForHook(trimmed),
    },
  };
}

/**
 * Build a PostToolUse response that adds context to a tool result. Used
 * for observer-style annotations (e.g., "this file is a mistake hot
 * spot") after a tool has already run.
 *
 * Empty context returns null (passthrough).
 */
export function buildPostToolContextResponse(
  additionalContext: string
): Record<string, unknown> | null {
  const trimmed = additionalContext?.trim() ?? "";
  if (trimmed.length === 0) return null;
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: truncateForHook(trimmed),
    },
  };
}

/**
 * Serialize a handler response for stdout. Validates that the input is a
 * plain object (not null, not a primitive) before JSON.stringify'ing.
 * Returns empty string for null/undefined (passthrough — nothing to write).
 *
 * We never throw here; malformed responses become passthroughs to protect
 * the "never block Claude Code" invariant.
 */
export function serializeResponse(response: Record<string, unknown> | null): string {
  if (response === null || response === undefined) return "";
  if (typeof response !== "object") return "";
  try {
    return JSON.stringify(response);
  } catch {
    // Circular references or other JSON errors — fail safe.
    return "";
  }
}
