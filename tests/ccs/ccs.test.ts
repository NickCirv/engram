import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { importCcs } from "../../src/ccs/importer.js";
import { exportCcs } from "../../src/ccs/exporter.js";
import { GraphStore } from "../../src/graph/store.js";
import { getDbPath } from "../../src/core.js";

const FIXTURE_CCS = `# My Project

## Architecture
- Use dependency injection for all services
- Prefer composition over inheritance

## Decisions
- Chose SQLite over Postgres for zero-dep deploy

## Known Issues
- Race condition when two callers open the DB simultaneously

## Extras
- Utility helper lives in src/utils.ts
`;

describe("CCS importer", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "engram-ccs-import-"));
    mkdirSync(join(dir, ".engram"), { recursive: true });
    mkdirSync(join(dir, ".context"), { recursive: true });
    writeFileSync(join(dir, ".context", "index.md"), FIXTURE_CCS, "utf-8");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns zero counts when .context/index.md is missing", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "engram-ccs-empty-"));
    mkdirSync(join(emptyDir, ".engram"), { recursive: true });
    try {
      const result = await importCcs(emptyDir);
      expect(result.nodesCreated).toBe(0);
      expect(result.sectionsFound).toBe(0);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("creates nodes for each bullet point", async () => {
    const result = await importCcs(dir);
    expect(result.nodesCreated).toBe(5); // 2 + 1 + 1 + 1
    expect(result.sectionsFound).toBe(4);
  });

  it("assigns correct node kinds from headings", async () => {
    await importCcs(dir);
    const store = await GraphStore.open(getDbPath(dir));
    try {
      const nodes = store.getAllNodes();
      const byLabel = new Map(nodes.map((n) => [n.label, n]));

      expect(byLabel.get("Use dependency injection for all services")?.kind).toBe("pattern");
      expect(byLabel.get("Chose SQLite over Postgres for zero-dep deploy")?.kind).toBe("decision");
      expect(
        byLabel.get("Race condition when two callers open the DB simultaneously")?.kind
      ).toBe("mistake");
      expect(byLabel.get("Utility helper lives in src/utils.ts")?.kind).toBe("concept");
    } finally {
      store.close();
    }
  });

  it("sets confidenceScore to 0.9 and sourceFile to ccs path", async () => {
    await importCcs(dir);
    const store = await GraphStore.open(getDbPath(dir));
    try {
      const nodes = store.getAllNodes();
      for (const n of nodes) {
        expect(n.confidenceScore).toBe(0.9);
        expect(n.sourceFile).toBe("ccs:.context/index.md");
        expect(n.confidence).toBe("EXTRACTED");
      }
    } finally {
      store.close();
    }
  });
});

describe("CCS exporter", () => {
  let dir: string;
  let store: GraphStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "engram-ccs-export-"));
    mkdirSync(join(dir, ".engram"), { recursive: true });
    store = await GraphStore.open(getDbPath(dir));
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
      queryCount: 3,
      metadata: {},
    });
    store.upsertNode({
      id: "dec-1",
      label: "Chose SQLite for portability",
      kind: "decision",
      sourceFile: "src/core.ts",
      sourceLocation: null,
      confidence: "EXTRACTED",
      confidenceScore: 1.0,
      lastVerified: now,
      queryCount: 1,
      metadata: {},
    });
    store.upsertNode({
      id: "mis-1",
      label: "Do not mutate GraphNode objects directly",
      kind: "mistake",
      sourceFile: "src/graph/store.ts",
      sourceLocation: null,
      confidence: "EXTRACTED",
      confidenceScore: 1.0,
      lastVerified: now,
      queryCount: 5,
      metadata: {},
    });
    store.save();
    store.close();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes .context/index.md with correct header", async () => {
    const result = await exportCcs(dir);
    expect(existsSync(result.filePath)).toBe(true);
    const content = readFileSync(result.filePath, "utf-8");
    expect(content).toContain("# Project Context");
    expect(content).toContain("codebase-context-spec");
  });

  it("exports correct sections with bullets", async () => {
    await exportCcs(dir);
    const content = readFileSync(join(dir, ".context", "index.md"), "utf-8");
    expect(content).toContain("## Architecture Patterns");
    expect(content).toContain("- Use immutable updates for state");
    expect(content).toContain("## Decisions");
    expect(content).toContain("- Chose SQLite for portability");
    expect(content).toContain("## Known Issues");
    expect(content).toContain("- Do not mutate GraphNode objects directly");
  });

  it("returns correct stats", async () => {
    const result = await exportCcs(dir);
    expect(result.sectionsWritten).toBeGreaterThanOrEqual(3);
    expect(result.nodesExported).toBeGreaterThanOrEqual(3);
    expect(result.filePath).toMatch(/\.context[\\/]index\.md$/);
  });
});

describe("CCS round-trip", () => {
  it("import → export preserves structure", async () => {
    const dir = mkdtempSync(join(tmpdir(), "engram-ccs-roundtrip-"));
    mkdirSync(join(dir, ".engram"), { recursive: true });
    mkdirSync(join(dir, ".context"), { recursive: true });

    writeFileSync(
      join(dir, ".context", "index.md"),
      [
        "# Test Project",
        "",
        "## Architecture",
        "- Immutable state throughout",
        "",
        "## Decisions",
        "- Use SQLite not PostgreSQL",
        "",
        "## Known Issues",
        "- Large imports are slow",
      ].join("\n"),
      "utf-8"
    );

    try {
      const importResult = await importCcs(dir);
      expect(importResult.nodesCreated).toBe(3);

      const exportResult = await exportCcs(dir);
      const content = readFileSync(exportResult.filePath, "utf-8");

      expect(content).toContain("## Architecture Patterns");
      expect(content).toContain("Immutable state throughout");
      expect(content).toContain("## Decisions");
      expect(content).toContain("Use SQLite not PostgreSQL");
      expect(content).toContain("## Known Issues");
      expect(content).toContain("Large imports are slow");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
