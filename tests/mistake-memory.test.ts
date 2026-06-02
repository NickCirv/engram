import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GraphStore } from "../src/graph/store.js";
import { queryGraph } from "../src/graph/query.js";
import { mistakes, init, learn } from "../src/core.js";
import { learnFromSession } from "../src/miners/session-miner.js";
import type { GraphNode } from "../src/graph/schema.js";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeMistakeNode(id: string, label: string, lastVerified = Date.now()): GraphNode {
  return {
    id,
    label,
    kind: "mistake",
    sourceFile: "CLAUDE.md",
    sourceLocation: null,
    confidence: "INFERRED",
    confidenceScore: 0.6,
    lastVerified,
    queryCount: 0,
    metadata: { miner: "session" },
  };
}

function makeCodeNode(id: string, label: string): GraphNode {
  return {
    id,
    label,
    kind: "function",
    sourceFile: `src/${id}.ts`,
    sourceLocation: null,
    confidence: "EXTRACTED",
    confidenceScore: 1.0,
    lastVerified: Date.now(),
    queryCount: 0,
    metadata: {},
  };
}

describe("mistake memory — query priority boost", () => {
  let dir: string;
  let store: GraphStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "engram-regret-"));
    store = await GraphStore.open(join(dir, "graph.db"));

    // Seed: one mistake about fs.readFile in event loop + some code nodes
    const nodes: GraphNode[] = [
      makeMistakeNode(
        "mis_readfile",
        "used synchronous fs.readFile in event loop caused request pileup in prod"
      ),
      makeCodeNode("readfile_util", "readFile()"),
      makeCodeNode("event_loop_mgr", "eventLoop()"),
      makeCodeNode("unrelated", "sortArray()"),
    ];
    store.bulkUpsert(nodes, []);
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("query matching a mistake surfaces it with a ⚠️ warning block", () => {
    const result = queryGraph(store, "fs readFile event loop");
    expect(result.text).toContain("⚠️");
    // The mistake content should appear in the output
    expect(result.text.toLowerCase()).toContain("readfile");
  });

  it("warning block is at the TOP of the rendered output", () => {
    const result = queryGraph(store, "fs readFile");
    const warnIdx = result.text.indexOf("⚠️");
    const nodeIdx = result.text.indexOf("NODE");
    expect(warnIdx).toBeGreaterThan(-1);
    // ⚠️ appears before any NODE lines (or there are no NODE lines)
    if (nodeIdx > -1) {
      expect(warnIdx).toBeLessThan(nodeIdx);
    }
  });

  it("query with no mistake match has NO ⚠️ block", () => {
    const result = queryGraph(store, "sort array");
    expect(result.text).not.toContain("⚠️");
  });

  it("mistakes appear only in the warning block, not duplicated in NODE list", () => {
    const result = queryGraph(store, "fs readFile event loop");
    // The mistake label should appear exactly once
    const count = (
      result.text.match(/used synchronous fs\.readFile/g) ?? []
    ).length;
    expect(count).toBe(1);
  });
});

describe("mistake memory — long label truncation", () => {
  let dir: string;
  let store: GraphStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "engram-regret-trunc-"));
    store = await GraphStore.open(join(dir, "graph.db"));
    const longLabel =
      "extremely long mistake description that goes on and on and on ".repeat(
        30
      ) + " 🎉"; // emoji at the very end
    store.bulkUpsert([makeMistakeNode("mis_long", longLabel)], []);
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("long mistake labels are surrogate-safe truncated in query output", () => {
    const result = queryGraph(store, "extremely long mistake");
    // Should contain the start of the label and an ellipsis
    expect(result.text).toContain("extremely long mistake");
    // The output must be valid UTF-16 (no lone high surrogates)
    for (let i = 0; i < result.text.length; i++) {
      const code = result.text.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF) {
        const next = result.text.charCodeAt(i + 1);
        expect(next >= 0xDC00 && next <= 0xDFFF).toBe(true);
      }
    }
    // Must round-trip through JSON without errors
    expect(() => JSON.stringify({ text: result.text })).not.toThrow();
  });
});

describe("mistake memory — mistakes() public API", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "engram-mistakes-api-"));
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(
      join(tmpDir, "src", "app.ts"),
      `export function main() {}\n`
    );
    await init(tmpDir);
    // Plant some mistakes via learn()
    await learn(
      tmpDir,
      "bug: forgot to await database connection in user signup"
    );
    await learn(
      tmpDir,
      "fix: mutex deadlock when two workers touched the same row"
    );
    await learn(
      tmpDir,
      "bug: cors headers missing on preflight for legacy endpoints"
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("lists all mistakes in the graph", async () => {
    const result = await mistakes(tmpDir);
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result.every((m) => m.label.length > 0)).toBe(true);
    // Explicit `learn()` is high-intent teaching → promoted to EXTRACTED
    // (nag-worthy), unlike auto-inferred miners which stay INFERRED/0.6.
    expect(result.every((m) => m.confidence === "EXTRACTED")).toBe(true);
  });

  it("respects the limit option", async () => {
    const result = await mistakes(tmpDir, { limit: 2 });
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it("sinceDays filter excludes older mistakes", async () => {
    // All mistakes should be recent (just created in beforeEach)
    const recent = await mistakes(tmpDir, { sinceDays: 1 });
    expect(recent.length).toBeGreaterThanOrEqual(3);
    // Large sinceDays covers everything
    const all = await mistakes(tmpDir, { sinceDays: 365 });
    expect(all.length).toBe(recent.length);
  });

  it("returns empty array when no mistakes exist", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "engram-mistakes-empty-"));
    mkdirSync(join(emptyDir, "src"));
    writeFileSync(join(emptyDir, "src", "app.ts"), "export {};\n");
    try {
      await init(emptyDir);
      const result = await mistakes(emptyDir);
      expect(result).toEqual([]);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

describe("mistake memory — false-positive regression (Knuth gate)", () => {
  it("engram README corpus extracts ZERO garbage mistakes (frozen fixture)", () => {
    // If this test fails, someone loosened the session-miner regex and is
    // now extracting false positives from prose documentation. Tighten it
    // back or update the fixture deliberately — don't silently accept.
    const readmeText = readFileSync(
      "./tests/fixtures/mistake-corpus-readme.md",
      "utf-8"
    );
    const result = learnFromSession(readmeText, "README.md");
    const mistakes = result.nodes.filter((n) => n.kind === "mistake");
    const decisions = result.nodes.filter((n) => n.kind === "decision");
    const patterns = result.nodes.filter((n) => n.kind === "pattern");

    expect(mistakes.length).toBe(0);
    // Prose README with no `decided X over Y` phrasing → 0 decisions
    expect(decisions.length).toBe(0);
    // Similarly 0 patterns (no `pattern:` colon-format)
    expect(patterns.length).toBe(0);
  });
});
