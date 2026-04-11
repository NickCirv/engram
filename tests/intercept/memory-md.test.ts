/**
 * Tests for the MEMORY.md integration module (v0.3.1).
 *
 * The module writes engram's structural facts into a marker-bounded
 * block inside MEMORY.md. Critical invariants:
 *   1. Never clobber content outside the markers
 *   2. Create the file if missing
 *   3. Append a new block if no markers present
 *   4. Replace existing block contents in place
 *   5. Never throw on I/O failure
 *   6. Refuse to write if the target file is implausibly large
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildEngramSection,
  upsertEngramSection,
  writeEngramSectionToMemoryMd,
  ENGRAM_MARKER_START,
  ENGRAM_MARKER_END,
} from "../../src/intercept/memory-md.js";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("memory-md — buildEngramSection", () => {
  it("renders the full set of facts into a markdown block", () => {
    const text = buildEngramSection({
      projectName: "engram",
      branch: "main",
      stats: { nodes: 250, edges: 554, extractedPct: 96 },
      godNodes: [
        { label: "queryGraph", kind: "function", sourceFile: "src/graph/query.ts" },
        { label: "GraphStore", kind: "class", sourceFile: "src/graph/store.ts" },
      ],
      landmines: [
        { label: "null pointer in validateToken", sourceFile: "src/auth.ts" },
      ],
      lastMined: Date.now() - 3600_000,
    });
    expect(text).toContain("engram — structural facts");
    expect(text).toContain("**Project:** engram");
    expect(text).toContain("**Branch:** main");
    expect(text).toContain("**Graph:** 250 nodes, 554 edges, 96% extracted");
    expect(text).toContain("Core entities");
    expect(text).toContain("`queryGraph`");
    expect(text).toContain("Known landmines");
    expect(text).toContain("src/auth.ts");
    expect(text).toContain("complements Auto-Dream");
  });

  it("omits branch when null", () => {
    const text = buildEngramSection({
      projectName: "detached-head",
      branch: null,
      stats: { nodes: 10, edges: 20, extractedPct: 100 },
      godNodes: [],
      landmines: [],
      lastMined: 0,
    });
    expect(text).not.toContain("**Branch:**");
  });

  it("omits sections when data is empty", () => {
    const text = buildEngramSection({
      projectName: "minimal",
      branch: "main",
      stats: { nodes: 5, edges: 3, extractedPct: 100 },
      godNodes: [],
      landmines: [],
      lastMined: 0,
    });
    expect(text).not.toContain("### Core entities");
    expect(text).not.toContain("### Known landmines");
  });

  it("caps god nodes at 10", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      label: `fn${i}`,
      kind: "function",
      sourceFile: `src/f${i}.ts`,
    }));
    const text = buildEngramSection({
      projectName: "big",
      branch: "main",
      stats: { nodes: 30, edges: 60, extractedPct: 100 },
      godNodes: many,
      landmines: [],
      lastMined: 0,
    });
    expect(text).toContain("fn0");
    expect(text).toContain("fn9");
    expect(text).not.toContain("fn10");
  });
});

describe("memory-md — upsertEngramSection", () => {
  const section = "## engram — test section\n\nHello world.";

  it("creates a new MEMORY.md when input is empty", () => {
    const result = upsertEngramSection("", section);
    expect(result).toContain("# MEMORY.md");
    expect(result).toContain(ENGRAM_MARKER_START);
    expect(result).toContain(section);
    expect(result).toContain(ENGRAM_MARKER_END);
  });

  it("appends a new block when existing content has no markers", () => {
    const existing = "# My Project Memory\n\nUser prefers TypeScript.\n";
    const result = upsertEngramSection(existing, section);
    // Original content must survive verbatim
    expect(result).toContain("User prefers TypeScript.");
    // engram block must be appended
    expect(result).toContain(ENGRAM_MARKER_START);
    expect(result.indexOf("User prefers TypeScript.")).toBeLessThan(
      result.indexOf(ENGRAM_MARKER_START)
    );
  });

  it("replaces existing engram block in place", () => {
    const existing = `# MEMORY.md

User prefers TypeScript.

${ENGRAM_MARKER_START}
## engram — OLD SECTION
OLD CONTENT HERE
${ENGRAM_MARKER_END}

Other user memory below.
`;
    const result = upsertEngramSection(existing, section);
    // Original user content above AND below must survive
    expect(result).toContain("User prefers TypeScript.");
    expect(result).toContain("Other user memory below.");
    // Old engram content must be gone
    expect(result).not.toContain("OLD SECTION");
    expect(result).not.toContain("OLD CONTENT HERE");
    // New engram content must be present
    expect(result).toContain("test section");
  });

  it("handles nested markers correctly (doesn't over-match)", () => {
    const existing = `# MEMORY.md

${ENGRAM_MARKER_START}
## engram — first block
${ENGRAM_MARKER_END}

Some user content mentioning <!-- engram markers --> in prose.

More content.
`;
    const result = upsertEngramSection(existing, section);
    // Prose mention must survive
    expect(result).toContain("in prose");
    expect(result).toContain("More content.");
  });

  it("preserves content below the markers when updating", () => {
    const existing = `# MEMORY.md

${ENGRAM_MARKER_START}
old engram content
${ENGRAM_MARKER_END}

## User notes
- Important fact 1
- Important fact 2
`;
    const result = upsertEngramSection(existing, section);
    expect(result).toContain("Important fact 1");
    expect(result).toContain("Important fact 2");
    expect(result).toContain("User notes");
  });
});

describe("memory-md — writeEngramSectionToMemoryMd", () => {
  let projectRoot: string;
  let memoryPath: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "engram-memory-md-test-"));
    memoryPath = join(projectRoot, "MEMORY.md");
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("creates MEMORY.md when missing", () => {
    const ok = writeEngramSectionToMemoryMd(
      projectRoot,
      "## engram — test\nhello"
    );
    expect(ok).toBe(true);
    expect(existsSync(memoryPath)).toBe(true);
    const content = readFileSync(memoryPath, "utf-8");
    expect(content).toContain(ENGRAM_MARKER_START);
    expect(content).toContain("## engram — test");
  });

  it("preserves existing non-engram content when updating", () => {
    const existing = `# MEMORY.md

User facts:
- Prefers vim over emacs
- Uses TypeScript
`;
    writeFileSync(memoryPath, existing);

    const ok = writeEngramSectionToMemoryMd(
      projectRoot,
      "## engram — new section"
    );
    expect(ok).toBe(true);
    const content = readFileSync(memoryPath, "utf-8");
    expect(content).toContain("Prefers vim over emacs");
    expect(content).toContain("new section");
  });

  it("is idempotent — running twice leaves the file in the same state", () => {
    const section = "## engram — stable\nfacts here";
    writeEngramSectionToMemoryMd(projectRoot, section);
    const first = readFileSync(memoryPath, "utf-8");
    writeEngramSectionToMemoryMd(projectRoot, section);
    const second = readFileSync(memoryPath, "utf-8");
    expect(second).toBe(first);
  });

  it("refuses to write when MEMORY.md is implausibly large", () => {
    // Create a 2 MB file (above the 1 MB cap)
    writeFileSync(memoryPath, "x".repeat(2_000_000));
    const ok = writeEngramSectionToMemoryMd(
      projectRoot,
      "## engram — test"
    );
    expect(ok).toBe(false);
  });

  it("refuses to write a section that exceeds the size cap", () => {
    const huge = "x".repeat(20_000);
    const ok = writeEngramSectionToMemoryMd(projectRoot, huge);
    expect(ok).toBe(false);
  });

  it("never throws on bad projectRoot", () => {
    expect(() =>
      writeEngramSectionToMemoryMd("/nonexistent/path", "## section")
    ).not.toThrow();
    const result = writeEngramSectionToMemoryMd(
      "/nonexistent/path",
      "## section"
    );
    expect(result).toBe(false);
  });

  it("handles empty projectRoot", () => {
    expect(writeEngramSectionToMemoryMd("", "## section")).toBe(false);
  });
});
