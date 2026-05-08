import type { GraphNode, GraphEdge } from "../graph/schema.js";

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

function firstSentence(s: string): string {
  if (!s) return "";
  const m = s.trim().match(/([\s\S]{1,200}?[\.\!?])(\s|$)/);
  if (m) return m[1].trim();
  const line = s.split(/\r?\n/)[0] || s;
  return line.trim().slice(0, 200);
}

export function generateConclusionNodes(text: string, sourceLabel = "session-summary") {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  if (!text || typeof text !== "string") return { nodes, edges };

  const now = Date.now();
  // Build a high-level conclusion node (pattern) using the first sentence.
  const conclLabel = (firstSentence(text) || "Conclusion from session");
  // Use a canonical id for conclusions so repeated summaries map to the same
  // conceptual node across sessions.
  const conclId = computeCanonicalId(`Conclusion: ${conclLabel}`, "pattern", "project", null);
  const conclusionNode: GraphNode = {
    id: conclId,
    label: `Conclusion: ${conclLabel}`,
    kind: "pattern",
    sourceFile: sourceLabel,
    sourceLocation: null,
    confidence: "INFERRED",
    confidenceScore: 0.75,
    lastVerified: now,
    queryCount: 0,
    metadata: { miner: "conclusion", sourceLabel },
  };
  nodes.push(conclusionNode);

  // Split into fragments (sentences), cap at 20 fragments.
  const fragments = text
    .split(/[\n\.\!\?]+/) // naive split on sentence terminators/newlines
    .map((f) => f.trim())
    .filter((f) => f.length >= 20)
    .slice(0, 20);

  for (let i = 0; i < fragments.length; i++) {
    const frag = fragments[i];
    // Fragments are smaller and semantically transient; still use a
    // canonical id so identical fragments across summaries dedupe.
    const fragId = computeCanonicalId(frag.slice(0, 200), "concept", "project", null);
    const node: GraphNode = {
      id: fragId,
      label: frag.length > 300 ? frag.slice(0, 297) + "..." : frag,
      kind: "concept",
      sourceFile: sourceLabel,
      sourceLocation: null,
      confidence: "INFERRED",
      confidenceScore: 0.6,
      lastVerified: now,
      queryCount: 0,
      metadata: { miner: "conclusion-fragment", index: i, sourceLabel },
    };
    nodes.push(node);

    // Link fragment -> conclusion as rationale_for
    const edge: GraphEdge = {
      source: node.id,
      target: conclusionNode.id,
      relation: "rationale_for",
      confidence: "INFERRED",
      confidenceScore: 0.6,
      sourceFile: sourceLabel,
      sourceLocation: null,
      lastVerified: now,
      metadata: { auto: true },
    };
    edges.push(edge);
  }

  return { nodes, edges };
}
