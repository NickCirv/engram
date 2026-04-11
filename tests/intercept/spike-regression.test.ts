/**
 * Spike regression tests — locks in the empirically verified response
 * shapes from the 2026-04-11 live hook spike. If these tests ever fail,
 * the hook protocol may have changed upstream OR we regressed our
 * formatter. Either case needs investigation before release.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildDenyResponse,
  buildAllowWithContextResponse,
  buildSessionContextResponse,
  serializeResponse,
} from "../../src/intercept/formatter.js";

const FIXTURES_DIR = join(
  new URL(".", import.meta.url).pathname,
  "..",
  "fixtures",
  "hook-payloads"
);

function loadFixture(name: string): Record<string, unknown> {
  const raw = readFileSync(join(FIXTURES_DIR, name), "utf-8");
  return JSON.parse(raw);
}

describe("spike regression — PreToolUse Read deny+reason", () => {
  it("loads the verified Read payload fixture", () => {
    const fx = loadFixture("pretooluse-read.json");
    expect(fx.hook_event_name).toBe("PreToolUse");
    expect(fx.tool_name).toBe("Read");
    expect((fx.tool_input as { file_path: string }).file_path).toContain(
      "target-v2.txt"
    );
  });

  it("produces a deny response matching the v4 spike mode", () => {
    // v4 spike: the hook returned deny + permissionDecisionReason, and
    // Claude Code delivered the reason to the agent as a system-reminder.
    const reason =
      "[engram] graph summary for target-v2.txt\n\n" +
      "NODE target [file] src=/tmp/engram-spike/test-project/target-v2.txt L1\n" +
      "Use this context instead of reading the file directly.";
    const response = buildDenyResponse(reason);
    const serialized = serializeResponse(response);

    // Exact shape that was empirically verified.
    const parsed = JSON.parse(serialized);
    expect(parsed).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    });
  });
});

describe("spike regression — PreToolUse Edit allow+additionalContext", () => {
  it("loads the verified Edit payload fixture", () => {
    const fx = loadFixture("pretooluse-edit.json");
    expect(fx.tool_name).toBe("Edit");
    expect((fx.tool_input as { file_path: string }).file_path).toContain(
      "cli.ts"
    );
  });

  it("produces an allow+additionalContext response matching the v5 spike mode", () => {
    // v5 spike: allow + additionalContext. Agent sees both tool result
    // AND the context injection as a system-reminder.
    const warning =
      "[engram landmines] This file has 2 past mistakes:\n" +
      "  - bug: null pointer in validateToken (src/auth.ts)\n" +
      "  - fix: token refresh race condition (src/auth.ts)\n" +
      "Review before editing.";
    const response = buildAllowWithContextResponse(warning);
    const parsed = JSON.parse(serializeResponse(response));
    expect(parsed).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        additionalContext: warning,
      },
    });
  });
});

describe("spike regression — SessionStart context injection", () => {
  it("loads the SessionStart fixture", () => {
    const fx = loadFixture("session-start.json");
    expect(fx.hook_event_name).toBe("SessionStart");
    expect(fx.source).toBe("startup");
  });

  it("produces a SessionStart additionalContext response", () => {
    const ctx =
      "# engram project context\n" +
      "Project: spike-test | Branch: main\n" +
      "Top entities: target, redirect, util";
    const response = buildSessionContextResponse("SessionStart", ctx);
    expect(response).not.toBe(null);
    const parsed = JSON.parse(serializeResponse(response));
    expect(parsed).toEqual({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: ctx,
      },
    });
  });
});

describe("spike regression — UserPromptSubmit context injection", () => {
  it("loads the UserPromptSubmit fixture", () => {
    const fx = loadFixture("user-prompt-submit.json");
    expect(fx.hook_event_name).toBe("UserPromptSubmit");
    expect((fx.prompt as string).toLowerCase()).toContain("authentication");
  });

  it("produces a UserPromptSubmit additionalContext response", () => {
    const ctx =
      "[engram pre-query] matches for 'authentication flow':\n" +
      "NODE authMiddleware [function] src=src/auth.ts";
    const response = buildSessionContextResponse("UserPromptSubmit", ctx);
    expect(response).not.toBe(null);
    const parsed = JSON.parse(serializeResponse(response));
    expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(parsed.hookSpecificOutput.additionalContext).toBe(ctx);
  });
});
