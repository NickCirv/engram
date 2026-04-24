/**
 * Tests for the engram:mistakes context provider.
 *
 * v3.0 adds bi-temporal validity filtering — mistakes whose source code
 * has been refactored away (validUntil <= now) are suppressed even
 * though the mistake row still exists in the graph.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mistakesProvider } from "../../src/providers/engram-mistakes.js";
import { init } from "../../src/core.js";
import { GraphStore } from "../../src/graph/store.js";
import type { GraphNode } from "../../src/graph/schema.js";
import type { NodeContext } from "../../src/providers/types.js";

function makeMistake(opts: {
  id: string;
  sourceFile: string;
  label: string;
  lastVerified?: number;
  validUntil?: number;
  invalidatedByCommit?: string;
}): GraphNode {
  return {
    id: opts.id,
    label: opts.label,
    kind: "mistake",
    sourceFile: opts.sourceFile,
    sourceLocation: null,
    confidence: "INFERRED",
    confidenceScore: 0.6,
    lastVerified: opts.lastVerified ?? Date.now(),
    queryCount: 0,
    metadata: { miner: "test" },
    validUntil: opts.validUntil,
    invalidatedByCommit: opts.invalidatedByCommit,
  };
}

function makeNodeContext(filePath: string, projectRoot: string): NodeContext {
  return {
    filePath,
    projectRoot,
    nodeIds: [],
    imports: [],
    hasTests: false,
    churnRate: 0,
  };
}

describe("engram:mistakes provider — v3.0 bi-temporal filtering", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "engram-mistakes-bt-"));
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(
      join(tmpDir, "src", "auth.ts"),
      `export function authenticate() {}\n`
    );
    await init(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function seedMistakes(nodes: GraphNode[]): Promise<void> {
    const dbPath = join(tmpDir, ".engram", "graph.db");
    const store = await GraphStore.open(dbPath);
    try {
      for (const n of nodes) store.upsertNode(n);
      store.save();
    } finally {
      store.close();
    }
  }

  it("surfaces a mistake with no validUntil (back-compat: still valid)", async () => {
    await seedMistakes([
      makeMistake({
        id: "m1",
        sourceFile: "src/auth.ts",
        label: "JWT secret hardcoded",
      }),
    ]);

    const result = await mistakesProvider.resolve(
      "src/auth.ts",
      makeNodeContext("src/auth.ts", tmpDir)
    );

    expect(result).not.toBeNull();
    expect(result!.content).toContain("JWT secret hardcoded");
  });

  it("surfaces a mistake whose validUntil is in the future (still valid)", async () => {
    const future = Date.now() + 60_000; // 1 minute from now
    await seedMistakes([
      makeMistake({
        id: "m2",
        sourceFile: "src/auth.ts",
        label: "Race condition in login",
        validUntil: future,
      }),
    ]);

    const result = await mistakesProvider.resolve(
      "src/auth.ts",
      makeNodeContext("src/auth.ts", tmpDir)
    );

    expect(result).not.toBeNull();
    expect(result!.content).toContain("Race condition in login");
  });

  it("suppresses a mistake whose validUntil is in the past (invalidated)", async () => {
    const past = Date.now() - 60_000; // 1 minute ago
    await seedMistakes([
      makeMistake({
        id: "m3",
        sourceFile: "src/auth.ts",
        label: "Old typo bug",
        validUntil: past,
        invalidatedByCommit: "abc1234",
      }),
    ]);

    const result = await mistakesProvider.resolve(
      "src/auth.ts",
      makeNodeContext("src/auth.ts", tmpDir)
    );

    // No valid mistakes left → provider returns null
    expect(result).toBeNull();
  });

  it("filters out invalidated mistakes but keeps valid ones in the same file", async () => {
    const past = Date.now() - 1000;
    const future = Date.now() + 60_000;
    await seedMistakes([
      makeMistake({
        id: "m4",
        sourceFile: "src/auth.ts",
        label: "Stale: wrong return type",
        validUntil: past,
      }),
      makeMistake({
        id: "m5",
        sourceFile: "src/auth.ts",
        label: "Active: missing input validation",
        validUntil: future,
      }),
      makeMistake({
        id: "m6",
        sourceFile: "src/auth.ts",
        label: "Eternal: SQL injection vector",
      }),
    ]);

    const result = await mistakesProvider.resolve(
      "src/auth.ts",
      makeNodeContext("src/auth.ts", tmpDir)
    );

    expect(result).not.toBeNull();
    expect(result!.content).toContain("Active: missing input validation");
    expect(result!.content).toContain("Eternal: SQL injection vector");
    expect(result!.content).not.toContain("Stale: wrong return type");
  });

  it("validUntil exactly equal to now → suppressed (boundary)", async () => {
    // Set validUntil to NOW (or 1ms in the past to avoid clock-jitter races)
    const justExpired = Date.now() - 1;
    await seedMistakes([
      makeMistake({
        id: "m7",
        sourceFile: "src/auth.ts",
        label: "Just-expired mistake",
        validUntil: justExpired,
      }),
    ]);

    const result = await mistakesProvider.resolve(
      "src/auth.ts",
      makeNodeContext("src/auth.ts", tmpDir)
    );

    expect(result).toBeNull();
  });

  it("invalidatedByCommit is round-tripped through the store", async () => {
    await seedMistakes([
      makeMistake({
        id: "m8",
        sourceFile: "src/auth.ts",
        label: "audit-trail mistake",
        validUntil: Date.now() - 1000,
        invalidatedByCommit: "deadbeef",
      }),
    ]);

    // Read directly via store to confirm the audit field round-trips
    const dbPath = join(tmpDir, ".engram", "graph.db");
    const store = await GraphStore.open(dbPath);
    try {
      const nodes = store.getNodesByFile("src/auth.ts");
      const m8 = nodes.find((n) => n.id === "m8");
      expect(m8).toBeDefined();
      expect(m8!.invalidatedByCommit).toBe("deadbeef");
      expect(m8!.validUntil).toBeLessThan(Date.now());
    } finally {
      store.close();
    }
  });
});
