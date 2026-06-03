/**
 * PreToolUse:Grep handler (research-loop elimination — ADR-0001).
 *
 * The original Context Spine thesis was to collapse the agent's investigation
 * loop (grep → read → read → grep) into one packet. engram already intercepts
 * Read/cat; this closes the Grep half for the common "where is this symbol
 * used?" case by answering from the `calls` reference graph instead of letting
 * a raw match dump flood the context window.
 *
 * RECALL SAFETY (the load-bearing constraint): the calls graph is name-based
 * and structural — it has LOWER textual recall than grep (no comments, log
 * strings, dynamic dispatch, partial matches). So we intercept ONLY when the
 * pattern is a bare identifier that the graph actually knows (≥1 caller), and
 * we ALWAYS include the exact `rg -n` escalation command so the agent can
 * recover full textual matches in one step. Everything else → PASSTHROUGH; the
 * real grep runs. Default to doing nothing; act only when provably helpful.
 *
 * Returns:
 *   - A deny response whose reason is engram's caller list (the files that
 *     reference the symbol), when the pattern is a known symbol with references.
 *   - PASSTHROUGH (null) otherwise — caller writes nothing, exits 0, the real
 *     Grep runs unchanged.
 * Never throws. Every error path resolves to PASSTHROUGH via wrapSafely.
 */
import { PASSTHROUGH, isHookDisabled, type HandlerResult } from "../safety.js";
import { findProjectRoot, isValidCwd } from "../context.js";
import { buildDenyResponse } from "../formatter.js";
import { callers } from "../../core.js";

export interface GrepHookPayload {
  tool_name?: string;
  cwd?: string;
  tool_input?: {
    pattern?: string;
    output_mode?: string;
    [key: string]: unknown;
  };
}

/**
 * A bare identifier the calls graph could plausibly know: starts with a
 * letter / `_` / `$`, only identifier chars after, length ≥ 3. Anything with a
 * regex metacharacter, a space, a path separator, or a length < 3 is treated
 * as a TEXT search and passed through (grep has higher recall there).
 */
const SYMBOL_RE = /^[A-Za-z_$][A-Za-z0-9_$]{2,}$/;

/**
 * Common identifiers that are far more likely a text search than a symbol
 * lookup even when they happen to match a graph node. Belt-and-braces on top
 * of the "must have ≥1 caller" gate — keeps us from hijacking a search for a
 * ubiquitous word.
 */
const STOPWORDS = new Set([
  "true", "false", "null", "undefined", "function", "return", "import",
  "export", "const", "class", "async", "await", "string", "number",
  "boolean", "value", "error", "result", "data", "type", "interface",
  "todo", "fixme", "console", "test", "default",
]);

export async function handleGrep(
  payload: GrepHookPayload
): Promise<HandlerResult> {
  if (payload.tool_name !== "Grep") return PASSTHROUGH;

  // (0) Opt-out: on by default (delivers the saving without the user knowing
  // to flip a flag), but `ENGRAM_GREP_INTERCEPT=0` disables it cleanly without
  // touching the rest of engram — the escape hatch if the precision gate ever
  // misfires on a real workflow.
  if (process.env.ENGRAM_GREP_INTERCEPT === "0") return PASSTHROUGH;

  // (1) Intent gate: only a bare-identifier pattern is a likely symbol lookup.
  // Regex/text/multi-word searches pass through — grep out-recalls the graph.
  const pattern = payload.tool_input?.pattern;
  if (
    typeof pattern !== "string" ||
    !SYMBOL_RE.test(pattern) ||
    STOPWORDS.has(pattern.toLowerCase())
  ) {
    return PASSTHROUGH;
  }

  // (2) Resolve the project root from cwd (no file path on a Grep).
  const cwd = payload.cwd;
  if (typeof cwd !== "string" || !isValidCwd(cwd)) return PASSTHROUGH;
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) return PASSTHROUGH;

  // (3) Kill switch.
  if (isHookDisabled(projectRoot)) return PASSTHROUGH;

  // (4) Ask the reference graph who references this symbol. No callers means
  // either an unknown symbol or a textual-only occurrence — let grep run.
  const callerFiles = await callers(projectRoot, pattern);
  if (callerFiles.length === 0) return PASSTHROUGH;

  return buildDenyResponse(buildGrepAnswer(pattern, callerFiles));
}

/**
 * Format engram's structural answer plus the explicit escalation path. The
 * escalation line is non-negotiable — it's what makes denying the grep
 * recall-safe (the agent can always get the full textual matches).
 */
function buildGrepAnswer(pattern: string, callerFiles: string[]): string {
  const list = callerFiles.map((f) => `  - ${f}`).join("\n");
  return [
    `[engram] "${pattern}" is referenced by ${callerFiles.length} file(s) ` +
      `in the reference graph (structural \`calls\` edges):`,
    list,
    "",
    "This is engram's structural answer — resolved function/class references " +
      "only. It does NOT include comments, strings, or dynamic references. " +
      `If you need full textual matches, run: rg -n "${pattern}"`,
  ].join("\n");
}
