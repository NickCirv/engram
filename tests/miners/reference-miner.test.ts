import { describe, it, expect } from "vitest";
import {
  resolveCallEdges,
  extractFileReferences,
} from "../../src/miners/reference-miner.js";
import type { GraphNode } from "../../src/graph/schema.js";

function node(partial: Partial<GraphNode> & Pick<GraphNode, "id" | "label" | "kind" | "sourceFile">): GraphNode {
  return {
    sourceLocation: null,
    confidence: "EXTRACTED",
    confidenceScore: 0.85,
    lastVerified: 0,
    queryCount: 0,
    metadata: {},
    ...partial,
  };
}

describe("resolveCallEdges (pure)", () => {
  const fileA = node({ id: "fileA", label: "a.ts", kind: "file", sourceFile: "src/a.ts" });
  const fileB = node({ id: "fileB", label: "b.ts", kind: "file", sourceFile: "src/b.ts" });
  // Labels carry params exactly as the regex miner emits them (`foo()`),
  // while callee names from tree-sitter are bare (`foo`) — the resolver must
  // normalize so they match. (This mismatch shipped 0 edges until the e2e caught it.)
  const defFoo = node({ id: "def_foo", label: "foo()", kind: "function", sourceFile: "src/b.ts" });
  const defFooInA = node({ id: "def_foo_a", label: "foo(x)", kind: "function", sourceFile: "src/a.ts" });

  it("emits a cross-file calls edge from caller file to the def", () => {
    const edges = resolveCallEdges(
      [fileA, fileB, defFoo],
      new Map([["src/a.ts", ["foo", "unknownName"]]])
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: "fileA", target: "def_foo", relation: "calls" });
    expect(edges[0].metadata.provenance).toBe("heuristic");
  });

  it("skips intra-file references (no ranking signal)", () => {
    // a.ts references foo, and foo is ALSO defined in a.ts → no edge to the local one
    const edges = resolveCallEdges(
      [fileA, defFooInA],
      new Map([["src/a.ts", ["foo"]]])
    );
    expect(edges).toHaveLength(0);
  });

  it("resolves a name defined in multiple files to each (cross-file only)", () => {
    const edges = resolveCallEdges(
      [fileA, fileB, defFoo, defFooInA],
      new Map([["src/a.ts", ["foo"]]])
    );
    // only the def in b.ts is cross-file; the one in a.ts is skipped
    expect(edges).toHaveLength(1);
    expect(edges[0].target).toBe("def_foo");
  });

  it("dedups and caps per file", () => {
    const defs = Array.from({ length: 100 }, (_, i) =>
      node({ id: `d${i}`, label: `f${i}`, kind: "function", sourceFile: "src/b.ts" })
    );
    const names = defs.map((d) => d.label).concat(defs.map((d) => d.label)); // dup names
    const edges = resolveCallEdges([fileA, ...defs], new Map([["src/a.ts", names]]), {
      maxPerFile: 60,
    });
    expect(edges.length).toBeLessThanOrEqual(60);
    const ids = new Set(edges.map((e) => e.target));
    expect(ids.size).toBe(edges.length); // no dup targets
  });

  it("skips a file with no file node", () => {
    const edges = resolveCallEdges([defFoo], new Map([["src/ghost.ts", ["foo"]]]));
    expect(edges).toHaveLength(0);
  });

  it("resolves GENERIC function labels (review A#4: foo<T>(x) → foo)", () => {
    const defWrap = node({ id: "def_wrap", label: "wrap<T>(x: T)", kind: "function", sourceFile: "src/b.ts" });
    const edges = resolveCallEdges([fileA, defWrap], new Map([["src/a.ts", ["wrap"]]]));
    expect(edges).toHaveLength(1);
    expect(edges[0].target).toBe("def_wrap");
  });

  it("skips too-ambiguous names defined in many files (review A#3)", () => {
    const defs = Array.from({ length: 11 }, (_, i) =>
      node({ id: `c${i}`, label: "common()", kind: "function", sourceFile: `src/f${i}.ts` })
    );
    const edges = resolveCallEdges([fileA, ...defs], new Map([["src/a.ts", ["common"]]]));
    expect(edges).toHaveLength(0); // >10 defs ⇒ noise, not a real call
  });
});

describe("extractFileReferences (tree-sitter)", () => {
  it("extracts callee names from calls, member calls, and instantiation", async () => {
    const src = `
      function g() {
        foo();
        obj.bar();
        a.b.deepCall();
        const x = new Baz();
        return x;
      }
    `;
    const names = await extractFileReferences("sample.ts", src);
    expect(names).toContain("foo");
    expect(names).toContain("bar");
    expect(names).toContain("deepCall");
    expect(names).toContain("Baz");
  });

  it("returns [] for unsupported file types", async () => {
    expect(await extractFileReferences("notes.txt", "foo() bar()")).toEqual([]);
  });

  it("keeps single-char callees like $ and _ (review A#5)", async () => {
    const names = await extractFileReferences("s.ts", "function g(){ $('x'); _([1]); }");
    expect(names).toContain("$");
    expect(names).toContain("_");
  });
});
