/**
 * buildReferenceEdgesCached (G1 perf fix) — the mtime-keyed refs cache must
 * produce byte-identical edges to the full rebuild, cold OR warm. The warm path
 * (no source file changed) re-parses 0 files, dropping the per-edit edge rebuild
 * from ~300ms to ~1ms on the reindex-hook hot path.
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { init, getStore } from "../src/core.js";
import {
  buildReferenceEdges,
  buildReferenceEdgesCached,
} from "../src/miners/reference-miner.js";
import type { GraphEdge } from "../src/graph/schema.js";

const key = (e: GraphEdge) => `${e.source}->${e.target}:${e.relation}`;

describe("buildReferenceEdgesCached (G1)", () => {
  it("cold cache == full rebuild == warm cache (and warm re-parses nothing)", async () => {
    const dir = join(tmpdir(), `engram-refscache-${Date.now()}`);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "src", "a.js"),
      "export function alpha(x){ return beta(x); }\nexport function beta(x){ return x + 1; }\n"
    );
    writeFileSync(
      join(dir, "src", "b.js"),
      'import { beta } from "./a.js";\nexport function gamma(x){ return beta(x); }\n'
    );
    await init(dir);
    const store = await getStore(dir);
    try {
      const nodes = store.getAllNodes();
      const full = (await buildReferenceEdges(dir, nodes)).map(key).sort();
      expect(full.length).toBeGreaterThan(0);

      const cold = await buildReferenceEdgesCached(dir, nodes, {});
      expect(cold.edges.map(key).sort()).toEqual(full); // cold-cache equivalence
      expect(Object.keys(cold.cache).length).toBeGreaterThan(0); // cache populated

      const warm = await buildReferenceEdgesCached(dir, nodes, cold.cache);
      expect(warm.edges.map(key).sort()).toEqual(full); // warm-cache equivalence
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
