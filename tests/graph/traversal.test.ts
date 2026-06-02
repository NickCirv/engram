import { describe, it, expect } from "vitest";
import { findCallers, findCallees, findImpact } from "../../src/graph/traversal.js";
import type { GraphEdge, GraphNode } from "../../src/graph/schema.js";

const n = (p: Pick<GraphNode, "id" | "label" | "kind" | "sourceFile">): GraphNode => ({
  sourceLocation: null,
  confidence: "EXTRACTED",
  confidenceScore: 0.85,
  lastVerified: 0,
  queryCount: 0,
  metadata: {},
  ...p,
});

const callsEdge = (source: string, target: string): GraphEdge => ({
  source,
  target,
  relation: "calls",
  confidence: "INFERRED",
  confidenceScore: 0.7,
  sourceFile: "",
  sourceLocation: null,
  lastVerified: 0,
  metadata: {},
});

// hub.ts defines hub(); a.ts defines aFn() and calls hub; b.ts calls hub + aFn.
const nodes: GraphNode[] = [
  n({ id: "fHub", label: "hub.ts", kind: "file", sourceFile: "src/hub.ts" }),
  n({ id: "fA", label: "a.ts", kind: "file", sourceFile: "src/a.ts" }),
  n({ id: "fB", label: "b.ts", kind: "file", sourceFile: "src/b.ts" }),
  n({ id: "dHub", label: "hub()", kind: "function", sourceFile: "src/hub.ts" }),
  n({ id: "dA", label: "aFn()", kind: "function", sourceFile: "src/a.ts" }),
];
const edges: GraphEdge[] = [
  callsEdge("fA", "dHub"), // a calls hub
  callsEdge("fB", "dHub"), // b calls hub
  callsEdge("fB", "dA"), // b calls aFn (in a.ts)
];

describe("findCallers", () => {
  it("returns the files that call a symbol (bare-name match)", () => {
    expect(findCallers(nodes, edges, "hub")).toEqual(["src/a.ts", "src/b.ts"]);
    expect(findCallers(nodes, edges, "hub()")).toEqual(["src/a.ts", "src/b.ts"]); // tolerates parens
  });
  it("returns [] for an unknown symbol", () => {
    expect(findCallers(nodes, edges, "nope")).toEqual([]);
  });
});

describe("findCallees", () => {
  it("returns what a symbol's file calls", () => {
    // aFn lives in a.ts, which calls hub
    expect(findCallees(nodes, edges, "aFn")).toEqual([{ name: "hub", file: "src/hub.ts" }]);
  });
  it("resolves a file path directly", () => {
    expect(findCallees(nodes, edges, "src/b.ts")).toEqual([
      { name: "aFn", file: "src/a.ts" },
      { name: "hub", file: "src/hub.ts" },
    ]);
  });
});

describe("findImpact", () => {
  it("returns files transitively affected by changing a symbol's file", () => {
    // changing hub (in hub.ts) affects a.ts + b.ts (both call into hub.ts)
    expect(findImpact(nodes, edges, "hub")).toEqual(["src/a.ts", "src/b.ts"]);
  });
  it("follows the dependency chain (changing aFn affects b.ts)", () => {
    expect(findImpact(nodes, edges, "aFn")).toEqual(["src/b.ts"]);
  });
  it("returns [] for a leaf with no dependants", () => {
    // b.ts defines nothing others call
    expect(findImpact(nodes, edges, "nope")).toEqual([]);
  });
});
