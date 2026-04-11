/**
 * MEMORY.md integration — v0.3.1
 *
 * Anthropic shipped a native Claude Code memory system in March 2026:
 * a prose `MEMORY.md` file consolidated by a background "Auto-Dream"
 * sub-agent that prunes stale facts, merges overlaps, and indexes
 * what happened.
 *
 * This module makes engram COMPLEMENTARY to that system instead of
 * competing with it. engram writes its top-k structural facts (god
 * nodes, recent landmines, hot files, current git branch) into a
 * marker-bounded block inside MEMORY.md. Auto-Dream then consolidates
 * those alongside its own prose entries.
 *
 * Division of labor:
 *   - Anthropic's Auto-Dream owns the prose index: "we decided X",
 *     "the user prefers Y", narrative observations.
 *   - engram owns the structural facts: "god nodes are A, B, C",
 *     "recent landmines are D, E", "hot files are F, G, H".
 *
 * Engram's block is delimited by marker comments so Auto-Dream can
 * tell what it owns vs what engram owns, and engram can update its
 * section without touching anything else in the file.
 *
 * Design contracts:
 *   - NEVER clobber MEMORY.md content outside engram's markers.
 *   - NEVER write if the file is larger than a sanity cap (1 MB).
 *   - Atomic write: write to .tmp, then rename. Never partial state.
 *   - Silent failure: any error falls through to "did nothing".
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

/** The marker block engram owns in MEMORY.md. */
const ENGRAM_MARKER_START = "<!-- engram:structural-facts:start -->";
const ENGRAM_MARKER_END = "<!-- engram:structural-facts:end -->";

/** Sanity cap on MEMORY.md file size. */
const MAX_MEMORY_FILE_BYTES = 1_000_000;

/** Maximum size of engram's own section within MEMORY.md. */
const MAX_ENGRAM_SECTION_BYTES = 8_000;

/**
 * Generate the engram section body. Pure string builder — the caller
 * supplies the facts, we format them.
 */
export function buildEngramSection(facts: {
  readonly projectName: string;
  readonly branch: string | null;
  readonly stats: {
    readonly nodes: number;
    readonly edges: number;
    readonly extractedPct: number;
  };
  readonly godNodes: ReadonlyArray<{
    readonly label: string;
    readonly kind: string;
    readonly sourceFile: string;
  }>;
  readonly landmines: ReadonlyArray<{
    readonly label: string;
    readonly sourceFile: string;
  }>;
  readonly lastMined: number;
}): string {
  const lines: string[] = [];
  lines.push("## engram — structural facts");
  lines.push("");
  lines.push(
    `_Auto-maintained by engram. Do not edit inside the marker block — the next \`engram memory-sync\` overwrites it. This section complements Auto-Dream: Auto-Dream owns prose memory, engram owns the code graph._`
  );
  lines.push("");
  lines.push(`**Project:** ${facts.projectName}`);
  if (facts.branch) lines.push(`**Branch:** ${facts.branch}`);
  lines.push(
    `**Graph:** ${facts.stats.nodes} nodes, ${facts.stats.edges} edges, ${facts.stats.extractedPct}% extracted`
  );
  if (facts.lastMined > 0) {
    lines.push(
      `**Last mined:** ${new Date(facts.lastMined).toISOString()}`
    );
  }
  lines.push("");

  if (facts.godNodes.length > 0) {
    lines.push("### Core entities");
    for (const g of facts.godNodes.slice(0, 10)) {
      lines.push(`- \`${g.label}\` [${g.kind}] — ${g.sourceFile}`);
    }
    lines.push("");
  }

  if (facts.landmines.length > 0) {
    lines.push("### Known landmines");
    for (const m of facts.landmines.slice(0, 5)) {
      lines.push(`- **${m.sourceFile}** — ${m.label}`);
    }
    lines.push("");
  }

  lines.push(
    "_For the full graph, run `engram query \"...\"` or `engram gods`._"
  );

  return lines.join("\n");
}

/**
 * Compose a full MEMORY.md file with engram's section inserted or
 * updated. Preserves all content outside the marker block verbatim.
 *
 * Three cases:
 *   1. File doesn't exist → create with just the engram block
 *   2. File exists but has no engram markers → append at the end
 *   3. File exists and has engram markers → replace what's between them
 *
 * Pure function. No I/O.
 */
export function upsertEngramSection(
  existingContent: string,
  engramSection: string
): string {
  const block = `${ENGRAM_MARKER_START}\n${engramSection}\n${ENGRAM_MARKER_END}`;

  if (!existingContent) {
    // Empty or missing file — create with engram block
    return `# MEMORY.md\n\n${block}\n`;
  }

  const startIdx = existingContent.indexOf(ENGRAM_MARKER_START);
  const endIdx = existingContent.indexOf(ENGRAM_MARKER_END);

  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    // No engram markers — append at the end
    const trimmed = existingContent.trimEnd();
    return `${trimmed}\n\n${block}\n`;
  }

  // Markers present — replace content between them
  const before = existingContent.slice(0, startIdx);
  const after = existingContent.slice(endIdx + ENGRAM_MARKER_END.length);
  return `${before}${block}${after}`;
}

/**
 * Write the engram section to MEMORY.md for a project.
 *
 * Never throws. Returns true on successful write, false on any kind
 * of failure (file too large, write error, etc.).
 */
export function writeEngramSectionToMemoryMd(
  projectRoot: string,
  engramSection: string
): boolean {
  if (!projectRoot || typeof projectRoot !== "string") return false;
  if (engramSection.length > MAX_ENGRAM_SECTION_BYTES) {
    // Refuse to write a section that would blow through the budget
    return false;
  }

  const memoryPath = join(projectRoot, "MEMORY.md");

  try {
    // Read existing content if any
    let existing = "";
    if (existsSync(memoryPath)) {
      const st = statSync(memoryPath);
      if (st.size > MAX_MEMORY_FILE_BYTES) {
        // Safety: refuse to touch a file that's implausibly large
        return false;
      }
      existing = readFileSync(memoryPath, "utf-8");
    }

    const updated = upsertEngramSection(existing, engramSection);

    // Atomic write: temp file + rename
    const tmpPath = memoryPath + ".engram-tmp";
    writeFileSync(tmpPath, updated);
    renameSync(tmpPath, memoryPath);
    return true;
  } catch {
    return false;
  }
}

export { ENGRAM_MARKER_START, ENGRAM_MARKER_END, MAX_ENGRAM_SECTION_BYTES };
