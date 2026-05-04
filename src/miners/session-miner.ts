/**
 * Session Miner — extracts decisions, patterns, and mistakes from AI session transcripts.
 * This is the "learning" part — your AI gets smarter with every conversation.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import type { GraphNode, GraphEdge } from "../graph/schema.js";

interface SessionMineResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const DECISION_PATTERNS = [
  /(?:decided|chose|picked|selected|went with|using|switched to)\s+(\w[\w\s-]{2,30})\s+(?:over|instead of|rather than|because|for|since)/gi,
  /(?:don't|do not|never|avoid|stop)\s+(?:use|using)\s+(\w[\w\s-]{2,30})/gi,
  /(?:always|must|should)\s+(?:use|prefer)\s+(\w[\w\s-]{2,30})/gi,
];

const MISTAKE_PATTERNS = [
  /(?:bug|issue|problem|error|broke|breaking|failed|crash):\s*(.{10,80})/gi,
  /(?:fix|fixed|resolved|solved):\s*(.{10,80})/gi,
  /(?:caused by|root cause|the issue was)\s+(.{10,80})/gi,
];

const PATTERN_PATTERNS = [
  /(?:pattern|convention|approach|technique|strategy):\s*(.{10,80})/gi,
  /(?:we use|our approach|the way we|standard is)\s+(.{10,60})/gi,
];

import { computeCanonicalId } from "../graph/canonical.js";

function makeId(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join("_")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase()
    .slice(0, 60);
}

function mineText(text: string, sourceFile: string): SessionMineResult {
  const now = Date.now();
  const nodes: GraphNode[] = [];
  const seenLabels = new Set<string>();

  const addIfNew = (label: string, kind: GraphNode["kind"], confidence: number): void => {
    const normalized = label.trim().toLowerCase();
    if (seenLabels.has(normalized) || normalized.length < 5) return;
    seenLabels.add(normalized);
    // Compute canonical id for learned session-level concepts so duplicates
    // across sessions and summaries map to the same entity.
    const canonical = computeCanonicalId(label.trim(), kind, "project", null);
    nodes.push({
      id: canonical,
      label: label.trim(),
      kind,
      sourceFile,
      sourceLocation: null,
      confidence: "INFERRED",
      confidenceScore: confidence,
      lastVerified: now,
      queryCount: 0,
      metadata: { miner: "session" },
    });
  };

  for (const pattern of DECISION_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (match[1]) addIfNew(match[1], "decision", 0.7);
    }
  }

  for (const pattern of MISTAKE_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (match[1]) addIfNew(match[1], "mistake", 0.6);
    }
  }

  for (const pattern of PATTERN_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (match[1]) addIfNew(match[1], "pattern", 0.65);
    }
  }

  return { nodes, edges: [] };
}

export function mineSessionHistory(projectRoot: string): SessionMineResult {
  const allNodes: GraphNode[] = [];
  const allEdges: GraphEdge[] = [];

  const sources = [
    join(projectRoot, "CLAUDE.md"),
    join(projectRoot, ".claude", "CLAUDE.md"),
    join(projectRoot, "AGENTS.md"),
    join(projectRoot, ".cursorrules"),
    join(projectRoot, ".cursor", "rules"),
  ];

  for (const source of sources) {
    if (existsSync(source)) {
      try {
        const { nodes, edges } = mineText(readFileSync(source, "utf-8"), basename(source));
        allNodes.push(...nodes);
        allEdges.push(...edges);
      } catch { /* skip */ }
    }
  }

  const sessionsDir = join(projectRoot, ".engram", "sessions");
  if (existsSync(sessionsDir)) {
    try {
      for (const file of readdirSync(sessionsDir).filter((f) => f.endsWith(".md"))) {
        const { nodes, edges } = mineText(
          readFileSync(join(sessionsDir, file), "utf-8"),
          `sessions/${file}`
        );
        allNodes.push(...nodes);
        allEdges.push(...edges);
      }
    } catch { /* skip */ }
  }

  return { nodes: allNodes, edges: allEdges };
}

export function learnFromSession(text: string, sourceLabel = "session"): SessionMineResult {
  return mineText(text, sourceLabel);
}
