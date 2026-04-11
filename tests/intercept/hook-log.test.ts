/**
 * Tests for the hook event log — append-only JSONL with rotation.
 *
 * Critical invariants tested:
 *   - Never throws on any input, even invalid project roots
 *   - Entries have ts + event fields auto-added
 *   - Rotation fires at HOOK_LOG_MAX_BYTES
 *   - readHookLog returns empty array for missing/malformed files
 *   - No explicit locking required (append is atomic for small writes)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  logHookEvent,
  rotateIfNeeded,
  readHookLog,
  HOOK_LOG_MAX_BYTES,
} from "../../src/intelligence/hook-log.js";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  statSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("hook-log — logHookEvent", () => {
  let projectRoot: string;
  let logPath: string;
  let rotatedPath: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "engram-hook-log-"));
    mkdirSync(join(projectRoot, ".engram"), { recursive: true });
    logPath = join(projectRoot, ".engram", "hook-log.jsonl");
    rotatedPath = join(projectRoot, ".engram", "hook-log.jsonl.1");
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("writes a single JSONL entry", () => {
    logHookEvent(projectRoot, { event: "PreToolUse", tool: "Read" });
    expect(existsSync(logPath)).toBe(true);
    const content = readFileSync(logPath, "utf-8");
    expect(content.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(content.trim());
    expect(parsed.event).toBe("PreToolUse");
    expect(parsed.tool).toBe("Read");
  });

  it("auto-adds ts (ISO timestamp) to every entry", () => {
    logHookEvent(projectRoot, { event: "PostToolUse" });
    const entry = JSON.parse(readFileSync(logPath, "utf-8").trim());
    expect(entry.ts).toBeDefined();
    // Should parse as a valid date.
    expect(Number.isNaN(Date.parse(entry.ts))).toBe(false);
  });

  it("appends multiple entries with newline separators", () => {
    logHookEvent(projectRoot, { event: "e1" });
    logHookEvent(projectRoot, { event: "e2" });
    logHookEvent(projectRoot, { event: "e3" });
    const lines = readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
    expect(lines.length).toBe(3);
    expect(JSON.parse(lines[0]).event).toBe("e1");
    expect(JSON.parse(lines[2]).event).toBe("e3");
  });

  it("silently tolerates missing .engram directory (never throws)", () => {
    const emptyProject = mkdtempSync(join(tmpdir(), "engram-no-dir-"));
    try {
      expect(() =>
        logHookEvent(emptyProject, { event: "test" })
      ).not.toThrow();
    } finally {
      rmSync(emptyProject, { recursive: true, force: true });
    }
  });

  it("silently tolerates empty projectRoot", () => {
    expect(() => logHookEvent("", { event: "test" })).not.toThrow();
  });

  it("silently tolerates nonexistent projectRoot", () => {
    expect(() =>
      logHookEvent("/definitely/does/not/exist", { event: "test" })
    ).not.toThrow();
  });

  it("preserves all HookLogEntry fields", () => {
    logHookEvent(projectRoot, {
      event: "PreToolUse",
      tool: "Read",
      path: "src/auth.ts",
      decision: "deny",
      confidence: 0.92,
      nodeCount: 7,
      tokensSaved: 1200,
    });
    const entry = JSON.parse(readFileSync(logPath, "utf-8").trim());
    expect(entry.tool).toBe("Read");
    expect(entry.path).toBe("src/auth.ts");
    expect(entry.decision).toBe("deny");
    expect(entry.confidence).toBe(0.92);
    expect(entry.nodeCount).toBe(7);
    expect(entry.tokensSaved).toBe(1200);
  });
});

describe("hook-log — rotateIfNeeded", () => {
  let projectRoot: string;
  let logPath: string;
  let rotatedPath: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "engram-rotate-"));
    mkdirSync(join(projectRoot, ".engram"), { recursive: true });
    logPath = join(projectRoot, ".engram", "hook-log.jsonl");
    rotatedPath = join(projectRoot, ".engram", "hook-log.jsonl.1");
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("does NOT rotate when under the cap", () => {
    writeFileSync(logPath, "x".repeat(100));
    rotateIfNeeded(projectRoot);
    expect(existsSync(logPath)).toBe(true);
    expect(existsSync(rotatedPath)).toBe(false);
  });

  it("rotates when over the cap", () => {
    // Create a log file larger than the cap.
    const oversized = "x".repeat(HOOK_LOG_MAX_BYTES + 100);
    writeFileSync(logPath, oversized);
    rotateIfNeeded(projectRoot);
    expect(existsSync(logPath)).toBe(false);
    expect(existsSync(rotatedPath)).toBe(true);
    expect(statSync(rotatedPath).size).toBeGreaterThanOrEqual(
      HOOK_LOG_MAX_BYTES
    );
  });

  it("overwrites existing .jsonl.1 on rotation", () => {
    writeFileSync(rotatedPath, "old rotated content");
    writeFileSync(logPath, "x".repeat(HOOK_LOG_MAX_BYTES + 100));
    rotateIfNeeded(projectRoot);
    // New .jsonl.1 has the big file, old content is gone.
    expect(readFileSync(rotatedPath, "utf-8")).not.toContain("old rotated content");
  });

  it("does nothing if the log file does not exist", () => {
    rotateIfNeeded(projectRoot);
    expect(existsSync(logPath)).toBe(false);
    expect(existsSync(rotatedPath)).toBe(false);
  });

  it("never throws even on non-existent project root", () => {
    expect(() => rotateIfNeeded("/no/such/path")).not.toThrow();
  });
});

describe("hook-log — readHookLog", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "engram-read-log-"));
    mkdirSync(join(projectRoot, ".engram"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("returns empty array when log file does not exist", () => {
    expect(readHookLog(projectRoot)).toEqual([]);
  });

  it("returns parsed entries from a valid log", () => {
    logHookEvent(projectRoot, { event: "PreToolUse", tool: "Read" });
    logHookEvent(projectRoot, { event: "PostToolUse", tool: "Edit" });
    const entries = readHookLog(projectRoot);
    expect(entries.length).toBe(2);
    expect(entries[0].tool).toBe("Read");
    expect(entries[1].tool).toBe("Edit");
  });

  it("skips malformed lines without throwing", () => {
    const logPath = join(projectRoot, ".engram", "hook-log.jsonl");
    writeFileSync(
      logPath,
      `{"event":"good"}\n{broken json here\n{"event":"also-good"}\n`
    );
    const entries = readHookLog(projectRoot);
    expect(entries.length).toBe(2);
    expect(entries[0].event).toBe("good");
    expect(entries[1].event).toBe("also-good");
  });

  it("never throws on missing project root", () => {
    expect(() => readHookLog("/nonexistent")).not.toThrow();
    expect(readHookLog("/nonexistent")).toEqual([]);
  });
});
