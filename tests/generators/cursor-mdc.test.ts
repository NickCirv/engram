import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GraphStore } from "../../src/graph/store.js";
import { generateCursorMdc } from "../../src/generators/cursor-mdc.js";

describe("generateCursorMdc", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "engram-mdc-"));
    // Create the engram DB dir so getStore can write
    import("node:fs").then(({ mkdirSync }) =>
      mkdirSync(join(dir, ".engram"), { recursive: true })
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates .cursor/rules/engram-context.mdc with valid MDC frontmatter", async () => {
    const result = await generateCursorMdc(dir);

    expect(existsSync(result.filePath)).toBe(true);
    const content = readFileSync(result.filePath, "utf-8");

    // MDC frontmatter delimiters
    expect(content.startsWith("---\n")).toBe(true);
    const secondDelim = content.indexOf("---\n", 4);
    expect(secondDelim).toBeGreaterThan(0);

    // Required frontmatter keys
    expect(content).toContain("alwaysApply: false");
    expect(content).toContain("globs:");
    expect(content).toContain("description:");
  });

  it("returns correct filePath pointing to .cursor/rules/engram-context.mdc", async () => {
    const result = await generateCursorMdc(dir);
    expect(result.filePath).toMatch(/\.cursor[\\/]rules[\\/]engram-context\.mdc$/);
  });

  it("includes Architecture, Decisions, and Landmines sections when nodes exist", async () => {
    // Open the graph directly and insert test nodes before generating
    const { getDbPath } = await import("../../src/core.js");
    import("node:fs").then(({ mkdirSync }) =>
      mkdirSync(join(dir, ".engram"), { recursive: true })
    );
    const store = await GraphStore.open(getDbPath(dir));
    const now = Date.now();

    store.upsertNode({
      id: "pat-1",
      label: "Use immutable updates for state",
      kind: "pattern",
      sourceFile: "src/store.ts",
      sourceLocation: null,
      confidence: "EXTRACTED",
      confidenceScore: 0.9,
      lastVerified: now,
      queryCount: 0,
      metadata: {},
    });
    store.upsertNode({
      id: "dec-1",
      label: "Chose SQLite over Postgres for zero-dep deploy",
      kind: "decision",
      sourceFile: "src/core.ts",
      sourceLocation: null,
      confidence: "EXTRACTED",
      confidenceScore: 1.0,
      lastVerified: now,
      queryCount: 2,
      metadata: {},
    });
    store.upsertNode({
      id: "mis-1",
      label: "Never call getAllNodes on large graphs without limit",
      kind: "mistake",
      sourceFile: "src/graph/store.ts",
      sourceLocation: null,
      confidence: "EXTRACTED",
      confidenceScore: 1.0,
      lastVerified: now,
      queryCount: 5,
      metadata: {},
    });
    store.close();

    const result = await generateCursorMdc(dir);
    const content = readFileSync(result.filePath, "utf-8");

    expect(content).toContain("## Architecture Patterns");
    expect(content).toContain("Use immutable updates for state");
    expect(content).toContain("## Active Decisions");
    expect(content).toContain("Chose SQLite over Postgres");
    expect(content).toContain("## Known Landmines");
    expect(content).toContain("Never call getAllNodes");
    expect(result.sections).toBeGreaterThanOrEqual(3);
  });
});
