/**
 * Bash handler tests. Split into two layers:
 *
 *   1. parseReadLikeBashCommand — pure parser tests. Exhaustive over the
 *      shell metacharacter space because misparsing a Bash command is
 *      how you corrupt user workflows.
 *
 *   2. handleBash — integration tests that delegate to handleRead after
 *      a successful parse. Uses the same fixture pattern as read.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { init } from "../../../src/core.js";
import {
  handleBash,
  parseReadLikeBashCommand,
  type BashHookPayload,
} from "../../../src/intercept/handlers/bash.js";
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
// Parser layer — pure function tests, no graph involvement
// ────────────────────────────────────────────────────────────────────────
describe("parseReadLikeBashCommand", () => {
  it("parses cat <file> into a file path", () => {
    expect(parseReadLikeBashCommand("cat src/auth.ts")).toBe("src/auth.ts");
  });

  it("parses head <file>", () => {
    expect(parseReadLikeBashCommand("head README.md")).toBe("README.md");
  });

  it("parses tail <file>", () => {
    expect(parseReadLikeBashCommand("tail logs/error.log")).toBe("logs/error.log");
  });

  it("parses less <file>", () => {
    expect(parseReadLikeBashCommand("less CHANGELOG.md")).toBe("CHANGELOG.md");
  });

  it("parses more <file>", () => {
    expect(parseReadLikeBashCommand("more notes.txt")).toBe("notes.txt");
  });

  it("parses absolute paths", () => {
    expect(parseReadLikeBashCommand("cat /tmp/foo.txt")).toBe("/tmp/foo.txt");
  });

  // ── Rejections for shell metacharacters ─────────────────────────────
  it("rejects pipes", () => {
    expect(parseReadLikeBashCommand("cat foo.ts | grep bar")).toBe(null);
  });

  it("rejects redirects", () => {
    expect(parseReadLikeBashCommand("cat foo.ts > out.txt")).toBe(null);
  });

  it("rejects command substitution with $()", () => {
    expect(parseReadLikeBashCommand("cat $(find . -name foo)")).toBe(null);
  });

  it("rejects backtick command substitution", () => {
    expect(parseReadLikeBashCommand("cat `find . -name foo`")).toBe(null);
  });

  it("rejects semicolons", () => {
    expect(parseReadLikeBashCommand("cd /tmp; cat foo.ts")).toBe(null);
  });

  it("rejects && chains", () => {
    expect(parseReadLikeBashCommand("cd /tmp && cat foo.ts")).toBe(null);
  });

  it("rejects || chains", () => {
    expect(parseReadLikeBashCommand("cat foo.ts || echo fail")).toBe(null);
  });

  it("rejects globs", () => {
    expect(parseReadLikeBashCommand("cat src/*.ts")).toBe(null);
  });

  it("rejects question mark wildcards", () => {
    expect(parseReadLikeBashCommand("cat foo.?s")).toBe(null);
  });

  it("rejects bracket expansion", () => {
    expect(parseReadLikeBashCommand("cat [ab].ts")).toBe(null);
  });

  it("rejects brace expansion", () => {
    expect(parseReadLikeBashCommand("cat {a,b}.ts")).toBe(null);
  });

  it("rejects quoted arguments", () => {
    expect(parseReadLikeBashCommand('cat "foo bar.ts"')).toBe(null);
  });

  it("rejects single-quoted arguments", () => {
    expect(parseReadLikeBashCommand("cat 'foo.ts'")).toBe(null);
  });

  it("rejects escape characters", () => {
    expect(parseReadLikeBashCommand("cat foo\\ bar.ts")).toBe(null);
  });

  it("rejects background operators (&)", () => {
    expect(parseReadLikeBashCommand("cat foo.ts &")).toBe(null);
  });

  it("rejects input redirects (<)", () => {
    expect(parseReadLikeBashCommand("cat < foo.ts")).toBe(null);
  });

  // ── Rejections for argument count / shape ──────────────────────────
  it("rejects multi-arg (two files)", () => {
    expect(parseReadLikeBashCommand("cat a.ts b.ts")).toBe(null);
  });

  it("rejects flags", () => {
    expect(parseReadLikeBashCommand("head -n 20 foo.ts")).toBe(null);
  });

  it("rejects commands with leading flags", () => {
    expect(parseReadLikeBashCommand("cat -A foo.ts")).toBe(null);
  });

  it("rejects empty input", () => {
    expect(parseReadLikeBashCommand("")).toBe(null);
  });

  it("rejects whitespace-only input", () => {
    expect(parseReadLikeBashCommand("   ")).toBe(null);
  });

  it("rejects leading whitespace in the command", () => {
    expect(parseReadLikeBashCommand(" cat foo.ts")).toBe(null);
  });

  it("rejects trailing whitespace in the command", () => {
    expect(parseReadLikeBashCommand("cat foo.ts ")).toBe(null);
  });

  it("rejects unknown commands", () => {
    expect(parseReadLikeBashCommand("vim foo.ts")).toBe(null);
    expect(parseReadLikeBashCommand("echo foo.ts")).toBe(null);
    expect(parseReadLikeBashCommand("ls foo.ts")).toBe(null);
  });

  it("rejects overly long commands (>200 chars)", () => {
    const longPath = "cat " + "a".repeat(250);
    expect(parseReadLikeBashCommand(longPath)).toBe(null);
  });

  it("rejects null bytes in path", () => {
    expect(parseReadLikeBashCommand("cat foo\0bar.ts")).toBe(null);
  });

  it("rejects non-string input", () => {
    expect(parseReadLikeBashCommand(null as unknown as string)).toBe(null);
    expect(parseReadLikeBashCommand(undefined as unknown as string)).toBe(null);
    expect(parseReadLikeBashCommand(42 as unknown as string)).toBe(null);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Integration layer — delegates to handleRead with a real graph
// ────────────────────────────────────────────────────────────────────────
describe("handleBash — integration tests", () => {
  let projectRoot: string;
  let authFile: string;

  beforeEach(async () => {
    _resetCacheForTests();
    projectRoot = mkdtempSync(join(tmpdir(), "engram-bash-test-"));
    mkdirSync(join(projectRoot, "src"), { recursive: true });

    authFile = join(projectRoot, "src", "auth.ts");
    writeFileSync(
      authFile,
      `export class AuthService { validate() { return true; } }
export class SessionStore { create() { return "s"; } }
export function createAuthService() { return new AuthService(); }
export function verifyToken(t: string) { return !!t; }
export function hashPassword(p: string) { return "h_" + p; }
`
    );
    await init(projectRoot);
  });

  afterEach(() => {
    _resetCacheForTests();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function buildPayload(command: string): BashHookPayload {
    return {
      tool_name: "Bash",
      cwd: projectRoot,
      tool_input: { command },
    };
  }

  it("delegates 'cat <file>' to handleRead and returns deny+summary", async () => {
    const result = await handleBash(buildPayload(`cat ${authFile}`));
    expect(result).not.toBe(PASSTHROUGH);
    if (result === PASSTHROUGH) return;

    const wrapped = result as {
      hookSpecificOutput: {
        permissionDecision: string;
        permissionDecisionReason: string;
      };
    };
    expect(wrapped.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(wrapped.hookSpecificOutput.permissionDecisionReason).toContain(
      "[engram] Structural summary for src/auth.ts"
    );
  });

  it("delegates 'head <file>' the same way", async () => {
    const result = await handleBash(buildPayload(`head ${authFile}`));
    expect(result).not.toBe(PASSTHROUGH);
  });

  it("passes through when command uses pipes", async () => {
    const result = await handleBash(buildPayload(`cat ${authFile} | grep validate`));
    expect(result).toBe(PASSTHROUGH);
  });

  it("passes through for non-Bash tools", async () => {
    const result = await handleBash({
      tool_name: "Read" as unknown as "Bash",
      cwd: projectRoot,
      tool_input: { command: `cat ${authFile}` },
    });
    expect(result).toBe(PASSTHROUGH);
  });

  it("passes through when command is missing", async () => {
    const result = await handleBash({
      tool_name: "Bash",
      cwd: projectRoot,
      tool_input: {},
    });
    expect(result).toBe(PASSTHROUGH);
  });

  it("passes through when cat targets a binary file", async () => {
    const bin = join(projectRoot, "logo.png");
    writeFileSync(bin, "\x89PNG");
    const result = await handleBash(buildPayload(`cat ${bin}`));
    // The delegated Read handler rejects binaries.
    expect(result).toBe(PASSTHROUGH);
  });

  it("passes through when cat targets a .env file", async () => {
    const envFile = join(projectRoot, ".env");
    writeFileSync(envFile, "SECRET=x\n");
    const result = await handleBash(buildPayload(`cat ${envFile}`));
    expect(result).toBe(PASSTHROUGH);
  });

  it("never throws on malformed command input", async () => {
    await expect(
      handleBash({
        tool_name: "Bash",
        cwd: projectRoot,
        tool_input: { command: "\0\0\0\0" },
      })
    ).resolves.toBe(PASSTHROUGH);
  });
});
