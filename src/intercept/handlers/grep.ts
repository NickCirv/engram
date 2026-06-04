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
 *   - A deny response whose reason is engram's call-site list (the actual
 *     `file:line: code` lines that reference the symbol, from the files that
 *     call it), when the pattern is a known symbol with references.
 *   - PASSTHROUGH (null) otherwise — caller writes nothing, exits 0, the real
 *     Grep runs unchanged.
 * Never throws. Every error path resolves to PASSTHROUGH via wrapSafely.
 */
import { readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { PASSTHROUGH, isHookDisabled, type HandlerResult } from "../safety.js";
import { findProjectRoot, isValidCwd } from "../context.js";
import { buildDenyResponse } from "../formatter.js";
import { callers } from "../../core.js";

/** Bounds that keep the packet richer than a file list yet smaller than a raw
 *  repo-wide grep (ADR-0004). */
const MAX_CALLER_FILES = 15;
const MAX_SITES = 25;
const MAX_LINE_LEN = 140;
const MAX_FILE_BYTES = 1_000_000;
/** Below this many caller files a content grep is small enough that engram's
 *  packet + boilerplate would cost MORE than the grep it replaces — so pass
 *  through. The win scales with usage; this floors out the regressing tail. */
const MIN_CALLER_FILES = 4;

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

/** Token estimate — same ~4-chars/token heuristic the benches use. */
const estimateTokens = (t: string): number => Math.ceil(t.length / 4);

/**
 * A conservative token FLOOR for the content grep the agent would otherwise get,
 * sized against the AGENT'S OWN SCOPE (its cwd + `path` + `glob`) — not the whole
 * repo. `rg -wF` (word-boundary, fixed-string) is the FEWEST matches the agent
 * could see (its default substring grep returns at least as many). If engram's
 * repo-wide packet isn't smaller than this scoped floor, intercepting would cost
 * more tokens than the grep it replaces, so the handler passes through ("never
 * worse", ADR-0007). Returns:
 *   - the floor (0 when the scope has no matches),
 *   - `Number.MAX_SAFE_INTEGER` when the raw is too big to buffer/finish (a
 *     guaranteed win → caller intercepts),
 *   - `null` when it can't size safely (rg missing / unknown error) → caller
 *     must PASS THROUGH (never add tokens we can't justify). Never throws.
 */
function rawGrepFloorTokens(
  pattern: string,
  cwd: string,
  target: string,
  glob: string | undefined
): number | null {
  const args = ["-wF", "--no-heading", "--line-number"];
  if (glob) args.push("-g", glob);
  args.push("--", pattern, target);
  try {
    const out = execFileSync("rg", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 5000,
    });
    return estimateTokens(out);
  } catch (e) {
    const err = e as { status?: number; code?: string; killed?: boolean };
    if (err.status === 1) return 0; // no matches in the agent's scope
    if (err.code === "ENOBUFS" || err.killed) return Number.MAX_SAFE_INTEGER; // huge raw → real win
    return null; // rg missing / unknown → can't size the agent's scope → pass through
  }
}

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

  // (1b) Output-mode gate (ADR-0004): engram's call-site packet can only beat a
  // CONTENT grep (matching lines). The default `files_with_matches` and `count`
  // modes return just filenames / a number — cheaper than any packet — so for
  // those, pass through and let the agent's cheap grep run.
  if (payload.tool_input?.output_mode !== "content") return PASSTHROUGH;

  // (2) Resolve the project root from cwd (no file path on a Grep).
  const cwd = payload.cwd;
  if (typeof cwd !== "string" || !isValidCwd(cwd)) return PASSTHROUGH;
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) return PASSTHROUGH;

  // (3) Kill switch.
  if (isHookDisabled(projectRoot)) return PASSTHROUGH;

  // (4) Ask the reference graph who references this symbol. Fewer than
  // MIN_CALLER_FILES → a content grep would be small enough that engram's packet
  // would cost more; pass through. (0 callers = unknown / textual-only symbol.)
  const callerFiles = await callers(projectRoot, pattern);
  if (callerFiles.length < MIN_CALLER_FILES) return PASSTHROUGH;

  // (5) Pull the actual call-site lines from those files (ADR-0004) so the
  // packet answers "where/how is it used", not just "which files". If the scan
  // finds nothing (e.g. the edge came from dynamic dispatch the literal symbol
  // word doesn't appear), let the agent's grep run.
  const found = collectCallSites(projectRoot, callerFiles, pattern);
  if (found.sites.length === 0) return PASSTHROUGH;

  // (6) Never-worse size gate (ADR-0007, #82): the packet must actually be
  // smaller than the grep the agent would otherwise get. MIN_CALLER_FILES is only
  // a proxy. Crucially, size the floor against the AGENT'S scope (its cwd + path +
  // glob) — an agent grepping a subdir gets a small result the repo-wide packet
  // could exceed. We keep the promise only by comparing against what the agent
  // actually gets; when its scope can't be faithfully reproduced (a non-string
  // path/glob) or sized (rg missing), pass through.
  const ti = payload.tool_input ?? {};
  if (ti.path !== undefined && typeof ti.path !== "string") return PASSTHROUGH;
  if (ti.glob !== undefined && typeof ti.glob !== "string") return PASSTHROUGH;
  const answer = buildGrepAnswer(pattern, callerFiles.length, found);
  const rawFloor = rawGrepFloorTokens(
    pattern,
    cwd,
    typeof ti.path === "string" ? ti.path : ".",
    typeof ti.glob === "string" ? ti.glob : undefined
  );
  if (rawFloor === null) return PASSTHROUGH; // can't size the agent's scope → never-worse
  if (estimateTokens(answer) >= rawFloor) return PASSTHROUGH;

  return buildDenyResponse(answer);
}

