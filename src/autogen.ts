/**
 * Auto-gen — generate AI instruction files from the knowledge graph.
 * Writes sections to CLAUDE.md, .cursorrules, or AGENTS.md so your AI
 * assistant navigates via structure instead of keyword grepping.
 *
 * v0.2: data-driven Views.
 * Instead of hardcoded per-task branching, `generateSummary` takes a `View`
 * — a list of `SectionSpec` rows ({section, limit, heading}) that drive the
 * section builders table. Adding a new task mode is adding a row to VIEWS,
 * not editing function branches.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GraphStore } from "./graph/store.js";
import type { GraphNode } from "./graph/schema.js";

const AUTOGEN_START = "<!-- engram:start -->";
const AUTOGEN_END = "<!-- engram:end -->";

// ─── View data model ────────────────────────────────────────────────────────

export type SectionKind =
  | "gods"
  | "hotFiles"
  | "mistakes"
  | "decisions"
  | "patterns"
  | "deps"
  | "structure";

export interface SectionSpec {
  section: SectionKind;
  /** Max items to include. Ignored for `structure` (always renders full tree). */
  limit: number;
  heading: string;
}

export interface View {
  name: string;
  sections: SectionSpec[];
}

// ─── Section builders ───────────────────────────────────────────────────────
// Each builder returns the formatted body for its section (no heading),
// or an empty string if there's nothing worth rendering.

const SECTION_BUILDERS: Record<
  SectionKind,
  (store: GraphStore, limit: number) => string
> = {
  gods: (store, limit) => {
    const gods = store.getGodNodes(limit);
    if (gods.length === 0) return "";
    return gods
      .map(
        (g) =>
          `- \`${g.node.label}\` (${g.node.kind}, ${g.degree} connections) — ${g.node.sourceFile}`
      )
      .join("\n");
  },

  // Hot files are produced by git-miner as `kind: "pattern"` nodes with
  // `metadata.type === "hot_file"`. We surface them separately so the
  // Patterns section only contains real session-mined patterns.
  hotFiles: (store, limit) => {
    const allNodes = store.getAllNodes();
    const hot = allNodes
      .filter(
        (n) =>
          n.kind === "pattern" &&
          (n.metadata as Record<string, unknown> | undefined)?.type ===
            "hot_file"
      )
      .sort((a, b) => {
        const ac =
          ((a.metadata as Record<string, unknown>).changeCount as number) ?? 0;
        const bc =
          ((b.metadata as Record<string, unknown>).changeCount as number) ?? 0;
        return bc - ac;
      })
      .slice(0, limit);
    if (hot.length === 0) return "";
    return hot.map((n) => `- ${n.label}`).join("\n");
  },

  mistakes: (store, limit) => {
    const mistakes = store
      .getAllNodes()
      .filter((n) => n.kind === "mistake")
      .slice(0, limit);
    if (mistakes.length === 0) return "";
    return mistakes.map((m) => `- ${m.label}`).join("\n");
  },

  decisions: (store, limit) => {
    const decisions = store
      .getAllNodes()
      .filter((n) => n.kind === "decision")
      .slice(0, limit);
    if (decisions.length === 0) return "";
    return decisions.map((d) => `- ${d.label}`).join("\n");
  },

  // "Real" patterns = kind:pattern nodes that are NOT hot files.
  // Hot files live in their own section so they don't clutter this one.
  patterns: (store, limit) => {
    const patterns = store
      .getAllNodes()
      .filter((n) => {
        if (n.kind !== "pattern") return false;
        const meta = n.metadata as Record<string, unknown> | undefined;
        return meta?.type !== "hot_file";
      })
      .slice(0, limit);
    if (patterns.length === 0) return "";
    return patterns.map((p) => `- ${p.label}`).join("\n");
  },

  deps: (store, limit) => {
    const allEdges = store.getAllEdges();
    const importEdges = allEdges.filter((e) => e.relation === "imports");
    const mostImported = new Map<string, number>();
    for (const edge of importEdges) {
      mostImported.set(edge.target, (mostImported.get(edge.target) ?? 0) + 1);
    }
    const topImported = [...mostImported.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
    if (topImported.length === 0) return "";
    return topImported
      .map(([target, count]) => {
        const node = store.getNode(target);
        return `- \`${node?.label ?? target}\` (imported by ${count} files)`;
      })
      .join("\n");
  },

  // `limit` is intentionally unused — the structure section always renders
  // the full file tree. A 0 or positive limit is legal ceremony in the
  // SectionSpec because every other builder honors it.
  structure: (store, _limit) => {
    void _limit;
    const filesByDir = new Map<string, string[]>();
    for (const node of store.getAllNodes()) {
      if (node.kind !== "file" || !node.sourceFile) continue;
      const parts = node.sourceFile.split("/");
      const dir = parts.slice(0, -1).join("/") || ".";
      if (!filesByDir.has(dir)) filesByDir.set(dir, []);
      filesByDir.get(dir)!.push(node.label);
    }
    if (filesByDir.size === 0) return "";
    return [...filesByDir.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dir, files]) => `- \`${dir}/\` — ${files.join(", ")}`)
      .join("\n");
  },
};

