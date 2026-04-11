/**
 * Dispatcher tests. Verifies the routing table, payload validation, and
 * the "never throws" safety net.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { init } from "../../src/core.js";
import { dispatchHook } from "../../src/intercept/dispatch.js";
import { PASSTHROUGH } from "../../src/intercept/safety.js";
import { _resetCacheForTests } from "../../src/intercept/context.js";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("dispatchHook — validation", () => {
  it("returns PASSTHROUGH for null payload", async () => {
    const result = await dispatchHook(null);
    expect(result).toBe(PASSTHROUGH);
  });

  it("returns PASSTHROUGH for undefined payload", async () => {
    const result = await dispatchHook(undefined);
    expect(result).toBe(PASSTHROUGH);
  });

  it("returns PASSTHROUGH for non-object payload", async () => {
    expect(await dispatchHook("string")).toBe(PASSTHROUGH);
    expect(await dispatchHook(42)).toBe(PASSTHROUGH);
    expect(await dispatchHook(true)).toBe(PASSTHROUGH);
  });

  it("returns PASSTHROUGH when hook_event_name is missing", async () => {
    const result = await dispatchHook({ tool_name: "Read", cwd: "/tmp" });
    expect(result).toBe(PASSTHROUGH);
  });

  it("returns PASSTHROUGH when hook_event_name is not a string", async () => {
    const result = await dispatchHook({
      hook_event_name: 42,
      tool_name: "Read",
      cwd: "/tmp",
    });
    expect(result).toBe(PASSTHROUGH);
  });

  it("returns PASSTHROUGH when cwd is missing", async () => {
    const result = await dispatchHook({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
    });
    expect(result).toBe(PASSTHROUGH);
  });

  it("returns PASSTHROUGH for unknown hook events", async () => {
    const result = await dispatchHook({
      hook_event_name: "SomeUnknownEvent",
      cwd: "/tmp",
      tool_input: {},
    });
    expect(result).toBe(PASSTHROUGH);
  });

  it("returns PASSTHROUGH for unsupported tool names on PreToolUse", async () => {
    const result = await dispatchHook({
      hook_event_name: "PreToolUse",
      tool_name: "Glob",
      cwd: "/tmp",
      tool_input: { pattern: "*.ts" },
    });
    expect(result).toBe(PASSTHROUGH);
  });

  it("returns PASSTHROUGH when tool_input is a non-object", async () => {
    const result = await dispatchHook({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      cwd: "/tmp",
      tool_input: "not-an-object",
    });
    expect(result).toBe(PASSTHROUGH);
  });

  it("never throws on bizarre inputs", async () => {
    await expect(dispatchHook({ a: 1, b: 2 })).resolves.toBe(PASSTHROUGH);
    await expect(dispatchHook([])).resolves.toBe(PASSTHROUGH);
  });
});

describe("dispatchHook — routing", () => {
  let projectRoot: string;
  let authFile: string;

  beforeEach(async () => {
    _resetCacheForTests();
    projectRoot = mkdtempSync(join(tmpdir(), "engram-dispatch-test-"));
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    authFile = join(projectRoot, "src", "auth.ts");
    writeFileSync(
      authFile,
      `export class AuthService {}
export class SessionStore {}
export function createAuthService() { return new AuthService(); }
export function verifyToken() { return true; }
export function hashPassword() { return "h"; }
`
    );
    await init(projectRoot);
  });

  afterEach(() => {
    _resetCacheForTests();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("routes PreToolUse:Read to handleRead", async () => {
    const result = await dispatchHook({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      cwd: projectRoot,
      tool_input: { file_path: authFile },
    });
    expect(result).not.toBe(PASSTHROUGH);
    if (result === PASSTHROUGH) return;
    const wrapped = result as {
      hookSpecificOutput: { permissionDecision: string };
    };
    expect(wrapped.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("routes PreToolUse:Edit to handleEditOrWrite (passthrough without mistakes)", async () => {
    const result = await dispatchHook({
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      cwd: projectRoot,
      tool_input: { file_path: authFile },
    });
    // No mistakes seeded → passthrough expected.
    expect(result).toBe(PASSTHROUGH);
  });

  it("routes PreToolUse:Write to handleEditOrWrite (passthrough without mistakes)", async () => {
    const result = await dispatchHook({
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      cwd: projectRoot,
      tool_input: { file_path: authFile },
    });
    expect(result).toBe(PASSTHROUGH);
  });

  it("routes PreToolUse:Bash with 'cat <file>' to handleBash → handleRead", async () => {
    const result = await dispatchHook({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      cwd: projectRoot,
      tool_input: { command: `cat ${authFile}` },
    });
    expect(result).not.toBe(PASSTHROUGH);
    if (result === PASSTHROUGH) return;
    const wrapped = result as {
      hookSpecificOutput: { permissionDecision: string };
    };
    expect(wrapped.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("routes PreToolUse:Bash with complex command to passthrough", async () => {
    const result = await dispatchHook({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      cwd: projectRoot,
      tool_input: { command: `cat ${authFile} | grep Auth` },
    });
    expect(result).toBe(PASSTHROUGH);
  });

  it("runs all handlers through runHandler so errors become passthrough", async () => {
    // Corrupt the graph path by pointing cwd at a non-existent project.
    // The handler will fail to find a project and return passthrough.
    const result = await dispatchHook({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      cwd: "/definitely/does/not/exist/anywhere",
      tool_input: { file_path: "/definitely/does/not/exist/anywhere/foo.ts" },
    });
    expect(result).toBe(PASSTHROUGH);
  });

  it("routes SessionStart to handleSessionStart", async () => {
    const result = await dispatchHook({
      hook_event_name: "SessionStart",
      cwd: projectRoot,
      source: "startup",
    });
    expect(result).not.toBe(PASSTHROUGH);
    if (result === PASSTHROUGH) return;
    const wrapped = result as {
      hookSpecificOutput: { hookEventName: string };
    };
    expect(wrapped.hookSpecificOutput.hookEventName).toBe("SessionStart");
  });

  it("routes SessionStart with source=resume to passthrough", async () => {
    const result = await dispatchHook({
      hook_event_name: "SessionStart",
      cwd: projectRoot,
      source: "resume",
    });
    expect(result).toBe(PASSTHROUGH);
  });

  it("routes UserPromptSubmit with matching prompt to injection", async () => {
    const result = await dispatchHook({
      hook_event_name: "UserPromptSubmit",
      cwd: projectRoot,
      prompt: "How does AuthService validate tokens?",
    });
    expect(result).not.toBe(PASSTHROUGH);
    if (result === PASSTHROUGH) return;
    const wrapped = result as {
      hookSpecificOutput: { hookEventName: string };
    };
    expect(wrapped.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
  });

  it("routes UserPromptSubmit with generic prompt to passthrough", async () => {
    const result = await dispatchHook({
      hook_event_name: "UserPromptSubmit",
      cwd: projectRoot,
      prompt: "yes",
    });
    expect(result).toBe(PASSTHROUGH);
  });

  it("routes PostToolUse to handlePostTool (passthrough observer)", async () => {
    const result = await dispatchHook({
      hook_event_name: "PostToolUse",
      cwd: projectRoot,
      tool_name: "Read",
      tool_input: { file_path: authFile },
      tool_response: "file content",
    });
    expect(result).toBe(PASSTHROUGH);
  });
});
