/**
 * PostToolUse:Bash handler — widens auto-reindex to cover Bash file ops.
 *
 * Closes issue #14. When an agent runs `rm src/foo.ts` / `mv a.ts b.ts` /
 * `git rm`, the existing Edit|Write|MultiEdit matcher misses it and
 * the graph drifts out of sync with disk. This handler parses a whitelist
 * of file-mutating Bash commands and synthesizes reindex events.
 *
 * Philosophy (mirrors handlers/bash.ts PreToolUse parser):
 *   - STRICT parser. Anything ambiguous passes through untouched.
 *   - Silent-skip on non-code paths, non-indexed files, ignored dirs.
 *   - Never blocks Claude Code — errors resolve to "no-op".
 *
 * Supported shapes:
 *   rm [-rf] <path>                        -> prune
 *   rm [-rf] <path1> <path2> ...           -> prune each
 *   mv <src> <dst>                         -> prune src, reindex dst
 *   cp <src> <dst>                         -> reindex dst
 *   git rm [-r] <path>                     -> prune
 *   git mv <src> <dst>                     -> prune src, reindex dst
 *   cat <source> > <dst>   (1 redirect)    -> reindex dst
 *   echo <x> > <dst>       (1 redirect)    -> reindex dst
 *
 * Intentionally NOT supported (pass-through):
 *   - globs, pipes, subshells, backticks, command substitution
 *   - `touch` (empty file, nothing to index)
 *   - directory-level ops (need prefix-prune primitive — v2.2 territory)
 */
import { isAbsolute, resolve as pathResolve } from "node:path";

export interface FileOp {
  readonly action: "reindex" | "prune";
  readonly path: string; // ABSOLUTE, resolved against cwd
}

const MAX_COMMAND_LEN = 500;
const BASIC_UNSAFE = /[|&;()$`*?[\]{}"']/;
const SUBSHELL = /\$\(|`|<\(|>\(/;

export function parseFileOps(
  command: string,
  cwd: string
): readonly FileOp[] {
  if (!command || typeof command !== "string") return [];
  if (command.length > MAX_COMMAND_LEN) return [];
  if (SUBSHELL.test(command)) return [];

  const trimmed = command.trim();
  if (!trimmed) return [];

  // Single redirection: split into [left] > [right] only if exactly one
  // redirect and the left side has no unsafe metacharacters.
  const redirectMatch = /\s+(>>?)\s+(\S+)\s*$/.exec(trimmed);
  if (redirectMatch) {
    const head = trimmed.slice(0, redirectMatch.index);
    const dest = redirectMatch[2];
    if (BASIC_UNSAFE.test(head)) return [];
    if (dest.startsWith("-") || dest.length === 0) return [];
    return [{ action: "reindex", path: absolutize(dest, cwd) }];
  }

  if (BASIC_UNSAFE.test(trimmed)) return [];

  const tokens = trimmed.split(/\s+/);
  if (tokens.length === 0) return [];

  const first = tokens[0];

  if (first === "git" && tokens.length >= 3) {
    const sub = tokens[1];
    if (sub === "rm") return parseRm(tokens.slice(2), cwd);
    if (sub === "mv") return parseMv(tokens.slice(2), cwd);
    return [];
  }

  if (first === "rm") return parseRm(tokens.slice(1), cwd);
  if (first === "mv") return parseMv(tokens.slice(1), cwd);
  if (first === "cp") return parseCp(tokens.slice(1), cwd);

  return [];
}

function absolutize(path: string, cwd: string): string {
  if (isAbsolute(path)) return path;
  return pathResolve(cwd, path);
}

function isFlagLike(tok: string): boolean {
  return tok.startsWith("-");
}

function parseRm(args: readonly string[], cwd: string): readonly FileOp[] {
  const paths = args.filter((t) => !isFlagLike(t));
  if (paths.length === 0) return [];
  return paths.map((p) => ({ action: "prune" as const, path: absolutize(p, cwd) }));
}

function parseMv(args: readonly string[], cwd: string): readonly FileOp[] {
  const paths = args.filter((t) => !isFlagLike(t));
  if (paths.length !== 2) return [];
  const [src, dst] = paths;
  return [
    { action: "prune", path: absolutize(src, cwd) },
    { action: "reindex", path: absolutize(dst, cwd) },
  ];
}

function parseCp(args: readonly string[], cwd: string): readonly FileOp[] {
  const paths = args.filter((t) => !isFlagLike(t));
  if (paths.length !== 2) return [];
  const [, dst] = paths;
  return [{ action: "reindex", path: absolutize(dst, cwd) }];
}

export interface BashPostToolPayload {
  readonly tool_name: string;
  readonly tool_input?: { readonly command?: string };
  readonly cwd: string;
}

export interface BashReindexResult {
  readonly ops: readonly FileOp[];
}

export function handleBashPostTool(
  payload: BashPostToolPayload
): BashReindexResult {
  if (payload.tool_name !== "Bash") return { ops: [] };
  const cmd = payload.tool_input?.command;
  if (!cmd || typeof cmd !== "string") return { ops: [] };
  try {
    const ops = parseFileOps(cmd, payload.cwd);
    return { ops };
  } catch {
    return { ops: [] };
  }
}
