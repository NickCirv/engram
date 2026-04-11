/**
 * Hook safety layer — the non-negotiable invariants that keep engram from
 * ever breaking Claude Code.
 *
 * Design contract (read before modifying):
 *   1. ANY error thrown inside a hook handler MUST resolve to "passthrough"
 *      (exit 0 with no JSON output). Never block Claude Code on engram bugs.
 *   2. Every hook handler must complete in <2 seconds. Anything longer gets
 *      forcibly timed out and falls through to passthrough.
 *   3. The kill switch (`.engram/hook-disabled`) takes precedence over
 *      everything. If set, all handlers exit 0 immediately — no graph access,
 *      no computation, no logging.
 *
 * This module exports pure functions. No global state. Testable in isolation.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Sentinel value returned when a handler decides the tool call should pass
 * through to Claude Code unchanged. The `engram intercept` entry point
 * converts this to "write nothing to stdout, exit 0".
 */
export const PASSTHROUGH = null;
export type Passthrough = typeof PASSTHROUGH;

/**
 * A handler result is either a JSON response to write to stdout, or the
 * PASSTHROUGH sentinel meaning "do nothing, let Claude Code proceed".
 */
export type HandlerResult = Record<string, unknown> | Passthrough;

/**
 * Default per-handler timeout in milliseconds. Chosen so that even a
 * cold-start engram query (~150ms measured 2026-04-11) plus graph walk plus
 * rendering stays well within budget. Tool calls that exceed this fall
 * through to passthrough rather than delaying Claude Code.
 */
export const DEFAULT_HANDLER_TIMEOUT_MS = 2000;

/**
 * Wrap a handler promise in a timeout. If the promise does not resolve
 * within `ms` milliseconds, resolves to PASSTHROUGH instead. The underlying
 * promise is NOT cancelled (Node has no native cancellation), but its
 * result is discarded — the caller moves on.
 */
export async function withTimeout<T extends HandlerResult>(
  promise: Promise<T>,
  ms: number = DEFAULT_HANDLER_TIMEOUT_MS
): Promise<T | Passthrough> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Passthrough>((resolve) => {
    timer = setTimeout(() => resolve(PASSTHROUGH), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Wrap an async handler so that any thrown error is swallowed and converted
 * to PASSTHROUGH. This is the universal safety net — every handler should
 * be called through `wrapSafely` to enforce the "never block Claude Code"
 * invariant.
 *
 * Errors are optionally reported via `onError` (used for logging to
 * `.engram/hook-log.jsonl`) but never propagated.
 */
export async function wrapSafely<T extends HandlerResult>(
  handler: () => Promise<T>,
  onError?: (err: unknown) => void
): Promise<T | Passthrough> {
  try {
    return await handler();
  } catch (err) {
    if (onError) {
      try {
        onError(err);
      } catch {
        // Even the error reporter must never throw. If it does, swallow.
      }
    }
    return PASSTHROUGH;
  }
}

/**
 * Compose `wrapSafely` and `withTimeout`: runs the handler with both the
 * timeout cap AND the error swallow. This is what `engram intercept` uses
 * for every handler invocation.
 */
export async function runHandler<T extends HandlerResult>(
  handler: () => Promise<T>,
  opts: { timeoutMs?: number; onError?: (err: unknown) => void } = {}
): Promise<T | Passthrough> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS;
  return wrapSafely(() => withTimeout(handler(), timeoutMs), opts.onError);
}

/**
 * Kill switch check. If `.engram/hook-disabled` exists under the given
 * project root, hooks are disabled for that project. Returns true if
 * disabled (so the caller should exit 0 immediately).
 *
 * If `projectRoot` is null (no project detected), hooks are also treated as
 * disabled — there's no project to intercept for.
 *
 * Errors (permission denied, etc.) are treated as "disabled" to fail safe.
 */
export function isHookDisabled(projectRoot: string | null): boolean {
  if (projectRoot === null) return true;
  try {
    return existsSync(join(projectRoot, ".engram", "hook-disabled"));
  } catch {
    return true;
  }
}
