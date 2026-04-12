/**
 * Tests for the CwdChanged hook handler — auto project switching.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { init } from "../../../src/core.js";
import { handleCwdChanged } from "../../../src/intercept/handlers/cwd-changed.js";
import { PASSTHROUGH } from "../../../src/intercept/safety.js";

const rootDir = join(tmpdir(), `engram-cwdchanged-test-${Date.now()}`);
const projectA = join(rootDir, "project-alpha");
const projectB = join(rootDir, "project-beta");
const emptyDir = join(rootDir, "no-engram");

const SAMPLE_CODE = `
export class UserStore {
  async findById(id: string) { return { id, name: "test" }; }
  async create(name: string) { return { id: "1", name }; }
}
`;

beforeAll(async () => {
  mkdirSync(join(projectA, "src"), { recursive: true });
  mkdirSync(join(projectB, "src"), { recursive: true });
  mkdirSync(emptyDir, { recursive: true });

  writeFileSync(join(projectA, "src", "store.ts"), SAMPLE_CODE);
  writeFileSync(join(projectB, "src", "api.ts"), 'export function handle() { return "ok"; }\n');

  await init(projectA);
  await init(projectB);
});

afterAll(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

describe("handleCwdChanged", () => {
  it("injects project context when switching to an engram project", async () => {
    const result = await handleCwdChanged({
      hook_event_name: "CwdChanged",
      cwd: projectA,
    });
    expect(result).not.toBe(PASSTHROUGH);
    if (result === PASSTHROUGH || result === null || result === undefined) return;

    const output = (result as Record<string, unknown>).hookSpecificOutput as Record<string, unknown>;
    const ctx = output.additionalContext as string;
    expect(ctx).toContain("[engram] Project switched to project-alpha");
    expect(ctx).toContain("engram interception is active");
  });

  it("includes core entities in the switch brief", async () => {
    const result = await handleCwdChanged({
      hook_event_name: "CwdChanged",
      cwd: projectA,
    });
    if (result === PASSTHROUGH || result === null || result === undefined) return;

    const ctx = ((result as Record<string, unknown>).hookSpecificOutput as Record<string, unknown>).additionalContext as string;
    expect(ctx).toContain("Core entities:");
  });

  it("returns PASSTHROUGH for directory without engram", async () => {
    const result = await handleCwdChanged({
      hook_event_name: "CwdChanged",
      cwd: emptyDir,
    });
    expect(result).toBe(PASSTHROUGH);
  });

  it("returns PASSTHROUGH for wrong event name", async () => {
    const result = await handleCwdChanged({
      hook_event_name: "PreToolUse",
      cwd: projectA,
    });
    expect(result).toBe(PASSTHROUGH);
  });

  it("returns PASSTHROUGH for invalid cwd", async () => {
    const result = await handleCwdChanged({
      hook_event_name: "CwdChanged",
      cwd: "",
    });
    expect(result).toBe(PASSTHROUGH);
  });

  it("returns different content when switching between projects", async () => {
    const resultA = await handleCwdChanged({
      hook_event_name: "CwdChanged",
      cwd: projectA,
    });
    const resultB = await handleCwdChanged({
      hook_event_name: "CwdChanged",
      cwd: projectB,
    });

    if (resultA === PASSTHROUGH || resultB === PASSTHROUGH) return;
    if (!resultA || !resultB) return;

    const ctxA = ((resultA as Record<string, unknown>).hookSpecificOutput as Record<string, unknown>).additionalContext as string;
    const ctxB = ((resultB as Record<string, unknown>).hookSpecificOutput as Record<string, unknown>).additionalContext as string;

    expect(ctxA).toContain("project-alpha");
    expect(ctxB).toContain("project-beta");
  });
});
