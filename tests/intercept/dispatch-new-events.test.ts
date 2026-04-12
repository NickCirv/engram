/**
 * Tests for dispatch routing of new v0.4 events: PreCompact, CwdChanged.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { init } from "../../src/core.js";
import { dispatchHook } from "../../src/intercept/dispatch.js";
import { PASSTHROUGH } from "../../src/intercept/safety.js";

const rootDir = join(tmpdir(), `engram-dispatch-new-${Date.now()}`);
const projectRoot = join(rootDir, "dispatch-test");

beforeAll(async () => {
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  writeFileSync(
    join(projectRoot, "src", "app.ts"),
    'export class App { start() { return true; } }\n'
  );
  await init(projectRoot);
});

afterAll(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

describe("dispatch — new events", () => {
  it("routes PreCompact to handlePreCompact", async () => {
    const result = await dispatchHook({
      hook_event_name: "PreCompact",
      cwd: projectRoot,
    });
    expect(result).not.toBe(PASSTHROUGH);
    if (result === PASSTHROUGH || !result) return;

    const output = (result as Record<string, unknown>).hookSpecificOutput as Record<string, unknown>;
    expect(output.additionalContext).toBeDefined();
    expect(typeof output.additionalContext).toBe("string");
    expect((output.additionalContext as string)).toContain("Compaction survival");
  });

  it("routes CwdChanged to handleCwdChanged", async () => {
    const result = await dispatchHook({
      hook_event_name: "CwdChanged",
      cwd: projectRoot,
    });
    expect(result).not.toBe(PASSTHROUGH);
    if (result === PASSTHROUGH || !result) return;

    const output = (result as Record<string, unknown>).hookSpecificOutput as Record<string, unknown>;
    expect(output.additionalContext).toBeDefined();
    expect((output.additionalContext as string)).toContain("Project switched to");
  });

  it("passes through unknown events", async () => {
    const result = await dispatchHook({
      hook_event_name: "SomeNewEvent",
      cwd: projectRoot,
    });
    expect(result).toBe(PASSTHROUGH);
  });

  it("passes through PreCompact for non-engram directory", async () => {
    const emptyDir = join(rootDir, "no-engram");
    mkdirSync(emptyDir, { recursive: true });
    const result = await dispatchHook({
      hook_event_name: "PreCompact",
      cwd: emptyDir,
    });
    expect(result).toBe(PASSTHROUGH);
  });
});
