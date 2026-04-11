/**
 * PreToolUse:Bash handler — closes the "Bash workaround" loophole.
 *
 * An agent that can't Read a file might try `cat path/to/file.ts` via
 * Bash instead, bypassing the Read interception entirely. This handler
 * detects simple single-file read commands (cat/head/tail/less/more)
 * and delegates to `handleRead` with a synthesized Read payload.
 *
 * Design: STRICT parser. We only intercept the simplest possible
 * invocations — one command, one file argument, no pipes, no redirects,
 * no command substitution, no subshells, no globs. Anything more
 * sophisticated passes through untouched because:
 *   1. Shell parsing is famously error-prone and we can't afford to
 *      misinterpret a command and block the wrong thing.
 *   2. Agents that construct complex Bash pipelines probably WANT the
 *      pipeline behavior and not a graph summary.
 *   3. False negatives (missed interceptions) cost tokens; false
 *      positives (wrong interceptions) cost correctness. We optimize
 *      for the latter.
 *
 * Safe patterns (intercepted):
 *   cat src/auth.ts
 *   head src/auth.ts
 *   tail src/auth.ts
 *   less src/auth.ts
 *   more src/auth.ts
 *
 * Unsafe patterns (pass through untouched):
 *   cat src/*.ts               (glob)
 *   cat a.ts b.ts              (multi-arg)
 *   cat src/auth.ts | grep foo (pipe)
 *   cat src/auth.ts > out      (redirect)
 *   cat $(find . -name auth)   (command substitution)
 *   head -n 20 src/auth.ts     (flag)
 *   cd /tmp && cat auth.ts     (chain)
 */
import { handleRead } from "./read.js";
import { PASSTHROUGH, type HandlerResult } from "../safety.js";

export interface BashHookPayload {
  readonly tool_name: string;
  readonly tool_input: {
    readonly command?: string;
  };
  readonly cwd: string;
}

/**
 * Commands that read a single file's contents and print to stdout/pager.
 * Each of these can be safely replaced with a Read when invoked on a
 * single file argument.
 */
const READ_LIKE_COMMANDS = new Set<string>([
  "cat",
  "head",
  "tail",
  "less",
  "more",
]);

/**
 * Shell metacharacters that indicate a complex command. If ANY of these
 * appear in the command string, we refuse to parse and pass through.
 * Conservative on purpose — missing a pattern here costs tokens but
 * being wrong costs correctness.
 */
const UNSAFE_SHELL_CHARS = /[|&;<>()$`\\*?[\]{}"']/;

/**
 * Parse a strict single-command single-file invocation. Returns the
 * file path if it matches, or null otherwise.
 *
 * Matches shape: `<cmd><WS><path>` where:
 *   - `<cmd>` is in READ_LIKE_COMMANDS
 *   - `<WS>` is one or more spaces or tabs (no newlines)
 *   - `<path>` is a non-empty run of path-safe characters (no shell meta)
 *   - no leading or trailing whitespace around the overall command
 *   - no tokens after `<path>` (i.e., exactly command + arg)
 */
export function parseReadLikeBashCommand(command: string): string | null {
  if (!command || typeof command !== "string") return null;

  // Length cap — a legitimate "cat foo.ts" is under 200 chars. Anything
  // longer is probably constructing something complex we shouldn't touch.
  if (command.length > 200) return null;

  const trimmed = command.trim();
  if (trimmed !== command) {
    // Reject leading/trailing whitespace — keeps the parser from
    // needing to decide whether that's meaningful.
    return null;
  }

  // Reject any hint of shell metacharacters.
  if (UNSAFE_SHELL_CHARS.test(trimmed)) return null;

  // Split on whitespace and require exactly two tokens: command + path.
  const tokens = trimmed.split(/\s+/);
  if (tokens.length !== 2) return null;

  const [cmd, path] = tokens;
  if (!READ_LIKE_COMMANDS.has(cmd)) return null;

  // Reject flag-like args (anything starting with `-`) — even though we
  // already rejected complex commands, `cat -n file` would otherwise slip
  // through as two tokens.
  if (path.startsWith("-")) return null;

  // Reject empty or suspicious-looking paths.
  if (path.length === 0) return null;
  if (path.includes("\0")) return null;

  return path;
}

/**
 * Handle a PreToolUse:Bash payload. If the command is a safe read-like
 * invocation, delegate to `handleRead` with a synthesized payload. Any
 * parse failure or non-read command resolves to passthrough.
 */
export async function handleBash(
  payload: BashHookPayload
): Promise<HandlerResult> {
  if (payload.tool_name !== "Bash") return PASSTHROUGH;

  const command = payload.tool_input?.command;
  if (!command || typeof command !== "string") return PASSTHROUGH;

  const filePath = parseReadLikeBashCommand(command);
  if (filePath === null) return PASSTHROUGH;

  // Delegate to the Read handler. Synthesized payload mirrors what
  // Claude Code would send for a direct Read call. The Read handler
  // does all its own safety checks (exempt paths, kill switch, staleness,
  // confidence threshold, etc.), so we don't duplicate them here.
  return handleRead({
    tool_name: "Read",
    cwd: payload.cwd,
    tool_input: {
      file_path: filePath,
    },
  });
}
