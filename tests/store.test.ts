import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GraphStore } from "../src/graph/store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { GraphNode, GraphEdge } from "../src/graph/schema.js";

function makeNode(id: string, overrides?: Partial<GraphNode>): GraphNode {
  return {
    id,
    label: id,
    kind: "function",
    sourceFile: "test.ts",
    sourceLocation: "L1",
    confidence: "EXTRACTED",
    confidenceScore: 1.0,
    lastVerified: Date.now(),
    queryCount: 0,
    metadata: {},
    ...overrides,
  };
}

function makeEdge(source: string, target: string, overrides?: Partial<GraphEdge>): GraphEdge {
  return {
    source,
    target,
    relation: "calls",
    confidence: "EXTRACTED",
    confidenceScore: 1.0,
    sourceFile: "test.ts",
    sourceLocation: "L1",
    lastVerified: Date.now(),
    metadata: {},
    ...overrides,
  };
}

describe("GraphStore", () => {
  let tmpDir: string;
  let store: GraphStore;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "engram-test-"));
    store = await GraphStore.open(join(tmpDir, "test.db"));
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("node operations", () => {
    it("upserts and retrieves a node", () => {
      const node = makeNode("func_a", { label: "funcA()" });
      store.upsertNode(node);
      const retrieved = store.getNode("func_a");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.label).toBe("funcA()");
      expect(retrieved!.kind).toBe("function");
    });

    it("overwrites on duplicate id", () => {
      store.upsertNode(makeNode("x", { label: "first" }));
      store.upsertNode(makeNode("x", { label: "second" }));
      expect(store.getNode("x")!.label).toBe("second");
    });

    it("returns null for missing node", () => {
      expect(store.getNode("nonexistent")).toBeNull();
    });

    it("searches nodes by label", () => {
      store.upsertNode(makeNode("auth_login", { label: "login()" }));
      store.upsertNode(makeNode("auth_logout", { label: "logout()" }));
      store.upsertNode(makeNode("db_query", { label: "query()" }));

      const results = store.searchNodes("login");
      expect(results.length).toBe(1);
      expect(results[0].label).toBe("login()");
    });

    it("searches nodes by id", () => {
      store.upsertNode(makeNode("auth_handler", { label: "handle()" }));
      const results = store.searchNodes("auth");
      expect(results.length).toBe(1);
    });
  });

  describe("edge operations", () => {
    it("upserts and retrieves edges via neighbors", () => {
      store.upsertNode(makeNode("a"));
      store.upsertNode(makeNode("b"));
      store.upsertEdge(makeEdge("a", "b"));

      const neighbors = store.getNeighbors("a");
      expect(neighbors.length).toBe(1);
      expect(neighbors[0].node.id).toBe("b");
      expect(neighbors[0].edge.relation).toBe("calls");
    });

    it("returns neighbors from both directions", () => {
      store.upsertNode(makeNode("a"));
      store.upsertNode(makeNode("b"));
      store.upsertEdge(makeEdge("a", "b"));

      const fromB = store.getNeighbors("b");
      expect(fromB.length).toBe(1);
      expect(fromB[0].node.id).toBe("a");
    });

    it("filters neighbors by relation", () => {
      store.upsertNode(makeNode("a"));
      store.upsertNode(makeNode("b"));
      store.upsertNode(makeNode("c"));
      store.upsertEdge(makeEdge("a", "b", { relation: "calls" }));
      store.upsertEdge(makeEdge("a", "c", { relation: "imports" }));

      const callNeighbors = store.getNeighbors("a", "calls");
      expect(callNeighbors.length).toBe(1);
      expect(callNeighbors[0].node.id).toBe("b");
    });
  });

  describe("bulk operations", () => {
    it("inserts many nodes and edges in transaction", () => {
      const nodes = Array.from({ length: 100 }, (_, i) => makeNode(`n${i}`));
      const edges = Array.from({ length: 50 }, (_, i) =>
        makeEdge(`n${i}`, `n${i + 50}`)
      );

      store.bulkUpsert(nodes, edges);

      const stats = store.getStats();
      expect(stats.nodes).toBe(100);
      expect(stats.edges).toBe(50);
    });
  });

  describe("god nodes", () => {
    it("returns most connected non-file nodes", () => {
      store.upsertNode(makeNode("hub", { kind: "class" }));
      store.upsertNode(makeNode("a"));
      store.upsertNode(makeNode("b"));
      store.upsertNode(makeNode("c"));
      store.upsertEdge(makeEdge("hub", "a"));
      store.upsertEdge(makeEdge("hub", "b"));
      store.upsertEdge(makeEdge("hub", "c"));
      store.upsertEdge(makeEdge("a", "b"));

      const gods = store.getGodNodes(2);
      expect(gods[0].node.id).toBe("hub");
      expect(gods[0].degree).toBe(3);
    });

    it("excludes file and import nodes", () => {
      store.upsertNode(makeNode("myfile", { kind: "file" }));
      store.upsertNode(makeNode("myimport", { kind: "import" }));
      store.upsertNode(makeNode("myfunc", { kind: "function" }));
      store.upsertEdge(makeEdge("myfile", "myfunc"));
      store.upsertEdge(makeEdge("myfile", "myimport"));

      const gods = store.getGodNodes(5);
      const ids = gods.map((g) => g.node.id);
      expect(ids).not.toContain("myfile");
      expect(ids).not.toContain("myimport");
    });
  });

  describe("stats", () => {
    it("returns correct counts", () => {
      store.upsertNode(makeNode("a"));
      store.upsertNode(makeNode("b"));
      store.upsertEdge(makeEdge("a", "b"));
      store.upsertEdge(makeEdge("a", "b", { relation: "imports", confidence: "INFERRED", confidenceScore: 0.8 }));

      const stats = store.getStats();
      expect(stats.nodes).toBe(2);
      expect(stats.edges).toBe(2);
      expect(stats.extractedPct).toBe(50);
      expect(stats.inferredPct).toBe(50);
    });

    it("handles empty graph", () => {
      const stats = store.getStats();
      expect(stats.nodes).toBe(0);
      expect(stats.edges).toBe(0);
    });
  });

  describe("stat key-value", () => {
    it("sets and gets stats", () => {
      store.setStat("foo", "bar");
      expect(store.getStat("foo")).toBe("bar");
    });

    it("returns null for missing stat", () => {
      expect(store.getStat("nonexistent")).toBeNull();
    });

    it("getStatNum returns 0 for missing", () => {
      expect(store.getStatNum("missing")).toBe(0);
    });

    it("overwrites existing stat", () => {
      store.setStat("count", "1");
      store.setStat("count", "2");
      expect(store.getStat("count")).toBe("2");
    });
  });

  describe("persistence", () => {
    it("survives close and reopen", async () => {
      store.upsertNode(makeNode("persistent", { label: "I survive" }));
      store.close();

      const store2 = await GraphStore.open(join(tmpDir, "test.db"));
      const node = store2.getNode("persistent");
      expect(node).not.toBeNull();
      expect(node!.label).toBe("I survive");
      store2.close();

      // Reassign so afterEach doesn't double-close
      store = await GraphStore.open(join(tmpDir, "test.db"));
    });
  });

  describe("clearAll", () => {
    it("removes all data", () => {
      store.upsertNode(makeNode("a"));
      store.upsertEdge(makeEdge("a", "a"));
      store.setStat("key", "val");
      store.clearAll();

      expect(store.getStats().nodes).toBe(0);
      expect(store.getStats().edges).toBe(0);
      expect(store.getStat("key")).toBeNull();
    });
  });

  describe("countBySourceFile", () => {
    it("returns the number of nodes recorded for a given source file", () => {
      store.upsertNode(makeNode("a", { sourceFile: "src/foo.ts" }));
      store.upsertNode(makeNode("b", { sourceFile: "src/foo.ts" }));
      store.upsertNode(makeNode("c", { sourceFile: "src/bar.ts" }));

      expect(store.countBySourceFile("src/foo.ts")).toBe(2);
      expect(store.countBySourceFile("src/bar.ts")).toBe(1);
      expect(store.countBySourceFile("src/never-indexed.ts")).toBe(0);
    });
  });
});
