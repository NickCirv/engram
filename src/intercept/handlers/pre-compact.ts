/**
 * PreCompact hook handler — re-injects critical structural context
 * right before Claude Code compresses the conversation.
 *
 * When context is compacted, the agent loses the SessionStart brief,
 * prior engram summaries, and any accumulated structural understanding.
 * This handler fires at the last moment before compression and re-injects
 * a survival payload: god nodes, recent mistakes, and hot files.
 *
 * This is the hook that makes engram's context survive compaction —
 * no other tool in the ecosystem does this.
 *
 * Mechanism: hookSpecificOutput.additionalContext → survives into the
 * compacted context as a system-reminder.
 */
import { basename, resolve } from "node:path";
import { godNodes, mistakes, stats } from "../../core.js";
import { findProjectRoot, isValidCwd } from "../context.js";
import { isHookDisabled, PASSTHROUGH, type HandlerResult } from "../safety.js";
import { buildSessionContextResponse } from "../formatter.js";
import { clearServedReads, exploredFiles } from "../served-reads.js";

export interface PreCompactHookPayload {
  readonly hook_event_name: "PreCompact" | string;
  readonly cwd: string;
  /** Claude Code session id — used to reset same-session read dedup (ADR-0003). */
  readonly session_id?: string;
}

/** Compact survival payload — fewer nodes than SessionStart, just essentials. */
const MAX_GOD_NODES_COMPACT = 5;
const MAX_LANDMINES_COMPACT = 3;
/** Most-recently-read files to remind the agent of post-compaction (#84). */
const MAX_EXPLORED = 8;

/**
 * Build the "previously read this session" block (#84) — a tight list of the
 * files this session read, so the post-compaction agent re-reads only what
 * changed instead of re-deriving structure it already saw.
 *
 * Path-only on purpose (adversarial review): if the agent re-reads, its OWN Read
 * interception gives the CURRENT structural summary — listing graph symbols here
 * would assert as-of-last-index facts as current (an over-claim), and the
 * arbitrary top-N added noise, not signal. "read", not "explored": these are
 * files read, not greps (grep isn't tracked). "" if no files.
 */
function formatExplored(files: readonly string[]): string {
  if (files.length === 0) return "";
  return [
    "Previously read this session (re-read if changed):",
    ...files.map((f) => `  - ${f}`),
  ].join("\n");
}

/**
 * Format a compact survival brief — tighter than the SessionStart brief
 * because we're injecting into a context that's about to be compressed.
 * Every token here costs double.
 */
function formatCompactBrief(args: {
  readonly projectName: string;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly godNodes: ReadonlyArray<{
    readonly label: string;
    readonly kind: string;
    readonly sourceFile: string;
  }>;
  readonly landmines: ReadonlyArray<{
    readonly label: string;
    readonly sourceFile: string;
  }>;
}): string {
  const lines: string[] = [];

  lines.push(
    `[engram] Compaction survival — ${args.projectName} (${args.nodeCount} nodes, ${args.edgeCount} edges)`
  );

  if (args.godNodes.length > 0) {
    lines.push("Key entities:");
    for (const g of args.godNodes) {
      lines.push(`  - ${g.label} [${g.kind}] — ${g.sourceFile}`);
    }
  }

  if (args.landmines.length > 0) {
    lines.push("Active landmines:");
    for (const m of args.landmines) {
      lines.push(`  - ${m.sourceFile}: ${m.label}`);
    }
  }

  lines.push(
    "engram is active — Read/Edit/Write interception continues after compaction."
  );

  return lines.join("\n");
}

/**
 * Handle a PreCompact hook payload. Re-injects the structural survival
 * payload so critical context persists through compaction.
 */
export async function handlePreCompact(
  payload: PreCompactHookPayload
): Promise<HandlerResult> {
  if (payload.hook_event_name !== "PreCompact") return PASSTHROUGH;

  const cwd = payload.cwd;
  if (!isValidCwd(cwd)) return PASSTHROUGH;

  const projectRoot = findProjectRoot(cwd);
  if (projectRoot === null) return PASSTHROUGH;

  // #84: read the session exploration ledger BEFORE clearServedReads wipes it,
  // so we can remind the post-compaction agent what it already explored. Opt-out
  // via ENGRAM_COMPACT_LEDGER=0. (Only explicit /compact fires PreCompact —
  // silent volume overflow does not, so this covers explicit compaction only.)
  const explored =
    process.env.ENGRAM_COMPACT_LEDGER === "0" || typeof payload.session_id !== "string"
      ? []
      : exploredFiles(projectRoot, payload.session_id, MAX_EXPLORED);

  // ADR-0003: compaction evicts the content a read-dedup pointer refers to, so
  // reset this session's served-read set — post-compaction reads must re-serve.
  // Done before the kill-switch check: the reset is a correctness operation,
  // independent of whether we inject the survival brief.
  if (typeof payload.session_id === "string") {
    clearServedReads(projectRoot, payload.session_id);
  }

  if (isHookDisabled(projectRoot)) return PASSTHROUGH;

  try {
    const [gods, mistakeList, graphStats] = await Promise.all([
      godNodes(projectRoot, MAX_GOD_NODES_COMPACT).catch(() => []),
      mistakes(projectRoot, { limit: MAX_LANDMINES_COMPACT }).catch(
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
    ]);

    if (graphStats.nodes === 0 && gods.length === 0) return PASSTHROUGH;

    const projectName = basename(resolve(projectRoot));

    const text = formatCompactBrief({
      projectName,
      nodeCount: graphStats.nodes,
      edgeCount: graphStats.edges,
      godNodes: gods.map((g) => ({
        label: g.label,
        kind: g.kind,
        sourceFile: g.sourceFile,
      })),
      landmines: mistakeList.map((m) => ({
        label: m.label,
        sourceFile: m.sourceFile,
      })),
    });

    // #84: append the "previously read" ledger block (built from the files
    // captured before the wipe above) so the post-compaction agent re-reads only
    // what changed.
    const exploredBlock = formatExplored(explored);
    const fullText = exploredBlock ? text + "\n" + exploredBlock : text;

    // Use SessionStart response shape — PreCompact uses the same
    // additionalContext mechanism.
    return buildSessionContextResponse("SessionStart", fullText);
  } catch {
    return PASSTHROUGH;
  }
}
