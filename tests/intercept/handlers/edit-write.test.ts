/**
 * Integration tests for the Edit/Write handler. Uses a real init'd graph
 * with seeded mistakes to verify the complete landmine warning flow.
 *
 * Critical invariant: NO test may assert a deny response. This handler
 * must NEVER block writes — only augment them with additionalContext.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { init, learn } from "../../../src/core.js";
import {
  handleEditOrWrite,
  type EditWriteHookPayload,
} from "../../../src/intercept/handlers/edit-write.js";
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

describe("handleEditOrWrite — integration tests", () => {
  let projectRoot: string;
  let authFile: string;
  let dbFile: string;
  let cleanFile: string;

  beforeEach(async () => {
    _resetCacheForTests();
    projectRoot = mkdtempSync(join(tmpdir(), "engram-ew-test-"));
    mkdirSync(join(projectRoot, "src"), { recursive: true });

    authFile = join(projectRoot, "src", "auth.ts");
    writeFileSync(
      authFile,
      `export class AuthService {}\nexport function verify() {}\nexport function hash() {}\n`
    );

    dbFile = join(projectRoot, "src", "db.ts");
    writeFileSync(
      dbFile,
      `export class Db {}\nexport function query() {}\nexport function close() {}\n`
    );

    cleanFile = join(projectRoot, "src", "clean.ts");
    writeFileSync(
      cleanFile,
      `export function pure() { return 1; }\nexport function also() { return 2; }\n`
    );

    await init(projectRoot);

    // Seed mistakes for auth.ts only.
    await learn(
      projectRoot,
      `bug: null pointer in verify when token is empty
fix: check token length before calling verify`,
      "src/auth.ts"
    );
  });

  afterEach(() => {
    _resetCacheForTests();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function buildPayload(
    tool: "Edit" | "Write",
    filePath: string
  ): EditWriteHookPayload {
    return {
      tool_name: tool,
      cwd: projectRoot,
      tool_input: { file_path: filePath },
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // Money path: file with mistakes → allow + landmine warning
  // ────────────────────────────────────────────────────────────────────
  it("returns allow+additionalContext for Edit on a file with landmines", async () => {
    const result = await handleEditOrWrite(buildPayload("Edit", authFile));
    expect(result).not.toBe(PASSTHROUGH);
    if (result === PASSTHROUGH) return;

    const wrapped = result as {
      hookSpecificOutput: {
        hookEventName: string;
        permissionDecision: string;
        additionalContext: string;
      };
    };
    expect(wrapped.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(wrapped.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(wrapped.hookSpecificOutput.additionalContext).toContain(
      "[engram landmines]"
    );
    expect(wrapped.hookSpecificOutput.additionalContext).toContain("src/auth.ts");
  });

  it("returns allow+additionalContext for Write on a file with landmines", async () => {
    const result = await handleEditOrWrite(buildPayload("Write", authFile));
    expect(result).not.toBe(PASSTHROUGH);
    if (result === PASSTHROUGH) return;

    const wrapped = result as {
      hookSpecificOutput: { permissionDecision: string };
    };
    expect(wrapped.hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("NEVER returns a deny response (landmines are advisory only)", async () => {
    const result = await handleEditOrWrite(buildPayload("Edit", authFile));
    if (result === PASSTHROUGH) return;
    const wrapped = result as {
      hookSpecificOutput: { permissionDecision: string };
    };
    // Must be "allow", never "deny" or "ask".
    expect(wrapped.hookSpecificOutput.permissionDecision).toBe("allow");
  });

  // ────────────────────────────────────────────────────────────────────
  // Passthrough branches
  // ────────────────────────────────────────────────────────────────────
  it("passes through for Edit on a file with no landmines", async () => {
    const result = await handleEditOrWrite(buildPayload("Edit", cleanFile));
    expect(result).toBe(PASSTHROUGH);
  });

  it("passes through for Write on a file outside the project", async () => {
    const outside = join(tmpdir(), "engram-ew-outside.ts");
    writeFileSync(outside, "export const X = 1;\n");
    try {
      const result = await handleEditOrWrite({
        tool_name: "Write",
        cwd: tmpdir(),
        tool_input: { file_path: outside },
      });
      expect(result).toBe(PASSTHROUGH);
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it("passes through when tool_name is not Edit or Write", async () => {
    const result = await handleEditOrWrite({
      tool_name: "Delete" as unknown as "Edit",
      cwd: projectRoot,
      tool_input: { file_path: authFile },
    });
    expect(result).toBe(PASSTHROUGH);
  });

  it("passes through when file_path is missing", async () => {
    const result = await handleEditOrWrite({
      tool_name: "Edit",
      cwd: projectRoot,
      tool_input: {},
    });
    expect(result).toBe(PASSTHROUGH);
  });

  it("passes through for .env files (content safety)", async () => {
    const envFile = join(projectRoot, ".env");
    writeFileSync(envFile, "SECRET=abc\n");
    const result = await handleEditOrWrite(buildPayload("Edit", envFile));
    expect(result).toBe(PASSTHROUGH);
  });

  it("passes through for binary files", async () => {
    const binFile = join(projectRoot, "logo.png");
    writeFileSync(binFile, "fake binary");
    const result = await handleEditOrWrite(buildPayload("Edit", binFile));
    expect(result).toBe(PASSTHROUGH);
  });

  it("passes through when kill switch is enabled", async () => {
    writeFileSync(join(projectRoot, ".engram", "hook-disabled"), "");
    const result = await handleEditOrWrite(buildPayload("Edit", authFile));
    expect(result).toBe(PASSTHROUGH);
  });

  it("passes through for files in node_modules", async () => {
    const nmFile = join(projectRoot, "node_modules", "foo", "index.js");
    mkdirSync(join(projectRoot, "node_modules", "foo"), { recursive: true });
    writeFileSync(nmFile, "module.exports = {};");
    const result = await handleEditOrWrite(buildPayload("Edit", nmFile));
    expect(result).toBe(PASSTHROUGH);
  });

  // ────────────────────────────────────────────────────────────────────
  // Content format: warning must be agent-readable
  // ────────────────────────────────────────────────────────────────────
  it("includes the mistake label in the warning text", async () => {
    const result = await handleEditOrWrite(buildPayload("Edit", authFile));
    if (result === PASSTHROUGH) {
      // If we got passthrough the test is meaningless; fail loudly.
      expect.fail("expected warning response, got passthrough");
      return;
    }
    const wrapped = result as {
      hookSpecificOutput: { additionalContext: string };
    };
    const text = wrapped.hookSpecificOutput.additionalContext;
    // Should contain some of the seeded bug text (the session miner
    // extracts from bug:/fix: lines so the label reflects the snippet).
    expect(text.toLowerCase()).toMatch(/(bug|fix|verify|token|null)/);
  });

  it("includes the review-before-editing footer", async () => {
    const result = await handleEditOrWrite(buildPayload("Edit", authFile));
    if (result === PASSTHROUGH) return;
    const wrapped = result as {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(wrapped.hookSpecificOutput.additionalContext).toContain("Review");
  });

  // ────────────────────────────────────────────────────────────────────
  // Safety
  // ────────────────────────────────────────────────────────────────────
  it("never throws on malformed payload", async () => {
    await expect(
      handleEditOrWrite({
        tool_name: "Edit",
        cwd: "",
        tool_input: { file_path: "" },
      })
    ).resolves.toBe(PASSTHROUGH);
  });
});
