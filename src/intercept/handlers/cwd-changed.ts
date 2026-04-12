/**
 * CwdChanged hook handler — auto-switches project context when the user
 * navigates to a different directory mid-session.
 *
 * Without this, a user who `cd`s to a different project would get
 * interceptions from the wrong graph (or no interceptions at all if
 * the new directory has no .engram/).
 *
 * This handler detects the new project root, injects a compact brief
 * for the new location, and ensures subsequent tool calls route to
 * the correct graph.
 *
 * Mechanism: hookSpecificOutput.additionalContext → informs the agent
 * that the project context has changed.
 */
import { basename, resolve } from "node:path";
import { godNodes, stats } from "../../core.js";
import { findProjectRoot, isValidCwd } from "../context.js";
import { isHookDisabled, PASSTHROUGH, type HandlerResult } from "../safety.js";
import { buildSessionContextResponse } from "../formatter.js";

/** Max god nodes in the switch brief. */
const MAX_GOD_NODES_SWITCH = 5;

export interface CwdChangedHookPayload {
  readonly hook_event_name: "CwdChanged" | string;
  readonly cwd: string;
}

/**
 * Handle a CwdChanged hook payload. When the new directory has an engram
 * graph, inject a brief context switch message so the agent knows
 * which project it's now in.
 */
export async function handleCwdChanged(
  payload: CwdChangedHookPayload
): Promise<HandlerResult> {
  if (payload.hook_event_name !== "CwdChanged") return PASSTHROUGH;

  const cwd = payload.cwd;
  if (!isValidCwd(cwd)) return PASSTHROUGH;

  const projectRoot = findProjectRoot(cwd);
  if (projectRoot === null) return PASSTHROUGH;

  if (isHookDisabled(projectRoot)) return PASSTHROUGH;

  try {
    const [gods, graphStats] = await Promise.all([
      godNodes(projectRoot, MAX_GOD_NODES_SWITCH).catch(() => []),
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

    if (graphStats.nodes === 0) return PASSTHROUGH;

    const projectName = basename(resolve(projectRoot));
    const lines: string[] = [];
    lines.push(
      `[engram] Project switched to ${projectName} (${graphStats.nodes} nodes, ${graphStats.edges} edges)`
    );
    if (gods.length > 0) {
      lines.push("Core entities:");
      for (const g of gods.slice(0, MAX_GOD_NODES_SWITCH)) {
        lines.push(`  - ${g.label} [${g.kind}] — ${g.sourceFile}`);
      }
    }
    lines.push(
      "engram interception is active for this project."
    );

    return buildSessionContextResponse("SessionStart", lines.join("\n"));
  } catch {
    return PASSTHROUGH;
  }
}
