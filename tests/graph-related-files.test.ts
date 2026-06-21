/**
 * Tests for tiered related-files (src/graph/related-files.ts).
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
    const out = relatedFiles("src/a/focal.ts", ["src/b/far.ts", "src/a/sibling2.ts"], ALL, 5);
    expect(out.slice(0, 2)).toEqual(["src/b/far.ts", "src/a/sibling2.ts"]);
  });

  it("path-reach is appended after graph: test↔impl above same-dir siblings", () => {
    const out = relatedFiles("src/a/focal.ts", [], ALL, 5);
    // test↔impl (focal.test.ts, tests/focal.spec.ts) before plain siblings
    expect(out.indexOf("src/a/focal.test.ts")).toBeLessThan(out.indexOf("src/a/sibling1.ts"));
    expect(out.indexOf("tests/focal.spec.ts")).toBeLessThan(out.indexOf("src/a/sibling1.ts"));
  });

  it("de-duplicates across tiers and never includes the focal file", () => {
    // sibling2 is BOTH passed as graph-adjacent and a path sibling → appears once
    const out = relatedFiles("src/a/focal.ts", ["src/a/sibling2.ts"], ALL, 10);
    expect(out.filter((f) => f === "src/a/sibling2.ts")).toHaveLength(1);
    expect(out).not.toContain("src/a/focal.ts");
  });

  it("respects the limit, filling from graph first", () => {
    const out = relatedFiles("src/a/focal.ts", ["src/b/far.ts"], ALL, 2);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe("src/b/far.ts"); // graph hit kept its slot
  });

  it("limit <= 0 → empty", () => {
    expect(relatedFiles("src/a/focal.ts", ["src/b/far.ts"], ALL, 0)).toEqual([]);
  });

  it("no graph adjacency + no path reach → empty (never injects noise)", () => {
    expect(relatedFiles("src/lonely/only.ts", [], ["src/lonely/only.ts"], 5)).toEqual([]);
  });
});
