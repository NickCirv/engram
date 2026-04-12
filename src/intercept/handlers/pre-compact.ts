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

export interface PreCompactHookPayload {
  readonly hook_event_name: "PreCompact" | string;
  readonly cwd: string;
}

/** Compact survival payload — fewer nodes than SessionStart, just essentials. */
const MAX_GOD_NODES_COMPACT = 5;
const MAX_LANDMINES_COMPACT = 3;

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

    // Use SessionStart response shape — PreCompact uses the same
    // additionalContext mechanism.
    return buildSessionContextResponse("SessionStart", text);
  } catch {
    return PASSTHROUGH;
  }
}
