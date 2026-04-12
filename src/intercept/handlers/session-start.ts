/**
 * SessionStart hook handler — injects a project brief at session start
 * so the agent doesn't burn tokens on initial exploration reads.
 *
 * Replaces 3-5 "let me look around the codebase" Reads with a compact
 * ~500-800 token brief covering:
 *   - Project name and git branch
 *   - Graph stats (nodes, edges, last-mined timestamp)
 *   - Top 10 god nodes (most-connected entities)
 *   - Top 3 recent landmines (past mistakes worth knowing about upfront)
 *
 * Mechanism: empirically verified via hook protocol spec.
 *   hookSpecificOutput.additionalContext → added to session context
 *
 * Source-field handling (from the hook payload):
 *   - startup  → inject (fresh session needs context)
 *   - clear    → inject (context was cleared)
 *   - compact  → inject (compaction may have dropped key nodes)
 *   - resume   → PASSTHROUGH (session already has prior context)
 */
import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, dirname, join, resolve } from "node:path";

const execFileAsync = promisify(execFile);
import { godNodes, mistakes, stats } from "../../core.js";
import { findProjectRoot, isValidCwd } from "../context.js";
import { isHookDisabled, PASSTHROUGH, type HandlerResult } from "../safety.js";
import { buildSessionContextResponse } from "../formatter.js";

export interface SessionStartHookPayload {
  readonly hook_event_name: "SessionStart" | string;
  readonly cwd: string;
  readonly source?: "startup" | "resume" | "clear" | "compact" | string;
}

/** Max god nodes in the brief — more than this gets noisy. */
const MAX_GOD_NODES = 10;

/** Max landmines surfaced in the brief — just the highlights. */
const MAX_LANDMINES_IN_BRIEF = 3;

/**
 * Read the current git branch from `.git/HEAD`. Fast (no subprocess),
 * no shell escape surface, handles detached HEAD and missing-git cases
 * gracefully.
 *
 * Returns the branch name, "detached" for detached HEAD, or null if
 * the project is not a git repo or the HEAD file is unreadable.
 */
function readGitBranch(projectRoot: string): string | null {
  try {
    // Walk up in case projectRoot is inside a submodule or a subdir.
    // Most projects will hit .git/HEAD on the first try.
    let current = resolve(projectRoot);
    for (let depth = 0; depth < 10; depth++) {
      const headPath = join(current, ".git", "HEAD");
      if (existsSync(headPath)) {
        const content = readFileSync(headPath, "utf-8").trim();
        const refMatch = content.match(/^ref:\s+refs\/heads\/(.+)$/);
        if (refMatch) return refMatch[1];
        // Detached HEAD — content is a commit SHA.
        if (/^[0-9a-f]{7,40}$/i.test(content)) return "detached";
        return null;
      }
      const parent = dirname(current);
      if (parent === current) return null;
      current = parent;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Format the brief into the text that gets injected as
 * additionalContext. Kept compact — the token budget for SessionStart
 * is wider than per-hook injections but still respectable.
 */
function formatBrief(args: {
  readonly projectName: string;
  readonly branch: string | null;
  readonly stats: {
    readonly nodes: number;
    readonly edges: number;
    readonly extractedPct: number;
    readonly lastMined: number;
  };
  readonly godNodes: ReadonlyArray<{
    readonly label: string;
    readonly kind: string;
    readonly degree: number;
    readonly sourceFile: string;
  }>;
  readonly landmines: ReadonlyArray<{
    readonly label: string;
    readonly sourceFile: string;
  }>;
}): string {
  const lines: string[] = [];

  // Header: project + branch + mining timestamp.
  const minedAgo =
    args.stats.lastMined > 0
      ? describeAgo(Date.now() - args.stats.lastMined)
      : "unknown";
  const branchStr = args.branch ? ` (branch: ${args.branch})` : "";
  lines.push(`[engram] Project brief for ${args.projectName}${branchStr}`);
  lines.push(
    `Graph: ${args.stats.nodes} nodes, ${args.stats.edges} edges, ${args.stats.extractedPct}% extracted. Last mined: ${minedAgo}.`
  );
  lines.push("");

  // God nodes block.
  if (args.godNodes.length > 0) {
    lines.push("Core entities (most connected):");
    for (const g of args.godNodes) {
      lines.push(
        `  - ${g.label} [${g.kind}] (${g.degree} conn) — ${g.sourceFile}`
      );
    }
    lines.push("");
  }

  // Landmines block.
  if (args.landmines.length > 0) {
    lines.push("Known landmines (past issues to watch for):");
    for (const m of args.landmines) {
      lines.push(`  - ${m.sourceFile}: ${m.label}`);
    }
    lines.push("");
  }

  lines.push(
    "Tip: engram intercepts Read/Edit/Write/Bash tool calls. Code structure " +
      "comes through the graph automatically; you don't need to explore files " +
      "to understand layout. Use explicit offset/limit on Read if you need raw lines."
  );

  return lines.join("\n");
}

/**
 * Query mempalace for semantic context about this project. Returns a
 * compact summary of top findings, or null if mempalace is unavailable.
 *
 * Graceful degradation: if the `mcp-mempalace` CLI isn't installed,
 * the command fails, or it returns nothing useful, this returns null
 * and the SessionStart brief proceeds without semantic context.
 *
 * Uses execFile (no shell, async) to avoid command injection and blocking.
 * Timeout: 1.5s hard cap — runs in parallel with graph queries.
 */
async function queryMempalace(projectName: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "mcp-mempalace",
      ["mempalace-search", "--query", projectName],
      { timeout: 1500, encoding: "utf-8" }
    );
    const trimmed = stdout.trim();
    if (!trimmed || trimmed.length < 20) return null;

    // Parse the output — mempalace returns JSON with a results array.
    try {
      const parsed = JSON.parse(trimmed);
      const results = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.results)
          ? parsed.results
          : [];
      if (results.length === 0) return null;

      const lines: string[] = ["[mempalace] Recent context:"];
      for (const r of results.slice(0, 3)) {
        const content =
          typeof r === "string"
            ? r
            : typeof r?.content === "string"
              ? r.content
              : typeof r?.document === "string"
                ? r.document
                : null;
        if (content) {
          const short =
            content.length > 120
              ? content.slice(0, 117) + "..."
              : content;
          lines.push(`  - ${short}`);
        }
      }
      return lines.length > 1 ? lines.join("\n") : null;
    } catch {
      // Not JSON — use raw output, truncated.
      const maxLen = 400;
      const capped =
        trimmed.length > maxLen
          ? trimmed.slice(0, maxLen - 3) + "..."
          : trimmed;
      return `[mempalace] ${capped}`;
    }
  } catch {
    // mcp-mempalace not installed, timed out, or errored. Silent.
    return null;
  }
}

