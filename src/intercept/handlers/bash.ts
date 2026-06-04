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
import { handleGrep } from "./grep.js";
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

// ── Bash grep → Grep handler (ADR-0005) ────────────────────────────

/** Grep-family commands an agent runs via Bash (the only grep path in IDEs
 *  without a structured Grep tool — Aider, Codex CLI, Cline, …). */
const GREP_COMMANDS = new Set<string>(["rg", "grep", "egrep", "fgrep"]);

/** Shell-control chars that mean pipe / redirect / substitution / chain → bail.
 *  Note: quotes and regex/glob chars are deliberately NOT here — a grep pattern
 *  may contain them, and handleGrep's SYMBOL_RE gate rejects non-identifiers. */
const GREP_UNSAFE_SHELL = /[|&;<>$`\n\\()]/;

/** Flags that change the output mode or match semantics so the result is NOT a
 *  content symbol search — bail (let the real grep run). */
const GREP_REJECT_FLAGS = new Set<string>([
  "-l", "--files-with-matches", "-L", "--files-without-match",
  "-c", "--count", "-o", "--only-matching", "-v", "--invert-match", "--json",
]);

/** Long boolean flags that keep it a plain content search — safe to skip. */
const GREP_SAFE_LONG = new Set<string>([
  "--line-number", "--ignore-case", "--word-regexp", "--recursive",
  "--fixed-strings", "--case-sensitive", "--smart-case", "--no-heading",
  "--with-filename", "--color",
]);

/** Short boolean flags safe to bundle (`-rn`, `-rni`). Anything else — the
 *  reject flags (l/c/o/L/v) or arg-taking ones (A/B/C/m/e/g/d) — fails this and
 *  bails. */
const GREP_SAFE_SHORT = /^[niwrRFsSH]+$/;

/**
 * Parse a Bash command into the symbol it greps for — but ONLY when it is a
 * plain content-mode search of (what could be) a symbol: an `rg`/`grep` family
 * command, no shell control chars, no files/count/invert mode, no arg-taking or
 * unknown flags. Returns the (de-quoted) pattern, or null to pass through.
 * handleGrep's gates (SYMBOL_RE, ≥4 callers, …) decide whether to actually
 * intercept — this parser only guarantees "a content grep we can safely model".
 */
export function parseGrepBashCommand(command: string): string | null {
  if (!command || typeof command !== "string") return null;
  if (command.length > 300) return null;
  const trimmed = command.trim();
  if (trimmed !== command) return null;
  if (GREP_UNSAFE_SHELL.test(trimmed)) return null;

  const tokens = trimmed.split(/\s+/);
  if (tokens.length < 2) return null;
  if (!GREP_COMMANDS.has(tokens[0])) return null;

  let pattern: string | null = null;
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith("--")) {
      if (GREP_REJECT_FLAGS.has(t)) return null;
      if (t === "--regexp") {
        pattern = tokens[i + 1] ?? null;
        break;
      }
      if (GREP_SAFE_LONG.has(t)) continue;
      return null; // unknown / arg-taking long flag → bail
    }
    if (t.startsWith("-")) {
      if (GREP_REJECT_FLAGS.has(t)) return null;
      if (t === "-e") {
        pattern = tokens[i + 1] ?? null;
        break;
      }
      if (GREP_SAFE_SHORT.test(t.slice(1))) continue;
      return null; // reject/arg-taking short flag or bundle → bail
    }
    pattern = t; // first non-flag token is the pattern
    break;
  }
  if (pattern === null) return null;
  // Strip one layer of surrounding matching quotes.
  pattern = pattern.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  return pattern.length > 0 ? pattern : null;
}

/**
 * Handle a PreToolUse:Bash payload. Closes two shell bypasses by delegating to
 * the handler that owns the gates:
 *   - a single-file read (`cat`/`head`/`tail`) → handleRead
 *   - a content-mode symbol grep (`rg`/`grep`) → handleGrep (ADR-0005)
 * Any parse failure or unrecognised command resolves to passthrough.
 */
export async function handleBash(
  payload: BashHookPayload
): Promise<HandlerResult> {
  if (payload.tool_name !== "Bash") return PASSTHROUGH;

  const command = payload.tool_input?.command;
  if (!command || typeof command !== "string") return PASSTHROUGH;

  // (1) read-like → Read handler (owns exempt paths, kill switch, staleness,
  //     confidence, token-saving gate, dedup — we don't duplicate them).
  const filePath = parseReadLikeBashCommand(command);
  if (filePath !== null) {
    return handleRead({
      tool_name: "Read",
      cwd: payload.cwd,
      tool_input: { file_path: filePath },
    });
  }

  // (2) content-mode symbol grep → Grep handler. Reuses every v4.2 gate
  //     (ENGRAM_GREP_INTERCEPT opt-out, SYMBOL_RE + stopwords, content-mode,
  //     kill switch, ≥4 callers), the ADR-0004 call-site packet, and the
  //     `rg -n` escalation. No new graph / recall-safety logic here.
  const pattern = parseGrepBashCommand(command);
  if (pattern !== null) {
    return handleGrep({
      tool_name: "Grep",
      cwd: payload.cwd,
      tool_input: { pattern, output_mode: "content" },
    });
  }

  return PASSTHROUGH;
}