// ─── Preset views (one row per task type) ──────────────────────────────────
//
// Adding a new task = adding a row to this record. No branching in the
// render function. Section limits of 0 are treated as "omit" because a
// zero-limit section by definition can't contain anything worth showing.

export const VIEWS: Record<string, View> = {
  general: {
    name: "general",
    sections: [
      { section: "gods", limit: 8, heading: "Core entities" },
      { section: "structure", limit: 0, heading: "Structure" },
      { section: "mistakes", limit: 5, heading: "⚠️ Past mistakes" },
      { section: "decisions", limit: 5, heading: "Decisions" },
      { section: "patterns", limit: 5, heading: "Patterns" },
      { section: "deps", limit: 5, heading: "Key dependencies" },
    ],
  },
  "bug-fix": {
    name: "bug-fix",
    sections: [
      { section: "hotFiles", limit: 10, heading: "🔥 Hot files" },
      { section: "mistakes", limit: 10, heading: "⚠️ Past mistakes" },
      { section: "gods", limit: 5, heading: "Core entities" },
      { section: "structure", limit: 0, heading: "Structure" },
      { section: "patterns", limit: 5, heading: "Patterns" },
    ],
  },
  feature: {
    name: "feature",
    sections: [
      { section: "gods", limit: 12, heading: "Core entities" },
      { section: "structure", limit: 0, heading: "Structure" },
      { section: "decisions", limit: 10, heading: "Decisions" },
      { section: "deps", limit: 5, heading: "Key dependencies" },
      { section: "mistakes", limit: 3, heading: "⚠️ Past mistakes" },
    ],
  },
  refactor: {
    name: "refactor",
    sections: [
      { section: "gods", limit: 15, heading: "Core entities" },
      { section: "structure", limit: 0, heading: "Structure" },
      { section: "deps", limit: 10, heading: "Key dependencies" },
      { section: "patterns", limit: 10, heading: "Patterns" },
      { section: "mistakes", limit: 5, heading: "⚠️ Past mistakes" },
    ],
  },
};

// ─── Main entry point ───────────────────────────────────────────────────────

/**
 * Generate a compact architecture summary from the graph, driven by a View.
 * Defaults to the `general` view if none is provided (backwards compatible
 * with v0.1 callers that passed no view argument).
 */
export function generateSummary(
  store: GraphStore,
  view: View = VIEWS.general
): string {
  const stats = store.getStats();

  const parts: string[] = [
    AUTOGEN_START,
    "## Codebase Structure (auto-generated by engram)",
    "",
    `**Graph:** ${stats.nodes} nodes, ${stats.edges} edges | ${stats.extractedPct}% extracted, ${stats.inferredPct}% inferred`,
    `**View:** ${view.name}`,
    "",
  ];

  for (const spec of view.sections) {
    const builder = SECTION_BUILDERS[spec.section];
    if (!builder) continue;
    const body = builder(store, spec.limit);
    if (!body) continue;
    parts.push(`## ${spec.heading}`, "", body, "");
  }

  parts.push(
    "**Tip:** Run `engram query \"your question\"` for structural context instead of reading files.",
    AUTOGEN_END
  );

  return parts.join("\n");
}

/**
 * Analyze the marker state of a file's contents so we can decide how to
 * merge in a new engram section without corrupting user content.
 *
 * We walk the file line-by-line tracking markdown code-fence depth. Markers
 * inside a fenced code block are NOT treated as real engram markers (they
 * might be documentation showing what the markers look like). Only markers
 * at fence depth 0 count.
 *
 * States:
 * - `none` — no real markers, safe to append
 * - `balanced` — exactly one start followed by one end, safe to in-place
 *   replace between the char offsets (preserves both above and below)
 * - `unbalanced` — any other count/ordering of markers. We refuse to write
 *   and throw a descriptive error rather than silently corrupting the file.
 */
interface MarkerAnalysis {
  state: "none" | "balanced" | "unbalanced";
  startOffset?: number;
  endOffset?: number;
  error?: string;
}