/** Human-readable "N ago" for a millisecond duration. */
function describeAgo(ms: number): string {
  if (ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/**
 * Handle a SessionStart hook payload. Injects the project brief as
 * additionalContext when the source indicates a fresh/cleared/compacted
 * session. Passes through on resume.
 */
export async function handleSessionStart(
  payload: SessionStartHookPayload
): Promise<HandlerResult> {
  if (payload.hook_event_name !== "SessionStart") return PASSTHROUGH;

  // Skip resumed sessions — they already have prior context.
  const source = payload.source ?? "startup";
  if (source === "resume") return PASSTHROUGH;

  // cwd must be a real absolute directory. Anything else causes
  // findProjectRoot to walk from the ambient process cwd, which could
  // hallucinate a project root from the wrong location.
  const cwd = payload.cwd;
  if (!isValidCwd(cwd)) return PASSTHROUGH;

  // Find the project root from cwd. Unlike Read/Edit/Write, we don't
  // have a specific file to walk up from — we use cwd directly.
  const projectRoot = findProjectRoot(cwd);
  if (projectRoot === null) return PASSTHROUGH;

  // Kill switch.
  if (isHookDisabled(projectRoot)) return PASSTHROUGH;

  try {
    // Compose the brief from existing core APIs. Any failure in any
    // of these three queries resolves to an empty array / default
    // stats, which still produces a valid (if sparse) brief.
    const branch = readGitBranch(projectRoot);
    const projectName = basename(projectRoot);

    // Run graph queries AND mempalace in parallel — mempalace is
    // async (execFile) so it doesn't block the event loop.
    const [gods, mistakeList, graphStats, mempalaceContext] = await Promise.all([
      godNodes(projectRoot, MAX_GOD_NODES).catch(() => []),
      mistakes(projectRoot, { limit: MAX_LANDMINES_IN_BRIEF }).catch(
        () => [] as Array<{ label: string; sourceFile: string }>
      ),
      stats(projectRoot).catch(() => ({
        nodes: 0,
        edges: 0,
        communities: 0,
        extractedPct: 0,
        inferredPct: 0,
        ambiguousPct: 0,
        lastMined: 0,
        totalQueryTokensSaved: 0,
      })),
      queryMempalace(projectName),
    ]);

    // If the graph is empty, there's nothing useful to inject.
    if (graphStats.nodes === 0 && gods.length === 0) return PASSTHROUGH;

    const text = formatBrief({
      projectName,
      branch,
      stats: {
        nodes: graphStats.nodes,
        edges: graphStats.edges,
        extractedPct: graphStats.extractedPct,
        lastMined: graphStats.lastMined,
      },
      godNodes: gods,
      landmines: mistakeList.map((m) => ({
        label: m.label,
        sourceFile: m.sourceFile,
      })),
    });

    // Bundle mempalace semantic context alongside the structural brief.
    // engram provides structure, mempalace provides decisions/learnings.
    const fullText = mempalaceContext
      ? text + "\n\n" + mempalaceContext
      : text;

    return buildSessionContextResponse("SessionStart", fullText);
  } catch {
    // Any composition error → passthrough. Sessions must never fail
    // to start because engram couldn't build a brief.
    return PASSTHROUGH;
  }
}
