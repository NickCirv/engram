import { describe, it, expect } from "vitest";
import { pageRank, type PageRankEdge } from "../../src/graph/pagerank.js";

describe("pageRank (pure)", () => {
  it("returns empty for no nodes", () => {
    expect(pageRank([], []).size).toBe(0);
  });

  it("ranks a referenced-by-important node highest", () => {
    // A -> B, A -> C, B -> C.  C is referenced by A and B; B only by A.
    const edges: PageRankEdge[] = [
      { source: "A", target: "B" },
      { source: "A", target: "C" },
      { source: "B", target: "C" },
    ];
    const r = pageRank(["A", "B", "C"], edges);
    expect(r.get("C")!).toBeGreaterThan(r.get("B")!);
    expect(r.get("B")!).toBeGreaterThan(r.get("A")!); // A has no incoming
  });

  it("scores sum to ~1 and are finite", () => {
    const edges: PageRankEdge[] = [
      { source: "A", target: "B" },
      { source: "B", target: "C" },
      { source: "C", target: "A" },
    ];
    const r = pageRank(["A", "B", "C"], edges);
    const sum = [...r.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(0.95);
    expect(sum).toBeLessThan(1.05);
    for (const v of r.values()) expect(Number.isFinite(v)).toBe(true);
  });

  it("handles a dangling node (no out-edges) without NaN", () => {
    const edges: PageRankEdge[] = [{ source: "A", target: "B" }]; // B dangles
    const r = pageRank(["A", "B"], edges);
    for (const v of r.values()) expect(Number.isFinite(v)).toBe(true);
    expect(r.get("B")!).toBeGreaterThan(r.get("A")!);
  });

  it("ignores self-loops and out-of-set edges", () => {
    const edges: PageRankEdge[] = [
      { source: "A", target: "A" }, // self-loop
      { source: "A", target: "Z" }, // Z not in node set
      { source: "A", target: "B" },
    ];
    const r = pageRank(["A", "B"], edges);
    expect(r.has("Z")).toBe(false);
    expect(Number.isFinite(r.get("A")!)).toBe(true);
  });

  it("personalization biases the ranking toward seeded nodes", () => {
    const edges: PageRankEdge[] = [
      { source: "A", target: "B" },
      { source: "B", target: "A" },
    ];
    const plain = pageRank(["A", "B"], edges);
    const biased = pageRank(["A", "B"], edges, {
      personalization: new Map([["A", 1]]),
    });
    expect(biased.get("A")!).toBeGreaterThan(plain.get("A")!);
  });

  it("respects edge weight (heavier edge sends more rank)", () => {
    // A points to B (heavy) and C (light); B should outrank C.
    const edges: PageRankEdge[] = [
      { source: "A", target: "B", weight: 10 },
      { source: "A", target: "C", weight: 1 },
    ];
    const r = pageRank(["A", "B", "C"], edges);
    expect(r.get("B")!).toBeGreaterThan(r.get("C")!);
  });
});
