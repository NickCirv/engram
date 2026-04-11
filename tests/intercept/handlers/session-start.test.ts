/**
 * SessionStart handler tests. Uses a real init'd project so the brief
 * gets actual god nodes + stats + mistakes from the graph.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { init, learn } from "../../../src/core.js";
import {
  handleSessionStart,
  type SessionStartHookPayload,
} from "../../../src/intercept/handlers/session-start.js";
import { PASSTHROUGH } from "../../../src/intercept/safety.js";
import { _resetCacheForTests } from "../../../src/intercept/context.js";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("handleSessionStart — integration tests", () => {
  let projectRoot: string;

  beforeEach(async () => {
    _resetCacheForTests();
    projectRoot = mkdtempSync(join(tmpdir(), "engram-ss-test-"));
    mkdirSync(join(projectRoot, "src"), { recursive: true });

    writeFileSync(
      join(projectRoot, "src", "auth.ts"),
      `export class AuthService { validate() { return true; } }
export class SessionStore { create() { return "s"; } }
export function createAuthService() { return new AuthService(); }
export function verifyToken(t: string) { return !!t; }
export function hashPassword(p: string) { return "h_" + p; }
`
    );
    writeFileSync(
      join(projectRoot, "src", "db.ts"),
      `export class Db { connect() {} close() {} }
export function query(sql: string) { return []; }
export function transaction(fn: () => void) { fn(); }
`
    );

    await init(projectRoot);

    // Seed one mistake so the brief includes a landmine.
    await learn(
      projectRoot,
      `bug: null pointer in verifyToken when token is empty\nfix: add length check`,
      "src/auth.ts"
    );
  });

  afterEach(() => {
    _resetCacheForTests();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function buildPayload(
    source: SessionStartHookPayload["source"] = "startup"
  ): SessionStartHookPayload {
    return {
      hook_event_name: "SessionStart",
      cwd: projectRoot,
      source,
    };
  }

  it("injects a project brief on source=startup", async () => {
    const result = await handleSessionStart(buildPayload("startup"));
    expect(result).not.toBe(PASSTHROUGH);
    if (result === PASSTHROUGH) return;

    const wrapped = result as {
      hookSpecificOutput: {
        hookEventName: string;
        additionalContext: string;
      };
    };
    expect(wrapped.hookSpecificOutput.hookEventName).toBe("SessionStart");
    const text = wrapped.hookSpecificOutput.additionalContext;
    expect(text).toContain("[engram] Project brief");
    expect(text).toContain("nodes");
    expect(text).toContain("edges");
  });

  it("injects a brief on source=clear", async () => {
    const result = await handleSessionStart(buildPayload("clear"));
    expect(result).not.toBe(PASSTHROUGH);
  });

  it("injects a brief on source=compact", async () => {
    const result = await handleSessionStart(buildPayload("compact"));
    expect(result).not.toBe(PASSTHROUGH);
  });

  it("PASSES THROUGH on source=resume (session already has context)", async () => {
    const result = await handleSessionStart(buildPayload("resume"));
    expect(result).toBe(PASSTHROUGH);
  });

  it("defaults to injecting when source is missing", async () => {
    const result = await handleSessionStart({
      hook_event_name: "SessionStart",
      cwd: projectRoot,
    });
    expect(result).not.toBe(PASSTHROUGH);
  });

  it("includes core entities (god nodes) in the brief", async () => {
    const result = await handleSessionStart(buildPayload());
    if (result === PASSTHROUGH) return;
    const wrapped = result as {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(wrapped.hookSpecificOutput.additionalContext).toContain(
      "Core entities"
    );
  });

  it("includes landmines from mistakes() when present", async () => {
    const result = await handleSessionStart(buildPayload());
    if (result === PASSTHROUGH) return;
    const wrapped = result as {
      hookSpecificOutput: { additionalContext: string };
    };
    // The learned bug mentions "null pointer" and "verifyToken".
    const text = wrapped.hookSpecificOutput.additionalContext;
    expect(text).toContain("landmines");
  });

  it("passes through when cwd is outside any engram project", async () => {
    const result = await handleSessionStart({
      hook_event_name: "SessionStart",
      cwd: tmpdir(),
      source: "startup",
    });
    expect(result).toBe(PASSTHROUGH);
  });

  it("passes through when cwd is empty", async () => {
    const result = await handleSessionStart({
      hook_event_name: "SessionStart",
      cwd: "",
      source: "startup",
    });
    expect(result).toBe(PASSTHROUGH);
  });

  it("passes through when hook-disabled flag is present", async () => {
    writeFileSync(join(projectRoot, ".engram", "hook-disabled"), "");
    const result = await handleSessionStart(buildPayload("startup"));
    expect(result).toBe(PASSTHROUGH);
  });

  it("passes through when hook_event_name is wrong", async () => {
    const result = await handleSessionStart({
      hook_event_name: "PreToolUse" as unknown as "SessionStart",
      cwd: projectRoot,
      source: "startup",
    });
    expect(result).toBe(PASSTHROUGH);
  });

  it("never throws on malformed payload", async () => {
    await expect(
      handleSessionStart({
        hook_event_name: "SessionStart",
        cwd: "\0\0\0\0",
        source: "startup",
      })
    ).resolves.toBe(PASSTHROUGH);
  });
});