function analyzeMarkers(content: string): MarkerAnalysis {
  const realStarts: number[] = [];
  const realEnds: number[] = [];
  let fenceDepth = 0;
  let pos = 0;
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trimStart();
    // Toggle fence state on lines that begin a fenced code block.
    // Both ``` and ~~~ are valid markdown fence openers.
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      fenceDepth = fenceDepth === 0 ? 1 : 0;
      pos += line.length + 1; // +1 for the \n we split on
      continue;
    }

    if (fenceDepth === 0) {
      const startAt = line.indexOf(AUTOGEN_START);
      if (startAt !== -1) realStarts.push(pos + startAt);
      const endAt = line.indexOf(AUTOGEN_END);
      if (endAt !== -1) realEnds.push(pos + endAt);
    }

    pos += line.length + 1;
  }

  if (realStarts.length === 0 && realEnds.length === 0) {
    return { state: "none" };
  }

  if (
    realStarts.length === 1 &&
    realEnds.length === 1 &&
    realStarts[0] < realEnds[0]
  ) {
    return {
      state: "balanced",
      startOffset: realStarts[0],
      endOffset: realEnds[0] + AUTOGEN_END.length,
    };
  }

  return {
    state: "unbalanced",
    error: `Found ${realStarts.length} start marker(s) and ${realEnds.length} end marker(s) outside code fences; expected exactly 1 of each. Fix the markers manually.`,
  };
}

/**
 * Write or update the engram section in an AI instruction file.
 *
 * Preserves user content above and below the markers. Refuses to write
 * (and throws) if markers are unbalanced — better to crash loud than
 * silently corrupt a user's CLAUDE.md.
 */
export function writeToFile(filePath: string, summary: string): void {
  let content = "";
  if (existsSync(filePath)) {
    content = readFileSync(filePath, "utf-8");
  }

  const analysis = analyzeMarkers(content);

  if (analysis.state === "unbalanced") {
    throw new Error(
      `engram: cannot safely update ${filePath}: ${analysis.error} Re-run engram gen after fixing the markers.`
    );
  }

  let newContent: string;
  if (analysis.state === "balanced") {
    // In-place replacement — preserves content above and below the markers
    newContent =
      content.slice(0, analysis.startOffset!) +
      summary +
      content.slice(analysis.endOffset!);
  } else {
    // No markers present — append after existing content with a blank line
    // separator. Collapses trailing whitespace, ensures trailing newline.
    const trimmed = content.trimEnd();
    newContent = (trimmed ? trimmed + "\n\n" : "") + summary + "\n";
  }

  // Guarantee exactly one trailing newline regardless of branch taken
  if (!newContent.endsWith("\n")) newContent += "\n";

  writeFileSync(filePath, newContent);
}

/**
 * Auto-generate AI instructions for a project.
 *
 * v3.0 behavior: when no explicit `target` is given, emits BOTH `CLAUDE.md`
 * AND `AGENTS.md` so the same project works in Claude Code AND in any
 * AGENTS.md-aware tool (Codex CLI, Cursor, Windsurf, Copilot Chat,
 * JetBrains Junie, Antigravity). Existing `.cursorrules` is also updated
 * if present so legacy Cursor users aren't broken.
 *
 * Explicit `target` (claude / cursor / agents) preserves single-file
 * behavior for users who want it.
 *
 * v0.2: optional `task` selects a preset View from VIEWS. Unknown task
 * names throw with a descriptive error listing the valid keys.
 */
export async function autogen(
  projectRoot: string,
  target?: "claude" | "cursor" | "agents",
  task?: string
): Promise<{ files: string[]; nodesIncluded: number; view: string }> {
  const { getStore } = await import("./core.js");
  const store = await getStore(projectRoot);

  try {
    let view: View = VIEWS.general;
    if (task) {
      const found = VIEWS[task];
      if (!found) {
        const valid = Object.keys(VIEWS).join(", ");
        throw new Error(
          `engram gen: unknown task "${task}". Valid: ${valid}.`
        );
      }
      view = found;
    }

    const summary = generateSummary(store, view);
    const stats = store.getStats();

    const targetFiles: string[] = [];
    if (target === "claude") {
      targetFiles.push(join(projectRoot, "CLAUDE.md"));
    } else if (target === "cursor") {
      targetFiles.push(join(projectRoot, ".cursorrules"));
    } else if (target === "agents") {
      targetFiles.push(join(projectRoot, "AGENTS.md"));
    } else {
      // Auto: emit BOTH CLAUDE.md AND AGENTS.md. AGENTS.md is the Linux
      // Foundation universal standard (Codex/Cursor/Windsurf/Copilot/Junie);
      // CLAUDE.md remains the canonical Claude Code instruction file.
      // Both must be kept in sync — single-source-of-truth via the same
      // generated `summary`.
      targetFiles.push(join(projectRoot, "CLAUDE.md"));
      targetFiles.push(join(projectRoot, "AGENTS.md"));
      // If a legacy .cursorrules exists, update it too — don't break
      // existing Cursor users who haven't migrated to AGENTS.md.
      const cursorRules = join(projectRoot, ".cursorrules");
      if (existsSync(cursorRules)) {
        targetFiles.push(cursorRules);
      }
    }

    for (const f of targetFiles) {
      writeToFile(f, summary);
    }
    return { files: targetFiles, nodesIncluded: stats.nodes, view: view.name };
  } finally {
    store.close();
  }
}