interface CallSite {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}
interface CallSiteScan {
  readonly sites: readonly CallSite[];
  readonly filesOmitted: number;
  readonly truncated: boolean;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Scan the resolved caller files for the lines that reference `symbol`
 * (word-boundary) — the actual call sites the agent grepped for (ADR-0004).
 * Bounded so the packet stays smaller than a raw grep: at most MAX_CALLER_FILES
 * files, MAX_SITES lines, each trimmed to MAX_LINE_LEN; files > MAX_FILE_BYTES
 * are skipped. Best-effort — unreadable files are skipped, never throws.
 */
function collectCallSites(
  projectRoot: string,
  callerFiles: readonly string[],
  symbol: string
): CallSiteScan {
  // Identifier boundaries via lookarounds (not `\b`) so symbols containing `$`
  // (jQuery/legacy) anchor correctly — `\b` can't sit next to a non-word `$`.
  const re = new RegExp(`(?<![\\w$])${escapeRegExp(symbol)}(?![\\w$])`);
  const sites: CallSite[] = [];
  const scanFiles = callerFiles.slice(0, MAX_CALLER_FILES);
  const filesOmitted = callerFiles.length - scanFiles.length;
  let truncated = false;

  for (const rel of scanFiles) {
    if (sites.length >= MAX_SITES) {
      truncated = true;
      break;
    }
    let content: string;
    try {
      if (statSync(join(projectRoot, rel)).size > MAX_FILE_BYTES) continue;
      content = readFileSync(join(projectRoot, rel), "utf-8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (sites.length >= MAX_SITES) {
        truncated = true;
        break;
      }
      if (!re.test(lines[i])) continue;
      let text = lines[i].trim();
      if (text.length > MAX_LINE_LEN) text = text.slice(0, MAX_LINE_LEN) + "…";
      sites.push({ file: rel, line: i + 1, text });
    }
  }
  return { sites, filesOmitted, truncated };
}

/**
 * Render engram's call-site answer plus the explicit escalation path. The
 * escalation line is non-negotiable — it's what makes denying the grep
 * recall-safe (the agent can always get the full textual matches).
 */
function buildGrepAnswer(
  symbol: string,
  callerCount: number,
  scan: CallSiteScan
): string {
  const lines = scan.sites.map((s) => `  ${s.file}:${s.line}: ${s.text}`);
  const head =
    `[engram] "${symbol}" — ${scan.sites.length}${scan.truncated ? "+" : ""} ` +
    `call site(s) across ${callerCount} file(s) (resolved \`calls\` edges):`;
  // When capped, don't claim a specific omitted-file count — the line cap can
  // hit before all caller files are scanned, so any number would be wrong. Just
  // point at the rg escalation for the complete set.
  const capNote =
    scan.truncated || scan.filesOmitted > 0
      ? [`  … more call sites exist — run the rg command below for the complete set.`]
      : [];
  return [
    head,
    ...lines,
    ...capNote,
    "",
    "This is engram's structural answer — resolved references in files that " +
      "call the symbol. It may omit comments, strings, and dynamic references. " +
      `For a full textual search, run: rg -n "${symbol}"`,
  ].join("\n");
}
