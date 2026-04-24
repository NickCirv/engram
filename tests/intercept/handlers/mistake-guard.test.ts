/**
 * Tests for v3.0 item #8 — pre-mortem mistake-guard.
 *
 * The guard is opt-in via ENGRAM_MISTAKE_GUARD. Every test explicitly
 * sets / clears the env var so tests are order-independent.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  currentGuardMode,
  findMatchingMistakesAsync,
  formatWarning,
  applyMistakeGuard,
  type MistakeMatch,
} from "../../../src/intercept/handlers/mistake-guard.js";
import { init } from "../../../src/core.js";
import { GraphStore } from "../../../src/graph/store.js";
import type { GraphNode } from "../../../src/graph/schema.js";

function makeMistake(opts: {
  id: string;
  sourceFile: string;
  label: string;
  validUntil?: number;
  commandPattern?: string;
}): GraphNode {
  return {
    id: opts.id,
    label: opts.label,
    kind: "mistake",
    sourceFile: opts.sourceFile,
    sourceLocation: null,
    confidence: "INFERRED",
    confidenceScore: 0.6,
    lastVerified: Date.now() - 1000 * 60 * 60 * 24, // 1 day ago
    queryCount: 0,
    metadata: opts.commandPattern
      ? { miner: "test", commandPattern: opts.commandPattern }
      : { miner: "test" },
    validUntil: opts.validUntil,
  };
}

describe("currentGuardMode", () => {
  afterEach(() => {
    delete process.env.ENGRAM_MISTAKE_GUARD;
  });

  it("returns 'off' when env var is unset", () => {
    delete process.env.ENGRAM_MISTAKE_GUARD;
    expect(currentGuardMode()).toBe("off");
  });

  it("returns 'permissive' when env var is '1'", () => {
    process.env.ENGRAM_MISTAKE_GUARD = "1";
    expect(currentGuardMode()).toBe("permissive");
  });

  it("returns 'strict' when env var is '2'", () => {
    process.env.ENGRAM_MISTAKE_GUARD = "2";
    expect(currentGuardMode()).toBe("strict");
  });

  it("returns 'off' for unrecognized values", () => {
    process.env.ENGRAM_MISTAKE_GUARD = "yes";
    expect(currentGuardMode()).toBe("off");
    process.env.ENGRAM_MISTAKE_GUARD = "true";
    expect(currentGuardMode()).toBe("off");
    process.env.ENGRAM_MISTAKE_GUARD = "0";
    expect(currentGuardMode()).toBe("off");
  });
});

describe("formatWarning", () => {
  it("returns empty string on empty matches", () => {
    expect(formatWarning([])).toBe("");
  });

  it("formats a single-match warning with header + entry", () => {
    const matches: MistakeMatch[] = [
      { label: "JWT secret hardcoded", sourceFile: "src/auth.ts", ageMs: 86400000 },
    ];
    const out = formatWarning(matches);
    expect(out).toContain("engramx pre-mortem");
    expect(out).toContain("JWT secret hardcoded");
    expect(out).toContain("src/auth.ts");
  });

  it("collapses extras with '… and N more' when >5 matches", () => {
    const matches: MistakeMatch[] = Array.from({ length: 8 }, (_, i) => ({
      label: `Mistake ${i}`,
      sourceFile: "src/x.ts",
      ageMs: 86400000,
    }));
    const out = formatWarning(matches);
    expect(out).toContain("Mistake 0");
    expect(out).toContain("Mistake 4");
    expect(out).not.toContain("Mistake 5");
    expect(out).toContain("and 3 more");
  });
});

describe("findMatchingMistakesAsync — Edit/Write (file target)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "engram-guard-"));
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(
      join(tmpDir, "src", "auth.ts"),
      `export function auth() {}\n`
    );
    await init(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function seed(nodes: GraphNode[]): Promise<void> {
    const dbPath = join(tmpDir, ".engram", "graph.db");
    const store = await GraphStore.open(dbPath);
    try {
      for (const n of nodes) store.upsertNode(n);
      store.save();
    } finally {
      store.close();
    }
  }

  it("finds a mistake for a file with relative path input", async () => {
    await seed([
      makeMistake({
        id: "m1",
        sourceFile: "src/auth.ts",
        label: "JWT secret hardcoded",
      }),
    ]);

    const matches = await findMatchingMistakesAsync(
      { kind: "file", filePath: "src/auth.ts" },
      tmpDir
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].label).toBe("JWT secret hardcoded");
  });

  it("normalizes absolute path input to relative for matching", async () => {
    await seed([
      makeMistake({
        id: "m2",
        sourceFile: "src/auth.ts",
        label: "Race condition in auth",
      }),
    ]);

    const absPath = join(tmpDir, "src", "auth.ts");
    const matches = await findMatchingMistakesAsync(
      { kind: "file", filePath: absPath },
      tmpDir
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].label).toBe("Race condition in auth");
  });

  it("returns empty for a file with no matching mistakes", async () => {
    await seed([
      makeMistake({
        id: "m3",
        sourceFile: "src/other.ts",
        label: "Different file mistake",
      }),
    ]);

    const matches = await findMatchingMistakesAsync(
      { kind: "file", filePath: "src/auth.ts" },
      tmpDir
    );
    expect(matches).toHaveLength(0);
  });

  it("skips invalidated mistakes (validUntil in the past)", async () => {
    await seed([
      makeMistake({
        id: "m4",
        sourceFile: "src/auth.ts",
        label: "Stale mistake",
        validUntil: Date.now() - 1000,
      }),
      makeMistake({
        id: "m5",
        sourceFile: "src/auth.ts",
        label: "Active mistake",
      }),
    ]);

    const matches = await findMatchingMistakesAsync(
      { kind: "file", filePath: "src/auth.ts" },
      tmpDir
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].label).toBe("Active mistake");
  });
});

describe("findMatchingMistakesAsync — Bash (command target)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "engram-guard-bash-"));
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "x.ts"), `export {};\n`);
    await init(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function seed(nodes: GraphNode[]): Promise<void> {
    const dbPath = join(tmpDir, ".engram", "graph.db");
    const store = await GraphStore.open(dbPath);
    try {
      for (const n of nodes) store.upsertNode(n);
      store.save();
    } finally {
      store.close();
    }
  }

  it("matches on commandPattern substring", async () => {
    await seed([
      makeMistake({
        id: "b1",
        sourceFile: "CLAUDE.md",
        label: "npm ci fails on lockfile v3",
        commandPattern: "npm ci",
      }),
    ]);

    const matches = await findMatchingMistakesAsync(
      { kind: "command", command: "npm ci --prefer-offline" },
      tmpDir
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].label).toBe("npm ci fails on lockfile v3");
  });

  it("matches on sourceFile mentioned in command (catches rm/mv recurrences)", async () => {
    await seed([
      makeMistake({
        id: "b2",
        sourceFile: "src/migrations/001.sql",
        label: "Migration 001 deletes prod data",
      }),
    ]);

    const matches = await findMatchingMistakesAsync(
      {
        kind: "command",
        command: "rm src/migrations/001.sql && echo done",
      },
      tmpDir
    );
    expect(matches).toHaveLength(1);
  });

  it("is case-insensitive on command matching", async () => {
    await seed([
      makeMistake({
        id: "b3",
        sourceFile: "CLAUDE.md",
        label: "Rebase fails",
        commandPattern: "git rebase",
      }),
    ]);

    const matches = await findMatchingMistakesAsync(
      { kind: "command", command: "GIT REBASE -i HEAD~3" },
      tmpDir
    );
    expect(matches).toHaveLength(1);
  });

  it("doesn't over-match on very short patterns (length guard)", async () => {
    await seed([
      makeMistake({
        id: "b4",
        sourceFile: "a",
        label: "1-char sourceFile (noise)",
      }),
    ]);

    const matches = await findMatchingMistakesAsync(
      { kind: "command", command: "bash script.sh" },
      tmpDir
    );
    // sourceFile 'a' too short (< 4) — should not match
    expect(matches).toHaveLength(0);
  });

  it("skips invalidated Bash mistakes (validUntil in past)", async () => {
    await seed([
      makeMistake({
        id: "b5",
        sourceFile: "CLAUDE.md",
        label: "Old pattern, fixed",
        commandPattern: "npm run old-cmd",
        validUntil: Date.now() - 1000,
      }),
    ]);

    const matches = await findMatchingMistakesAsync(
      { kind: "command", command: "npm run old-cmd" },
      tmpDir
    );
    expect(matches).toHaveLength(0);
  });
});

describe("applyMistakeGuard — integration", () => {
  let tmpDir: string;
  const ORIGINAL_GUARD = process.env.ENGRAM_MISTAKE_GUARD;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "engram-guard-int-"));
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "auth.ts"), `export {};\n`);
    await init(tmpDir);
    const dbPath = join(tmpDir, ".engram", "graph.db");
    const store = await GraphStore.open(dbPath);
    try {
      store.upsertNode(
        makeMistake({
          id: "m1",
          sourceFile: "src/auth.ts",
          label: "Known auth bug",
        })
      );
      store.save();
    } finally {
      store.close();
    }
  });

  afterEach(() => {
    if (ORIGINAL_GUARD === undefined) {
      delete process.env.ENGRAM_MISTAKE_GUARD;
    } else {
      process.env.ENGRAM_MISTAKE_GUARD = ORIGINAL_GUARD;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makePayload(filePath: string): { tool_name: string; tool_input: Record<string, unknown>; cwd: string } {
    return {
      tool_name: "Edit",
      tool_input: { file_path: filePath },
      cwd: tmpDir,
    };
  }

  it("mode=off → returns raw result unchanged (even with matching mistake)", async () => {
    delete process.env.ENGRAM_MISTAKE_GUARD;
    const raw = null; // passthrough
    const out = await applyMistakeGuard(raw, makePayload("src/auth.ts"), "edit-write");
    expect(out).toBe(null);
  });

  it("mode=permissive + matching mistake → augments additionalContext with warning", async () => {
    process.env.ENGRAM_MISTAKE_GUARD = "1";
    const raw = {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        additionalContext: "existing engram packet",
      },
    };
    const out = await applyMistakeGuard(raw, makePayload("src/auth.ts"), "edit-write");
    const hso = (out as { hookSpecificOutput: { additionalContext: string; permissionDecision: string } })
      .hookSpecificOutput;
    expect(hso.permissionDecision).toBe("allow");
    expect(hso.additionalContext).toContain("engramx pre-mortem");
    expect(hso.additionalContext).toContain("Known auth bug");
    expect(hso.additionalContext).toContain("existing engram packet");
  });

  it("mode=permissive + no matches → returns raw result unchanged", async () => {
    process.env.ENGRAM_MISTAKE_GUARD = "1";
    const raw = null;
    const out = await applyMistakeGuard(raw, makePayload("src/nonexistent.ts"), "edit-write");
    expect(out).toBe(null);
  });

  it("mode=strict + matching mistake → deny response with warning as reason", async () => {
    process.env.ENGRAM_MISTAKE_GUARD = "2";
    const raw = {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
      },
    };
    const out = await applyMistakeGuard(raw, makePayload("src/auth.ts"), "edit-write");
    const hso = (out as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } })
      .hookSpecificOutput;
    expect(hso.permissionDecision).toBe("deny");
    expect(hso.permissionDecisionReason).toContain("Known auth bug");
  });

  it("mode=permissive + passthrough raw → emits fresh allow-with-warning", async () => {
    process.env.ENGRAM_MISTAKE_GUARD = "1";
    const raw = null;
    const out = await applyMistakeGuard(raw, makePayload("src/auth.ts"), "edit-write");
    const hso = (out as { hookSpecificOutput: { permissionDecision: string; additionalContext: string } })
      .hookSpecificOutput;
    expect(hso.permissionDecision).toBe("allow");
    expect(hso.additionalContext).toContain("Known auth bug");
  });
});
