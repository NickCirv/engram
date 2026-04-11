/**
 * PostToolUse observer tests. Verifies that the handler:
 *   1. Always returns PASSTHROUGH (pure observer, no injection)
 *   2. Logs entries to .engram/hook-log.jsonl
 *   3. Extracts file_path for Read/Edit/Write tools
 *   4. Honors the kill switch (no logging when disabled)
 *   5. Never throws on any input
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { init } from "../../../src/core.js";
import {
  handlePostTool,
  type PostToolHookPayload,
} from "../../../src/intercept/handlers/post-tool.js";
import { PASSTHROUGH } from "../../../src/intercept/safety.js";
import { _resetCacheForTests } from "../../../src/intercept/context.js";
import { readHookLog } from "../../../src/intelligence/hook-log.js";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("handlePostTool — pure observer", () => {
  let projectRoot: string;

  beforeEach(async () => {
    _resetCacheForTests();
    projectRoot = mkdtempSync(join(tmpdir(), "engram-pt-test-"));
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(
      join(projectRoot, "src", "index.ts"),
      "export const X = 1;\n"
    );
    await init(projectRoot);
  });

  afterEach(() => {
    _resetCacheForTests();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function buildPayload(
    tool: string,
    extras: Partial<PostToolHookPayload> = {}
  ): PostToolHookPayload {
    return {
      hook_event_name: "PostToolUse",
      cwd: projectRoot,
      tool_name: tool,
      tool_input: { file_path: join(projectRoot, "src", "index.ts") },
      tool_response: "file content",
      ...extras,
    };
  }

  it("always returns PASSTHROUGH (never injects)", async () => {
    const result = await handlePostTool(buildPayload("Read"));
    expect(result).toBe(PASSTHROUGH);
  });

  it("logs an entry with tool name", async () => {
    await handlePostTool(buildPayload("Read"));
    const log = readHookLog(projectRoot);
    expect(log.length).toBe(1);
    expect(log[0].event).toBe("PostToolUse");
    expect(log[0].tool).toBe("Read");
  });

  it("extracts file_path for Read tool", async () => {
    const fp = join(projectRoot, "src", "index.ts");
    await handlePostTool(buildPayload("Read", { tool_input: { file_path: fp } }));
    const log = readHookLog(projectRoot);
    expect(log[0].path).toBe(fp);
  });

  it("extracts file_path for Edit tool", async () => {
    const fp = join(projectRoot, "src", "index.ts");
    await handlePostTool(buildPayload("Edit", { tool_input: { file_path: fp } }));
    const log = readHookLog(projectRoot);
    expect(log[0].path).toBe(fp);
  });

  it("extracts file_path for Write tool", async () => {
    const fp = join(projectRoot, "src", "index.ts");
    await handlePostTool(buildPayload("Write", { tool_input: { file_path: fp } }));
    const log = readHookLog(projectRoot);
    expect(log[0].path).toBe(fp);
  });

  it("does NOT extract path for Bash tool", async () => {
    await handlePostTool(
      buildPayload("Bash", {
        tool_input: { command: "ls -la" },
        tool_response: "output here",
      })
    );
    const log = readHookLog(projectRoot);
    expect(log[0].path).toBeUndefined();
    expect(log[0].tool).toBe("Bash");
  });

  it("records output size from string responses", async () => {
    await handlePostTool(
      buildPayload("Read", { tool_response: "hello world" })
    );
    const log = readHookLog(projectRoot);
    expect(log[0].outputSize).toBe("hello world".length);
  });

  it("records output size from object responses with output field", async () => {
    await handlePostTool(
      buildPayload("Read", { tool_response: { output: "abcdef" } })
    );
    const log = readHookLog(projectRoot);
    expect(log[0].outputSize).toBe(6);
  });

  it("marks success=true on clean response", async () => {
    await handlePostTool(buildPayload("Read"));
    const log = readHookLog(projectRoot);
    expect(log[0].success).toBe(true);
  });

  it("marks success=false when response has error field", async () => {
    await handlePostTool(
      buildPayload("Read", { tool_response: { error: "file not found" } })
    );
    const log = readHookLog(projectRoot);
    expect(log[0].success).toBe(false);
  });

  it("PASSES THROUGH when cwd is invalid (bad path guard)", async () => {
    const result = await handlePostTool({
      hook_event_name: "PostToolUse",
      cwd: "\0\0\0",
      tool_name: "Read",
      tool_input: {},
      tool_response: "",
    });
    expect(result).toBe(PASSTHROUGH);
    // And nothing should be logged.
    expect(readHookLog(projectRoot)).toEqual([]);
  });

  it("PASSES THROUGH when cwd is outside any engram project", async () => {
    const result = await handlePostTool({
      hook_event_name: "PostToolUse",
      cwd: tmpdir(),
      tool_name: "Read",
      tool_input: {},
      tool_response: "",
    });
    expect(result).toBe(PASSTHROUGH);
  });

  it("does NOT log when hook-disabled flag is present", async () => {
    writeFileSync(join(projectRoot, ".engram", "hook-disabled"), "");
    await handlePostTool(buildPayload("Read"));
    expect(readHookLog(projectRoot)).toEqual([]);
  });

  it("passes through when hook_event_name is wrong", async () => {
    const result = await handlePostTool({
      hook_event_name: "PreToolUse" as unknown as "PostToolUse",
      cwd: projectRoot,
      tool_name: "Read",
      tool_input: {},
      tool_response: "",
    });
    expect(result).toBe(PASSTHROUGH);
  });

  it("never throws on weird tool_response shapes", async () => {
    await expect(
      handlePostTool(buildPayload("Read", { tool_response: undefined }))
    ).resolves.toBe(PASSTHROUGH);
    await expect(
      handlePostTool(buildPayload("Read", { tool_response: null }))
    ).resolves.toBe(PASSTHROUGH);
    await expect(
      handlePostTool(
        buildPayload("Read", { tool_response: { deep: { nested: 1 } } })
      )
    ).resolves.toBe(PASSTHROUGH);
  });

  it("appends multiple log entries across invocations", async () => {
    await handlePostTool(buildPayload("Read"));
    await handlePostTool(buildPayload("Edit"));
    await handlePostTool(buildPayload("Write"));
    const log = readHookLog(projectRoot);
    expect(log.length).toBe(3);
    expect(log.map((e) => e.tool)).toEqual(["Read", "Edit", "Write"]);
  });
});
