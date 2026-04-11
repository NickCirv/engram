/**
 * UserPromptSubmit handler tests. Exercises keyword extraction (pure
 * function) and the integration flow from prompt → query → injection.
 *
 * CRITICAL PRIVACY TEST: this handler sees every user message. Tests
 * assert that nothing in the response accidentally leaks the full prompt
 * text in an unstructured way.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { init } from "../../../src/core.js";
import {
  extractKeywords,
  handleUserPromptSubmit,
  type UserPromptHookPayload,
} from "../../../src/intercept/handlers/user-prompt.js";
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

// ────────────────────────────────────────────────────────────────────────
// Keyword extraction — pure function tests
// ────────────────────────────────────────────────────────────────────────
describe("extractKeywords", () => {
  it("extracts significant terms from a code question", () => {
    const keywords = extractKeywords("How does authentication work?");
    expect(keywords).toContain("authentication");
    expect(keywords).toContain("work");
  });

  it("drops stopwords", () => {
    const keywords = extractKeywords("The is was are to of for in on at by");
    expect(keywords).toEqual([]);
  });

  it("drops words under 3 characters", () => {
    const keywords = extractKeywords("on up at if as");
    expect(keywords).toEqual([]);
  });

  it("lowercases all tokens", () => {
    const keywords = extractKeywords("AuthService ValidateToken");
    expect(keywords).toContain("authservice");
    expect(keywords).toContain("validatetoken");
  });

  it("preserves identifiers with underscores", () => {
    const keywords = extractKeywords("does validate_token handle null?");
    expect(keywords).toContain("validate_token");
    expect(keywords).toContain("handle");
    expect(keywords).toContain("null");
  });

  it("splits on punctuation and whitespace", () => {
    const keywords = extractKeywords("auth.service: how do tokens work?");
    expect(keywords).toContain("auth");
    expect(keywords).toContain("service");
    expect(keywords).toContain("tokens");
    expect(keywords).toContain("work");
  });

  it("dedupes while preserving order", () => {
    const keywords = extractKeywords("token token validate token");
    expect(keywords.filter((k) => k === "token").length).toBe(1);
    expect(keywords.indexOf("token")).toBeLessThan(keywords.indexOf("validate"));
  });

  it("returns empty array for empty input", () => {
    expect(extractKeywords("")).toEqual([]);
  });

  it("returns empty array for non-string input", () => {
    expect(extractKeywords(null as unknown as string)).toEqual([]);
    expect(extractKeywords(undefined as unknown as string)).toEqual([]);
  });

  it("preserves numeric tokens ≥3 chars", () => {
    const keywords = extractKeywords("v0.3.0 release for api001");
    expect(keywords).toContain("api001");
  });
});

// ────────────────────────────────────────────────────────────────────────
// Integration — real graph with matching nodes
// ────────────────────────────────────────────────────────────────────────
describe("handleUserPromptSubmit — integration", () => {
  let projectRoot: string;

  beforeEach(async () => {
    _resetCacheForTests();
    projectRoot = mkdtempSync(join(tmpdir(), "engram-up-test-"));
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
      `export class Database { connect() {} }
export function runQuery(sql: string) { return []; }
export function closeConnection() {}
`
    );
    await init(projectRoot);
  });

  afterEach(() => {
    _resetCacheForTests();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function buildPayload(prompt: string): UserPromptHookPayload {
    return {
      hook_event_name: "UserPromptSubmit",
      cwd: projectRoot,
      prompt,
    };
  }

  it("injects context for a substantive code question", async () => {
    const result = await handleUserPromptSubmit(
      buildPayload("How does AuthService validate tokens?")
    );
    expect(result).not.toBe(PASSTHROUGH);
    if (result === PASSTHROUGH) return;
    const wrapped = result as {
      hookSpecificOutput: {
        hookEventName: string;
        additionalContext: string;
      };
    };
    expect(wrapped.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(wrapped.hookSpecificOutput.additionalContext).toContain(
      "[engram] Pre-query context"
    );
  });

  it("passes through short/generic prompts with <2 significant terms", async () => {
    const result = await handleUserPromptSubmit(buildPayload("yes"));
    expect(result).toBe(PASSTHROUGH);
  });

  it("passes through prompts that match no graph nodes", async () => {
    const result = await handleUserPromptSubmit(
      buildPayload("Explain raccoon migration patterns")
    );
    expect(result).toBe(PASSTHROUGH);
  });

  it("passes through when the prompt is all stopwords", async () => {
    const result = await handleUserPromptSubmit(
      buildPayload("the and is are to of for")
    );
    expect(result).toBe(PASSTHROUGH);
  });

  it("passes through for extremely long prompts (>8000 chars)", async () => {
    const huge = "auth ".repeat(2000); // 10,000 chars
    const result = await handleUserPromptSubmit(buildPayload(huge));
    expect(result).toBe(PASSTHROUGH);
  });

  it("passes through when cwd is outside any engram project", async () => {
    const result = await handleUserPromptSubmit({
      hook_event_name: "UserPromptSubmit",
      cwd: tmpdir(),
      prompt: "How does AuthService work?",
    });
    expect(result).toBe(PASSTHROUGH);
  });

  it("passes through when hook-disabled flag is present", async () => {
    writeFileSync(join(projectRoot, ".engram", "hook-disabled"), "");
    const result = await handleUserPromptSubmit(
      buildPayload("How does AuthService work?")
    );
    expect(result).toBe(PASSTHROUGH);
  });

  it("passes through when hook_event_name is wrong", async () => {
    const result = await handleUserPromptSubmit({
      hook_event_name: "PreToolUse" as unknown as "UserPromptSubmit",
      cwd: projectRoot,
      prompt: "How does AuthService work?",
    });
    expect(result).toBe(PASSTHROUGH);
  });

  // ── Privacy tests: prompt content must not leak accidentally ────────
  it("does NOT put the raw prompt text into the response", async () => {
    const prompt = "SECRET_PASSWORD_DO_NOT_LEAK_123 how does AuthService work?";
    const result = await handleUserPromptSubmit(buildPayload(prompt));
    if (result === PASSTHROUGH) return;
    const wrapped = result as {
      hookSpecificOutput: { additionalContext: string };
    };
    // The injection should NOT contain the full prompt verbatim.
    expect(wrapped.hookSpecificOutput.additionalContext).not.toContain(
      "SECRET_PASSWORD_DO_NOT_LEAK_123"
    );
  });

  it("never throws on malformed payload", async () => {
    await expect(
      handleUserPromptSubmit({
        hook_event_name: "UserPromptSubmit",
        cwd: "\0\0\0",
        prompt: "test",
      })
    ).resolves.toBe(PASSTHROUGH);
  });
});
