/**
 * CCS importer — reads .context/index.md and creates KG nodes from its sections.
 * Each bullet point under a heading becomes one node with a kind derived from
 * the section heading.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { NodeKind } from "../graph/schema.js";

export interface CcsImportResult {
  readonly nodesCreated: number;
  readonly sectionsFound: number;
}

/** POSIX path for sourceFile metadata — must not use OS path separators. */
const CCS_SOURCE = "ccs:.context/index.md";

/** OS-native path for file I/O. */
const CCS_PATH = join(".context", "index.md");

/** Map a section heading to a NodeKind. */
function headingToKind(heading: string): NodeKind {
  const lower = heading.toLowerCase();
  if (lower.includes("decision")) return "decision";
  if (lower.includes("issue") || lower.includes("problem") || lower.includes("known issue")) return "mistake";
  if (
    lower.includes("architecture") ||
    lower.includes("design") ||
    lower.includes("convention") ||
    lower.includes("pattern")
  ) {
    return "pattern";
  }
  return "concept";
}

/** Extract bullet text from a line (strips leading `- ` or `* `). */
function parseBullet(line: string): string | null {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
    return trimmed.slice(2).trim();
  }
  return null;
}

export async function importCcs(projectRoot: string): Promise<CcsImportResult> {
  const filePath = join(projectRoot, CCS_PATH);
  if (!existsSync(filePath)) {
    return { nodesCreated: 0, sectionsFound: 0 };
  }

  const { getStore } = await import("../core.js");
  const store = await getStore(projectRoot);

  try {
    const raw = readFileSync(filePath, "utf-8");
    const lines = raw.replace(/\r\n/g, "\n").split("\n");

    let sectionsFound = 0;
    let nodesCreated = 0;
    let currentKind: NodeKind = "concept";

    for (const line of lines) {
      // Detect ## section headings (ignore # title)
      const headingMatch = line.match(/^##\s+(.+)/);
      if (headingMatch) {
        currentKind = headingToKind(headingMatch[1]);
        sectionsFound++;
        continue;
      }

      const bulletText = parseBullet(line);
      if (!bulletText) continue;

      store.upsertNode({
        id: randomUUID(),
        label: bulletText,
        kind: currentKind,
        sourceFile: CCS_SOURCE,
        sourceLocation: null,
        confidence: "EXTRACTED",
        confidenceScore: 0.9,
        lastVerified: Date.now(),
        queryCount: 0,
        metadata: {},
      });
      nodesCreated++;
    }

    store.save();
    return { nodesCreated, sectionsFound };
  } finally {
    store.close();
  }
}
