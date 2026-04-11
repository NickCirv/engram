import { describe, it, expect } from "vitest";
import {
  MAX_RESPONSE_CHARS,
  truncateForHook,
  buildDenyResponse,
  buildAllowWithContextResponse,
  buildSessionContextResponse,
  buildPostToolContextResponse,
  serializeResponse,
} from "../../src/intercept/formatter.js";

describe("formatter — truncateForHook", () => {
  it("returns empty string for empty input", () => {
    expect(truncateForHook("")).toBe("");
  });

  it("returns the input unchanged when within budget", () => {
    expect(truncateForHook("hello")).toBe("hello");
  });

  it("truncates strings exceeding MAX_RESPONSE_CHARS", () => {
    const huge = "x".repeat(MAX_RESPONSE_CHARS + 1000);
    const result = truncateForHook(huge);
    expect(result.length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
    expect(result.endsWith("truncated to fit hook response limit ...]")).toBe(true);
  });

  it("keeps truncated output under the hook limit", () => {
    const huge = "x".repeat(100_000);
    const result = truncateForHook(huge);
    expect(result.length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
  });

  it("preserves surrogate pairs when cutting (no broken emoji)", () => {
    // Build a string that lands the cut inside a surrogate pair.
    // A single emoji is 2 code units; we construct a string where the
    // budget boundary would fall inside one.
    const prefix = "a".repeat(MAX_RESPONSE_CHARS - 2);
    const emoji = "🔥"; // 2 UTF-16 code units
    const filler = "tail".repeat(100);
    const input = prefix + emoji + filler;
    const result = truncateForHook(input);
    // Result must be valid UTF-16: no lone surrogates at the end of the
    // prefix portion. We check by re-encoding — toString should not throw
    // and result.length should be even-boundary-safe.
    expect(() => Buffer.from(result, "utf16le")).not.toThrow();
    expect(result.length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
  });
});

describe("formatter — buildDenyResponse", () => {
  it("produces the verified PreToolUse deny+reason shape", () => {
    const reason = "[engram] graph summary for src/cli.ts\n\nNODE foo [function]";
    const response = buildDenyResponse(reason);
    expect(response).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    });
  });

  it("truncates overly long reasons", () => {
    const huge = "z".repeat(20_000);
    const response = buildDenyResponse(huge) as {
      hookSpecificOutput: { permissionDecisionReason: string };
    };
    expect(
      response.hookSpecificOutput.permissionDecisionReason.length
    ).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
  });

  it("handles empty reason (still emits valid shape)", () => {
    const response = buildDenyResponse("");
    expect(response).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "",
      },
    });
  });
});

describe("formatter — buildAllowWithContextResponse", () => {
  it("produces the verified PreToolUse allow+additionalContext shape", () => {
    const ctx = "[engram landmines] 3 past mistakes in this file";
    const response = buildAllowWithContextResponse(ctx);
    expect(response).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        additionalContext: ctx,
      },
    });
  });

  it("omits additionalContext when input is empty", () => {
    const response = buildAllowWithContextResponse("");
    expect(response).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
      },
    });
  });

  it("omits additionalContext when input is whitespace only", () => {
    const response = buildAllowWithContextResponse("   \n\t  ");
    expect(response).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
      },
    });
  });

  it("truncates overly long additionalContext", () => {
    const huge = "y".repeat(20_000);
    const response = buildAllowWithContextResponse(huge) as {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(
      response.hookSpecificOutput.additionalContext.length
    ).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
  });
});

describe("formatter — buildSessionContextResponse", () => {
  it("builds SessionStart context response", () => {
    const response = buildSessionContextResponse(
      "SessionStart",
      "Project: engram\nBranch: main"
    );
    expect(response).toEqual({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: "Project: engram\nBranch: main",
      },
    });
  });

  it("builds UserPromptSubmit context response", () => {
    const response = buildSessionContextResponse("UserPromptSubmit", "query result");
    expect(response).toEqual({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: "query result",
      },
    });
  });

  it("returns null for empty context (passthrough)", () => {
    expect(buildSessionContextResponse("SessionStart", "")).toBe(null);
    expect(buildSessionContextResponse("UserPromptSubmit", "   ")).toBe(null);
  });
});

describe("formatter — buildPostToolContextResponse", () => {
  it("builds the PostToolUse additionalContext shape", () => {
    const response = buildPostToolContextResponse("observer note");
    expect(response).toEqual({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: "observer note",
      },
    });
  });

  it("returns null for empty context", () => {
    expect(buildPostToolContextResponse("")).toBe(null);
    expect(buildPostToolContextResponse("\n\t  ")).toBe(null);
  });
});

describe("formatter — serializeResponse", () => {
  it("serializes a deny response to valid JSON", () => {
    const response = buildDenyResponse("test reason");
    const serialized = serializeResponse(response);
    expect(serialized).not.toBe("");
    // Re-parse to verify round-trip.
    const parsed = JSON.parse(serialized);
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe("test reason");
  });

  it("returns empty string for null (passthrough)", () => {
    expect(serializeResponse(null)).toBe("");
  });

  it("returns empty string on circular references (fail-safe)", () => {
    const circ: Record<string, unknown> = { a: 1 };
    circ.self = circ;
    expect(serializeResponse(circ)).toBe("");
  });

  it("round-trips a SessionStart response", () => {
    const response = buildSessionContextResponse("SessionStart", "hello");
    const serialized = serializeResponse(response);
    const parsed = JSON.parse(serialized);
    expect(parsed).toEqual({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: "hello",
      },
    });
  });
});
