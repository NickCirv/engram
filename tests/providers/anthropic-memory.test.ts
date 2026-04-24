/**
 * Tests for the anthropic:memory provider — item #4 of v3.0 Spine.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  anthropicMemoryProvider,
  encodeProjectPath,
  getMemoryIndexPath,
  parseMemoryIndex,
  scoreEntry,
} from "../../src/providers/anthropic-memory.js";
import type { NodeContext } from "../../src/providers/types.js";

const ENV_KEY = "ENGRAM_ANTHROPIC_MEMORY_PATH";

function makeCtx(filePath: string, imports: string[] = []): NodeContext {
  return {
    filePath,
    projectRoot: "/tmp/does-not-matter-when-env-overridden",
    nodeIds: [],
    imports,
    hasTests: false,
    churnRate: 0,
  };
}

const SAMPLE_INDEX = `- [engram fulcrum insight](feedback_engram_fulcrum_insight.md) — PreToolUse hook is THE v0.3 unlock; passive lookup is capped at ~10K/session, hook flips engram to -45% session tokens
- [engram Query Budget 2000](reference_engram_query_budget_2000.md) — Hard fact: queryGraph() hardcodes tokenBudget=2000 at src/graph/query.ts:85; reranking changes content not count
- [Claude Code Hook Protocol — Empirical](reference_claude_code_hook_protocol_empirical.md) — Verified 2026-04-11: deny+reason works, allow+additionalContext works
- [Hooks Must Use Portable Paths](feedback_hooks_full_paths.md) — Never use bare commands in hooks; use wrapper scripts with platform-aware path resolution
- [SSH ProxyCommand Fix](ssh_proxmox_fix.md) — macOS Sequoia breaks SSH to Proxmox; nc workaround applied 2026-04-07
`;

describe("encodeProjectPath", () => {
  it("encodes a standard absolute path", () => {
    expect(encodeProjectPath("/Users/alice/proj")).toBe("-Users-alice-proj");
  });

  it("strips trailing slashes", () => {
    expect(encodeProjectPath("/Users/alice/proj/")).toBe("-Users-alice-proj");
    expect(encodeProjectPath("/Users/alice/proj///")).toBe("-Users-alice-proj");
  });

  it("normalizes Windows separators", () => {
    expect(encodeProjectPath("C:\\Users\\bob\\proj")).toBe("C:-Users-bob-proj");
  });

  it("preserves deep paths", () => {
    expect(encodeProjectPath("/a/b/c/d/e")).toBe("-a-b-c-d-e");
  });
});

describe("getMemoryIndexPath", () => {
  it("ends in projects/<encoded>/memory/MEMORY.md", () => {
    const path = getMemoryIndexPath("/Users/alice/proj");
    expect(path).toMatch(/\.claude\/projects\/-Users-alice-proj\/memory\/MEMORY\.md$/);
  });
});

describe("parseMemoryIndex", () => {
  it("parses a well-formed index", () => {
    const out = parseMemoryIndex(SAMPLE_INDEX);
    expect(out).toHaveLength(5);
    expect(out[0].title).toBe("engram fulcrum insight");
    expect(out[0].file).toBe("feedback_engram_fulcrum_insight.md");
    expect(out[0].description).toContain("PreToolUse hook");
  });

  it("skips empty lines and non-bullet content", () => {
    const content = `# Heading

Some prose.

- [Valid](x.md) — yes
- Not a link — no

- [Also Valid](y.md) — also yes
`;
    const out = parseMemoryIndex(content);
    expect(out.map((e) => e.title)).toEqual(["Valid", "Also Valid"]);
  });

  it("returns empty array for empty content", () => {
    expect(parseMemoryIndex("")).toEqual([]);
  });

  it("handles missing description gracefully", () => {
    const out = parseMemoryIndex("- [Title Only](x.md)");
    expect(out).toHaveLength(1);
    expect(out[0].description).toBe("");
  });
});

describe("scoreEntry", () => {
  const sampleEntry = {
    title: "Auth middleware JWT edge case",
    file: "auth-middleware.md",
    description: "jsonwebtoken verifies stale tokens because of clock drift",
  };

  it("scores 3 when title contains file basename", () => {
    const score = scoreEntry(sampleEntry, {
      filePath: "src/middleware.ts",
      imports: [],
    });
    expect(score).toBeGreaterThanOrEqual(3);
  });

  it("scores 2 when any import matches title or description", () => {
    const score = scoreEntry(sampleEntry, {
      filePath: "src/other.ts",
      imports: ["jsonwebtoken"],
    });
    // title doesn't contain "other", desc does contain "jsonwebtoken"
    expect(score).toBeGreaterThanOrEqual(2);
  });

  it("returns 0 on no relationship", () => {
    const score = scoreEntry(sampleEntry, {
      filePath: "docs/README.md",
      imports: ["lodash"],
    });
    expect(score).toBe(0);
  });

  it("case-insensitive matching", () => {
    const entry = {
      title: "AUTH stuff",
      file: "x.md",
      description: "important",
    };
    const score = scoreEntry(entry, {
      filePath: "src/auth/login.ts",
      imports: [],
    });
    expect(score).toBeGreaterThan(0);
  });
});

describe("anthropicMemoryProvider.resolve", () => {
  let tmpDir: string;
  let indexPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "engram-anthropic-memory-"));
    indexPath = join(tmpDir, "MEMORY.md");
    process.env[ENV_KEY] = indexPath;
  });

  afterEach(() => {
    delete process.env[ENV_KEY];
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when no MEMORY.md exists", async () => {
    const result = await anthropicMemoryProvider.resolve(
      "src/auth.ts",
      makeCtx("src/auth.ts")
    );
    expect(result).toBeNull();
  });

  it("returns null when MEMORY.md is empty", async () => {
    writeFileSync(indexPath, "");
    const result = await anthropicMemoryProvider.resolve(
      "src/auth.ts",
      makeCtx("src/auth.ts")
    );
    expect(result).toBeNull();
  });

  it("returns null when no entries match the current file", async () => {
    writeFileSync(indexPath, SAMPLE_INDEX);
    const result = await anthropicMemoryProvider.resolve(
      "totally/unrelated/pathname-xyzzy.rs",
      makeCtx("totally/unrelated/pathname-xyzzy.rs")
    );
    expect(result).toBeNull();
  });

  it("surfaces matching entries by basename", async () => {
    writeFileSync(indexPath, SAMPLE_INDEX);
    // 'engram' appears in multiple titles/descriptions
    const result = await anthropicMemoryProvider.resolve(
      "src/engram-notes.ts",
      makeCtx("src/engram-notes.ts")
    );
    expect(result).not.toBeNull();
    expect(result!.content).toContain("engram");
  });

  it("caps results at 3 entries", async () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      `- [engram note ${i}](n${i}.md) — contains engram keyword`
    ).join("\n");
    writeFileSync(indexPath, many);
    // file basename = 'engram' which appears in every title, so all 10
    // entries score >0 and get ranked — the provider must cap to 3.
    const result = await anthropicMemoryProvider.resolve(
      "src/engram.ts",
      makeCtx("src/engram.ts")
    );
    expect(result).not.toBeNull();
    const lines = result!.content.split("\n");
    expect(lines.length).toBeLessThanOrEqual(3);
  });

  it("returns null when file exceeds MAX_INDEX_BYTES", async () => {
    // Write a 1.1 MB file (hard cap is 1 MB)
    writeFileSync(indexPath, "- [big]() — " + "x".repeat(1_200_000));
    const result = await anthropicMemoryProvider.resolve(
      "src/a.ts",
      makeCtx("src/a.ts")
    );
    expect(result).toBeNull();
  });

  it("uses ENGRAM_ANTHROPIC_MEMORY_PATH override over projectRoot", async () => {
    writeFileSync(indexPath, SAMPLE_INDEX);
    const result = await anthropicMemoryProvider.resolve(
      "src/hooks/sentinel.ts",
      makeCtx("src/hooks/sentinel.ts")
    );
    expect(result).not.toBeNull();
    // 'hook' should match 'Hook' in several entries
    expect(result!.content.toLowerCase()).toContain("hook");
  });

  it("uses imports to find relevant entries", async () => {
    writeFileSync(
      indexPath,
      "- [TLS handshake oddity](notes.md) — jsonwebtoken 10+ changes default alg"
    );
    const result = await anthropicMemoryProvider.resolve(
      "src/auth/login.ts",
      makeCtx("src/auth/login.ts", ["jsonwebtoken"])
    );
    expect(result).not.toBeNull();
    expect(result!.content).toContain("TLS handshake oddity");
  });
});

describe("anthropicMemoryProvider.isAvailable", () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it("returns true by default (defers per-project existence check)", async () => {
    delete process.env[ENV_KEY];
    expect(await anthropicMemoryProvider.isAvailable()).toBe(true);
  });

  it("returns true when override file exists", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "eam-avail-"));
    const path = join(tmpDir, "MEMORY.md");
    writeFileSync(path, "test");
    process.env[ENV_KEY] = path;
    expect(await anthropicMemoryProvider.isAvailable()).toBe(true);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns false when override points to missing file", async () => {
    process.env[ENV_KEY] = "/tmp/nonexistent-xyzzy-abc.md";
    expect(await anthropicMemoryProvider.isAvailable()).toBe(false);
  });
});
