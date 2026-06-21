/**
 * Tests for tiered related-files (src/graph/related-files.ts).
 * Signature: relatedFiles(focal, graphAdjacent, coChange, allFiles, limit)
 */
import { describe, it, expect } from "vitest";
import { relatedFiles } from "../src/graph/related-files.js";

const ALL = [
  "src/a/focal.ts",
  "src/a/focal.test.ts",
  "src/a/sibling1.ts",
  "src/a/sibling2.ts",
  "src/b/far.ts",
  "tests/focal.spec.ts",
];

describe("relatedFiles", () => {
  it("graph-adjacent files come FIRST, in caller order (never-worse: graph hits keep their slots)", () => {
    const out = relatedFiles("src/a/focal.ts", ["src/b/far.ts", "src/a/sibling2.ts"], [], ALL, 5);
    expect(out.slice(0, 2)).toEqual(["src/b/far.ts", "src/a/sibling2.ts"]);
  });

  it("co-change is Tier 2: after graph, before path-reach", () => {
    // focal has one graph hit, one co-change file (a cross-dir config), and path siblings.
    const out = relatedFiles(
      "src/a/focal.ts",
      ["src/b/far.ts"],
      ["prisma/schema.prisma"],
      ALL,
      5
    );
    expect(out[0]).toBe("src/b/far.ts"); // graph first
    expect(out[1]).toBe("prisma/schema.prisma"); // co-change second (reaches cross-dir)
    // path-reach (test↔impl, siblings) comes after the co-change file
    expect(out.indexOf("prisma/schema.prisma")).toBeLessThan(out.indexOf("src/a/sibling1.ts"));
  });

  it("co-change never displaces a graph hit (never-worse)", () => {
    const out = relatedFiles("src/a/focal.ts", ["src/b/far.ts"], ["co/x.ts"], ALL, 1);
    expect(out).toEqual(["src/b/far.ts"]); // limit 1 → only the graph hit
  });

  it("path-reach is appended after co-change: test↔impl above same-dir siblings", () => {
    const out = relatedFiles("src/a/focal.ts", [], [], ALL, 5);
    expect(out.indexOf("src/a/focal.test.ts")).toBeLessThan(out.indexOf("src/a/sibling1.ts"));
    expect(out.indexOf("tests/focal.spec.ts")).toBeLessThan(out.indexOf("src/a/sibling1.ts"));
  });

  it("de-duplicates across ALL tiers and never includes the focal file", () => {
    // sibling2 appears as graph-adjacent, co-change, AND a path sibling → once.
    const out = relatedFiles(
      "src/a/focal.ts",
      ["src/a/sibling2.ts"],
      ["src/a/sibling2.ts"],
      ALL,
      10
    );
    expect(out.filter((f) => f === "src/a/sibling2.ts")).toHaveLength(1);
    expect(out).not.toContain("src/a/focal.ts");
  });

  it("respects the limit, filling from graph first then co-change", () => {
    const out = relatedFiles("src/a/focal.ts", ["src/b/far.ts"], ["co/x.ts"], ALL, 2);
    expect(out).toEqual(["src/b/far.ts", "co/x.ts"]);
  });

  it("limit <= 0 → empty", () => {
    expect(relatedFiles("src/a/focal.ts", ["src/b/far.ts"], [], ALL, 0)).toEqual([]);
  });

  it("no graph adjacency + no co-change + no path reach → empty (never injects noise)", () => {
    expect(relatedFiles("src/lonely/only.ts", [], [], ["src/lonely/only.ts"], 5)).toEqual([]);
  });
});
