/**
 * SubagentStart hook handler (ADR-0008, Frontier F1 #83) — the sub-agent
 * context broker.
 *
 * Multi-agent fan-out is the one regime prompt caching can't help: each spawned
 * sub-agent opens a FRESH context window and pays a FRESH cache WRITE, so caching
 * never shares the parent's context with the child. We inject a TIGHT structural
 * slice into each sub-agent — the project's top-ranked entities + graph shape —
 * so it can orient without the grep→read discovery fan-out. Because every
 * sub-agent pays the write, that per-agent reduction multiplies by N — WHEN the
 * slice displaces more exploration than it costs (the conditional #85 measures).
 *
 * HONEST framing (do not drift): this is a STRUCTURAL context reduction, not a
 * cost claim. It only nets a saving when the slice (~150–250 tokens) is smaller
 * than the exploration it lets the sub-agent skip — which the recall→resolve
 * benchmark (#85) is what proves per workload. We keep the slice deliberately
 * small to stay on the right side of that line.
 *
 * Deliberately minimal vs SessionStart: top-5 god nodes + graph shape only — no
 * landmines, no mempalace bundle, no provider warmup (sub-agents are short-lived
 * and the write cost is what we're minimising). Opt-out: ENGRAM_SUBAGENT_CONTEXT=0.
 *
 * Delivery note: the SubagentStart hook fires inside the sub-agent's context in
 * Claude Code's Agent SDK (agent_id/agent_type are populated there). That a
 * SHELL hook's additionalContext is injected for SubagentStart must be smoke-
 * tested in a real Claude Code sub-agent run before claiming end-to-end delivery;
 * engram's side (this handler) is verified via simulated events.
 */
import { basename } from "node:path";
import { godNodes, stats, relatedFilesFor } from "../../core.js";
import { exploredFiles } from "../served-reads.js";
import { findProjectRoot, isValidCwd } from "../context.js";
import { isHookDisabled, PASSTHROUGH, type HandlerResult } from "../safety.js";
import { buildSessionContextResponse } from "../formatter.js";

/** Tighter than SessionStart's 10 — the write cost is what we're minimising. */
const SUBAGENT_GOD_NODES = 5;
/** Fetch extra god nodes so test-file entities can be filtered out before the
 *  top-5: a "start here" slice that points a sub-agent at a test helper misleads it. */
const RAW_GOD_NODES = 15;
/** Tiered related files for the parent's most-recent focus (#139). Small — the
 *  slice stays tight; this is a "you'll likely also need" hint, not a file list. */
const RELATED_FILES = 4;
const IS_TEST_PATH = /(^|\/)(tests?|__tests__|spec)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/i;

export interface SubagentStartHookPayload {
  readonly hook_event_name?: string;
  readonly cwd?: string;
  /** Populated by Claude Code when the hook fires inside a sub-agent. */
  readonly agent_id?: string;
  readonly agent_type?: string;
  /** Harness session id, when the payload carries one. Used to seed the focal
   *  file from the parent's most-recent reads (#139). Shared parent↔child
   *  session is a runtime assumption gated on the #86 smoke-test. */
  readonly session_id?: string;
}

/** The tight slice text. Self-labelled so it's clearly engram and dismissable. */
function formatSlice(
  projectName: string,
  graphStats: { readonly nodes: number; readonly edges: number },
  gods: ReadonlyArray<{ readonly label: string; readonly kind: string; readonly degree: number; readonly sourceFile: string }>,
  focus: { readonly file: string; readonly related: readonly string[] } | null
): string {
  const lines = [
    `[engram] Sub-agent map for ${projectName} — ${graphStats.nodes} nodes, ${graphStats.edges} edges.`,
  ];
  if (gods.length > 0) {
    lines.push("Top entities (most connected — start here instead of re-exploring):");
    for (const g of gods) {
      lines.push(`  - ${g.label} [${g.kind}] (${g.degree} conn) — ${g.sourceFile}`);
    }
  }
  // Focal-file reach (#139): the parent was last working in `focus.file`; surface
  // the files most likely needed alongside it so the sub-agent skips the discovery
  // fan-out. Only rendered when there's something to show (never-worse).
  if (focus && focus.related.length > 0) {
    lines.push(`Related to the parent's recent focus (${focus.file}) — likely also needed:`);
    for (const f of focus.related) lines.push(`  - ${f}`);
  }
  return lines.join("\n");
}

/**
 * Build the focal-reach block: the parent's most-recently-read file + its tiered
 * related files. Returns null when there's no usable focal (no session id, no
 * recorded reads, or the focal yields no related files) so the caller renders the
 * god-node slice unchanged. Never throws.
 */
async function buildFocus(
  projectRoot: string,
  sessionId: string | undefined
): Promise<{ file: string; related: string[] } | null> {
  if (typeof sessionId !== "string" || sessionId.length === 0) return null;
  try {
    const recent = exploredFiles(projectRoot, sessionId, 1); // most-recent first
    const focal = recent[0];
    if (!focal) return null;
    const related = await relatedFilesFor(projectRoot, focal, RELATED_FILES);
    return related.length > 0 ? { file: focal, related } : null;
  } catch {
    return null;
  }
}

export async function handleSubagentStart(
  payload: SubagentStartHookPayload
): Promise<HandlerResult> {
  if (payload.hook_event_name !== "SubagentStart") return PASSTHROUGH;
  // Opt-out — on by default so the saving lands without configuration.
  if (process.env.ENGRAM_SUBAGENT_CONTEXT === "0") return PASSTHROUGH;

  const cwd = payload.cwd;
  if (typeof cwd !== "string" || !isValidCwd(cwd)) return PASSTHROUGH;
  const projectRoot = findProjectRoot(cwd);
  if (projectRoot === null) return PASSTHROUGH;
  if (isHookDisabled(projectRoot)) return PASSTHROUGH;

  try {
    const [rawGods, graphStats] = await Promise.all([
      godNodes(projectRoot, RAW_GOD_NODES).catch(() => []),
      stats(projectRoot).catch(() => null),
    ]);
    // Prefer production entities — point the sub-agent at code, not test helpers.
    // Fall back to the unfiltered set only if filtering would empty it.
    const filtered = rawGods.filter((g) => !IS_TEST_PATH.test(g.sourceFile));
    const gods = (filtered.length > 0 ? filtered : rawGods).slice(0, SUBAGENT_GOD_NODES);
    // Focal-file reach (#139): seed from the parent's most-recently-read file (if
    // the session is shared parent↔child — #86), then surface its tiered related
    // files. Every step degrades to null/empty so the slice is never-worse.
    const focus = await buildFocus(projectRoot, payload.session_id);
    // Nothing useful to inject → pass through (never inject an empty/noise slice).
    if (!graphStats || (graphStats.nodes === 0 && gods.length === 0)) return PASSTHROUGH;
    const text = formatSlice(basename(projectRoot), graphStats, gods, focus);
    return buildSessionContextResponse("SubagentStart", text);
  } catch {
    // A sub-agent must never fail to start because engram couldn't build a slice.
    return PASSTHROUGH;
  }
}
