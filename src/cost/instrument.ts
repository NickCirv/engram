/**
 * v3.3 Cost Lens — instrumentation helpers used by the dispatcher.
 *
 * These functions read engram's hook response shape and the agent's
 * tool input to produce two numbers per intercepted call:
 *
 *   • injected      — tokens engram inserted (deny reason OR additionalContext)
 *   • wouldHaveRead — tokens the agent would have consumed without engram
 *
 * Both are estimated using the same 4-chars-per-token heuristic the
 * resolver uses, so they're directly comparable. Token math here is
 * intentionally NEVER allowed to throw: a failure to compute cost
 * fields must never break the dispatch path. Bad input → undefined
 * field. The aggregator already treats undefined as "skip this row".
 */
import { statSync } from "node:fs";

/** ~4 chars per token, matches `providers/resolver.ts`. */
export const CHARS_PER_TOKEN = 4;

export function tokensFromChars(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * Pull the size, in tokens, of any content engram injected via the
 * hook response. Looks at both seams:
 *   - hookSpecificOutput.permissionDecisionReason  (deny path / Read intercept)
 *   - hookSpecificOutput.additionalContext         (allow path / Edit augmentation)
 *
 * Returns 0 if the result is PASSTHROUGH or no recognised injection
 * field is present. Never throws.
 */
export function extractInjectedTokens(result: unknown): number {
  if (!result || typeof result !== "object") return 0;
  try {
    const hook = (result as { hookSpecificOutput?: Record<string, unknown> })
      .hookSpecificOutput;
    if (!hook || typeof hook !== "object") return 0;
    const reason = hook.permissionDecisionReason;
    if (typeof reason === "string" && reason.length > 0) {
      return tokensFromChars(reason.length);
    }
    const ctx = hook.additionalContext;
    if (typeof ctx === "string" && ctx.length > 0) {
      return tokensFromChars(ctx.length);
    }
  } catch {
    // Defensive — never throw from a pure accessor.
  }
  return 0;
}

/**
 * Estimate the tokens the agent would have read if engram had not
 * intercepted. For the Read tool, this is the file size on disk
 * divided by 4. For other tools (Edit, Write, Bash), there's no
 * meaningful "would have read" — engram augments rather than replaces
 * the call. Callers pass `tool` so we only stat for tools that have a
 * defined replacement semantic.
 *
 * Returns 0 on:
 *   - tool not in {Read}
 *   - missing file path
 *   - stat failure (file moved, permission denied, etc.)
 *   - non-positive file size
 *
 * Never throws.
 */
export function estimateWouldHaveReadTokens(
  tool: string,
  filePath: string | undefined
): number {
  if (tool !== "Read") return 0;
  if (!filePath || typeof filePath !== "string") return 0;
  try {
    const size = statSync(filePath).size;
    return tokensFromChars(size);
  } catch {
    return 0;
  }
}

/**
 * Compose the cost-fields fragment for a hook log entry. Returns an
 * object with `wouldHaveRead`, `injected`, and `tokensSaved`, omitting
 * keys whose value is 0 so the JSONL line stays compact.
 *
 * `tokensSaved = max(0, wouldHaveRead - injected)`. The clamp matters
 * because, on tiny files, the engram summary can be larger than the
 * raw file — that's a *cost*, not a saving, and we don't pretend
 * otherwise.
 */
export function composeCostFields(
  tool: string,
  filePath: string | undefined,
  result: unknown
): {
  readonly wouldHaveRead?: number;
  readonly injected?: number;
  readonly tokensSaved?: number;
} {
  const injected = extractInjectedTokens(result);
  const wouldHaveRead = estimateWouldHaveReadTokens(tool, filePath);
  const tokensSaved = Math.max(0, wouldHaveRead - injected);
  const out: {
    wouldHaveRead?: number;
    injected?: number;
    tokensSaved?: number;
  } = {};
  if (wouldHaveRead > 0) out.wouldHaveRead = wouldHaveRead;
  if (injected > 0) out.injected = injected;
  if (tokensSaved > 0) out.tokensSaved = tokensSaved;
  return out;
}
