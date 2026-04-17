/**
 * Generator for Cursor MDC (Markdown with Config) rule files.
 * Writes .cursor/rules/engram-context.mdc from the knowledge graph.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import type { GraphNode } from "../graph/schema.js";

export interface MdcResult {
  readonly filePath: string;
  readonly sections: number;
  readonly nodes: number;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Collect unique file extensions from file nodes to build glob patterns. */
function detectGlobs(fileNodes: GraphNode[]): string[] {
  const extCounts = new Map<string, number>();
  for (const n of fileNodes) {
    const match = n.sourceFile.match(/\.([^./]+)$/);
    if (match) {
      const ext = match[1];
      extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
    }
  }
  const exts = [...extCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([ext]) => ext);

  if (exts.length === 0) return ["src/**/*"];
  return exts.map((ext) => `src/**/*.${ext}`);
}

/** Format a single node label as a markdown bullet. */
function bullet(label: string): string {
  return `- ${label}`;
}

/** Build the MDC frontmatter block. */
function buildFrontmatter(globs: string[]): string {
  const globList = globs.map((g) => `"${g}"`).join(", ");
  return [
    "---",
    "description: engram-generated context spine — architecture, decisions, and known issues",
    "alwaysApply: false",
    `globs: [${globList}]`,
    "---",
  ].join("\n");
}

/** Build a section or return empty string if no items. */
function buildSection(heading: string, bullets: string[]): string {
  if (bullets.length === 0) return "";
  return [`## ${heading}`, "", ...bullets, ""].join("\n");
}

/**
 * Generate .cursor/rules/engram-context.mdc from the knowledge graph at
 * the given project path.
 */
export async function generateCursorMdc(
  projectPath: string
): Promise<MdcResult> {
  const { getStore } = await import("../core.js");
  const store = await getStore(projectPath);

  try {
    const allNodes = store.getAllNodes();
    const now = Date.now();
    const cutoff = now - THIRTY_DAYS_MS;

    // Architecture patterns — confidence >= 0.8, not hot_file metadata
    const patternBullets = allNodes
      .filter(
        (n) =>
          n.kind === "pattern" &&
          n.confidenceScore >= 0.8 &&
          (n.metadata as Record<string, unknown>).type !== "hot_file"
      )
      .map((n) => bullet(n.label));

    // Active decisions — last 30 days, sorted by lastVerified desc
    const decisionBullets = allNodes
      .filter((n) => n.kind === "decision" && n.lastVerified >= cutoff)
      .sort((a, b) => b.lastVerified - a.lastVerified)
      .map((n) => bullet(n.label));

    // Known landmines — top 5 mistakes by queryCount
    const mistakeBullets = allNodes
      .filter((n) => n.kind === "mistake")
      .sort((a, b) => b.queryCount - a.queryCount)
      .slice(0, 5)
      .map((n) => bullet(n.label));

    // Core entities — god nodes (top 10)
    const godNodes = store.getGodNodes(10);
    const godBullets = godNodes.map(
      ({ node, degree }) =>
        `- \`${node.label}\` (${node.kind}, ${degree} connections) — ${node.sourceFile}`
    );

    // Hot files — pattern nodes with metadata.type === 'hot_file'
    const hotFileBullets = allNodes
      .filter(
        (n) =>
          n.kind === "pattern" &&
          (n.metadata as Record<string, unknown>).type === "hot_file"
      )
      .map((n) => bullet(n.label));

    // Glob detection from file nodes
    const fileNodes = allNodes.filter((n) => n.kind === "file");
    const globs = detectGlobs(fileNodes);

    const sections = [
      buildSection("Architecture Patterns", patternBullets),
      buildSection("Active Decisions", decisionBullets),
      buildSection("Known Landmines", mistakeBullets),
      buildSection("Core Entities", godBullets),
      buildSection("Hot Files", hotFileBullets),
    ].filter((s) => s.length > 0);

    const content = [buildFrontmatter(globs), "", ...sections].join("\n");

    const outPath = join(projectPath, ".cursor", "rules", "engram-context.mdc");
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, content, "utf-8");

    const nodeCount =
      patternBullets.length +
      decisionBullets.length +
      mistakeBullets.length +
      godBullets.length +
      hotFileBullets.length;

    return { filePath: outPath, sections: sections.length, nodes: nodeCount };
  } finally {
    store.close();
  }
}
