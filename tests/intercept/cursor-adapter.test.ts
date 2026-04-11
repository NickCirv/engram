/**
 * Cursor adapter tests — scaffold (v0.3.1).
 *
 * Pins the shape of `handleCursorBeforeReadFile` before the real
 * Cursor port ships in v0.3.2. Uses the same fixture style as the
 * existing Claude Code PreToolUse:Read tests.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  handleCursorBeforeReadFile,
  type CursorBeforeReadFilePayload,
} from "../../src/intercept/cursor-adapter.js";
import { init } from "../../src/core.js";
import { _resetCacheForTests } from "../../src/intercept/context.js";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("handleCursorBeforeReadFile", () => {
  let projectRoot: string;
  let authFile: string;

  beforeEach(async () => {
    _resetCacheForTests();
    projectRoot = mkdtempSync(join(tmpdir(), "engram-cursor-test-"));
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

  it("allows when payload is null", async () => {
    const result = await handleCursorBeforeReadFile(
      null as unknown as CursorBeforeReadFilePayload
    );
    expect(result).toEqual({ permission: "allow" });
  });

  it("allows when payload is not an object", async () => {
    const result = await handleCursorBeforeReadFile(
      "string" as unknown as CursorBeforeReadFilePayload
    );
    expect(result).toEqual({ permission: "allow" });
  });

  it("allows when file_path is missing", async () => {
    const result = await handleCursorBeforeReadFile({
      workspace_roots: [projectRoot],
    });
    expect(result).toEqual({ permission: "allow" });
  });

  it("allows when file_path is not a string", async () => {
    const result = await handleCursorBeforeReadFile({
      file_path: 42 as unknown as string,
      workspace_roots: [projectRoot],
    });
    expect(result).toEqual({ permission: "allow" });
  });

  it("denies with summary when file is covered in the graph", async () => {
    const result = await handleCursorBeforeReadFile({
      file_path: authFile,
      workspace_roots: [projectRoot],
    });
    expect(result.permission).toBe("deny");
    expect(typeof result.user_message).toBe("string");
    expect(result.user_message!.length).toBeGreaterThan(0);
    // The summary should mention at least one of the declarations.
    expect(result.user_message).toMatch(/AuthService|verifyToken|auth\.ts/);
  });

  it("allows when file is outside any known project", async () => {
    const result = await handleCursorBeforeReadFile({
      file_path: "/definitely/does/not/exist/anywhere/foo.ts",
      workspace_roots: ["/definitely/does/not/exist/anywhere"],
    });
    expect(result).toEqual({ permission: "allow" });
  });

  it("allows when workspace_roots is missing (falls back to process.cwd)", async () => {
    // With no workspace_roots and a file path outside process.cwd, the
    // handler can't resolve project context — should allow.
    const result = await handleCursorBeforeReadFile({
      file_path: "/tmp/some-random-file.ts",
    });
    expect(result).toEqual({ permission: "allow" });
  });

  it("never throws on bizarre input", async () => {
    await expect(
      handleCursorBeforeReadFile({} as CursorBeforeReadFilePayload)
    ).resolves.toEqual({ permission: "allow" });
    await expect(
      handleCursorBeforeReadFile({
        file_path: authFile,
        workspace_roots: null as unknown as string[],
      })
    ).resolves.toBeDefined();
  });
});
