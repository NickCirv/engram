/** Core types for the engram knowledge graph */

export type Confidence = "EXTRACTED" | "INFERRED" | "AMBIGUOUS";

export interface GraphNode {
  readonly id: string;
  readonly label: string;
  readonly kind: NodeKind;
  readonly sourceFile: string;
  readonly sourceLocation: string | null;
  readonly confidence: Confidence;
  readonly confidenceScore: number;
  readonly lastVerified: number; // unix ms
  readonly queryCount: number;
  readonly metadata: Record<string, unknown>;
  /**
   * v3.0 bi-temporal validity (primarily for `mistake` nodes).
   * Unix-ms timestamp after which this node should NO LONGER surface in
   * context (e.g. the referenced code was refactored away). `undefined`
   * means "still valid" — this is the default for all existing rows and
   * for newly-mined mistakes that haven't been invalidated yet.
   */
  readonly validUntil?: number;
  /**
   * v3.0 audit trail. The git commit SHA that triggered invalidation
   * (set by the git miner when it detects the source file changed).
   * `undefined` if never invalidated.
   */
  readonly invalidatedByCommit?: string;
}

export type NodeKind =
  | "file"
  | "class"
  | "function"
  | "method"
  | "interface"
  | "type"
  | "variable"
  | "import"
  | "module"
  | "decision"
  | "pattern"
  | "mistake"
  | "concept";

export interface GraphEdge {
  readonly source: string;
  readonly target: string;
  readonly relation: EdgeRelation;
  readonly confidence: Confidence;
  readonly confidenceScore: number;
  readonly sourceFile: string;
  readonly sourceLocation: string | null;
  readonly lastVerified: number;
  readonly metadata: Record<string, unknown>;
}

export type EdgeRelation =
  | "calls"
  | "imports"
  | "contains"
  | "extends"
  | "implements"
  | "depends_on"
  | "tested_by"
  | "decided_because"
  | "similar_to"
  | "rationale_for"
  | "method_of"
  | "exports"
  // v0.2: skills-miner uses this to link keyword concept nodes to the
  // skill concept nodes they activate. Skills themselves use the existing
  // `similar_to` relation for cross-references (Related Skills sections).
  | "triggered_by";

export interface GraphStats {
  readonly nodes: number;
  readonly edges: number;
  readonly communities: number;
  readonly extractedPct: number;
  readonly inferredPct: number;
  readonly ambiguousPct: number;
  readonly lastMined: number;
  readonly totalQueryTokensSaved: number;
}
