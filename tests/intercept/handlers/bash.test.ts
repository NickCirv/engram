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
  parseGrepBashCommand,
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
// Grep parser — content-mode symbol greps only (ADR-0005)
// ────────────────────────────────────────────────────────────────────────
describe("parseGrepBashCommand", () => {
  it("parses a plain rg/grep of a symbol", () => {
    expect(parseGrepBashCommand("rg handleAuth")).toBe("handleAuth");
    expect(parseGrepBashCommand("grep handleAuth")).toBe("handleAuth");
    expect(parseGrepBashCommand("egrep handleAuth")).toBe("handleAuth");
    expect(parseGrepBashCommand("rg handleAuth src/")).toBe("handleAuth");
  });

  it("handles safe boolean flags + bundles", () => {
    expect(parseGrepBashCommand("rg -n handleAuth")).toBe("handleAuth");
    expect(parseGrepBashCommand("rg -w handleAuth")).toBe("handleAuth");
    expect(parseGrepBashCommand("grep -rn handleAuth")).toBe("handleAuth");
    expect(parseGrepBashCommand("grep -rni handleAuth .")).toBe("handleAuth");
    expect(parseGrepBashCommand("rg --word-regexp handleAuth")).toBe("handleAuth");
  });

  it("handles -e / --regexp pattern flags", () => {
    expect(parseGrepBashCommand("rg -e handleAuth")).toBe("handleAuth");
    expect(parseGrepBashCommand("grep -rn -e handleAuth src/")).toBe("handleAuth");
  });

  it("strips surrounding quotes", () => {
    expect(parseGrepBashCommand('rg "handleAuth"')).toBe("handleAuth");
    expect(parseGrepBashCommand("rg 'handleAuth'")).toBe("handleAuth");
    expect(parseGrepBashCommand('grep -rn "handleAuth"')).toBe("handleAuth");
  });

  it("rejects files/count/invert modes (not a content search)", () => {
    expect(parseGrepBashCommand("rg -l handleAuth")).toBe(null);
    expect(parseGrepBashCommand("rg --files-with-matches handleAuth")).toBe(null);
    expect(parseGrepBashCommand("grep -c handleAuth")).toBe(null);
    expect(parseGrepBashCommand("rg -o handleAuth")).toBe(null);
    expect(parseGrepBashCommand("grep -v handleAuth")).toBe(null);
    expect(parseGrepBashCommand("grep -rl handleAuth")).toBe(null); // bundle w/ l
  });

  it("rejects shell control chars (pipe/redirect/subst/chain)", () => {
    expect(parseGrepBashCommand("rg handleAuth | head")).toBe(null);
    expect(parseGrepBashCommand("rg handleAuth > out.txt")).toBe(null);
    expect(parseGrepBashCommand("rg $(echo handleAuth)")).toBe(null);
    expect(parseGrepBashCommand("cd src && rg handleAuth")).toBe(null);
    expect(parseGrepBashCommand("rg handleAuth; ls")).toBe(null);
  });

  it("rejects arg-taking / unknown flags (can't safely find the pattern)", () => {
    expect(parseGrepBashCommand("rg -A 3 handleAuth")).toBe(null);
    expect(parseGrepBashCommand("rg -m 5 handleAuth")).toBe(null);
    expect(parseGrepBashCommand("rg --max-count 5 handleAuth")).toBe(null);
    expect(parseGrepBashCommand("rg -g '*.ts' handleAuth")).toBe(null);
  });

  it("rejects non-grep commands and malformed input", () => {
    expect(parseGrepBashCommand("cat handleAuth")).toBe(null);
    expect(parseGrepBashCommand("ls")).toBe(null);
    expect(parseGrepBashCommand("rg")).toBe(null); // no pattern
    expect(parseGrepBashCommand("  rg handleAuth")).toBe(null); // leading ws
    expect(parseGrepBashCommand("")).toBe(null);
    expect(parseGrepBashCommand(null as unknown as string)).toBe(null);
  });

  it("rejects output-mode flags placed AFTER the pattern (BUG-1)", () => {
    // The agent asked 'which files / how many', not for call-site lines —
    // intercepting these as a content search would answer the wrong question.
    expect(parseGrepBashCommand("rg init -l")).toBe(null);
    expect(parseGrepBashCommand("grep init -c")).toBe(null);
    expect(parseGrepBashCommand("rg handleAuth -o")).toBe(null);
    expect(parseGrepBashCommand("grep handleAuth -v")).toBe(null);
    expect(parseGrepBashCommand("rg handleAuth -A 3")).toBe(null); // arg-flag after pattern
    expect(parseGrepBashCommand("rg handleAuth --files-with-matches")).toBe(null);
  });

  it("rejects -e/--regexp when the next token is itself a flag (BUG-2)", () => {
    expect(parseGrepBashCommand("rg -e -l")).toBe(null);
    expect(parseGrepBashCommand("grep --regexp -c")).toBe(null);
    expect(parseGrepBashCommand("grep -e")).toBe(null); // dangling
  });

  it("still accepts a content grep with trailing file-path args", () => {
    expect(parseGrepBashCommand("grep -rn handleAuth src/")).toBe("handleAuth");
    expect(parseGrepBashCommand("rg handleAuth src/a.ts")).toBe("handleAuth");
    expect(parseGrepBashCommand("grep -e handleAuth src/a.ts")).toBe("handleAuth");
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
      `// Auth service — realistically sized so engram's summary is smaller than
// the file (tiny stub files now pass through by design).
export class AuthService {
  validate(token: string): boolean {
    if (!token) return false;
    return token.startsWith("tok_") && token.length > 6;
  }
  issue(userId: string): string {
    return "tok_" + userId + "_" + userId.length.toString(36);
  }
}
export class SessionStore {
  private sessions = new Map<string, number>();
  create(userId: string): string {
    const id = "sess_" + userId;
    this.sessions.set(id, Date.now());
    return id;
  }
  isActive(id: string): boolean { return this.sessions.has(id); }
}
export function createAuthService(): AuthService { return new AuthService(); }
export function verifyToken(t: string): boolean {
  return typeof t === "string" && t.startsWith("tok_");
}
export function hashPassword(p: string): string {
  let h = 0;
  for (let i = 0; i < p.length; i++) h = (h * 31 + p.charCodeAt(i)) | 0;
  return "h_" + (h >>> 0).toString(16);
}
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

  // POSIX-form path for the Bash command. On Windows, native `\` are shell
  // escape chars and the strict parser in handleBash rejects them via
  // UNSAFE_SHELL_CHARS. A real agent running Bash (git-bash / cygwin)
  // on Windows produces forward-slash paths.
  const toBashPath = (p: string): string => p.replace(/\\/g, "/");

  it("delegates 'cat <file>' to handleRead and returns deny+summary", async () => {
    const result = await handleBash(buildPayload(`cat ${toBashPath(authFile)}`));
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
    const result = await handleBash(buildPayload(`head ${toBashPath(authFile)}`));
    expect(result).not.toBe(PASSTHROUGH);
  });

  it("passes through when command uses pipes", async () => {
    const result = await handleBash(
      buildPayload(`cat ${toBashPath(authFile)} | grep validate`)
    );
    expect(result).toBe(PASSTHROUGH);
  });

  it("passes through for non-Bash tools", async () => {
    const result = await handleBash({
      tool_name: "Read" as unknown as "Bash",
      cwd: projectRoot,
      tool_input: { command: `cat ${toBashPath(authFile)}` },
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
    const result = await handleBash(buildPayload(`cat ${toBashPath(bin)}`));
    // The delegated Read handler rejects binaries.
    expect(result).toBe(PASSTHROUGH);
  });

  it("passes through when cat targets a .env file", async () => {
    const envFile = join(projectRoot, ".env");
    writeFileSync(envFile, "SECRET=x\n");
    const result = await handleBash(buildPayload(`cat ${toBashPath(envFile)}`));
    expect(result).toBe(PASSTHROUGH);
  });

  it("delegates a Bash 'rg <symbol>' to handleGrep — call-site packet (ADR-0005)", async () => {
    // Many caller files, two calls each, so the raw grep is genuinely larger
    // than engram's packet — a real win that clears the ADR-0007 never-worse
    // size gate (not just MIN_CALLER_FILES).
    writeFileSync(
      join(projectRoot, "src", "hashutil.ts"),
      "export function hashThing(s: string): number { let h = 0; for (const c of s) h = (h*31 + c.charCodeAt(0))|0; return h >>> 0; }\n"
    );
    for (let n = 1; n <= 16; n++) {
      writeFileSync(
        join(projectRoot, "src", `caller${n}.ts`),
        `import { hashThing } from "./hashutil";\n` +
          `export function use${n}a(x: string): number { return hashThing(x); }\n` +
          `export function use${n}b(x: string): number { return hashThing(hashThing(x)); }\n`
      );
    }
    await init(projectRoot);

    const result = (await handleBash(buildPayload("rg hashThing"))) as Record<
      string,
      unknown
    >;
    expect(result).not.toBe(PASSTHROUGH);
    const reason = (result.hookSpecificOutput as Record<string, unknown>)
      .permissionDecisionReason as string;
    expect(reason).toContain("hashThing");
    expect(reason).toContain("call site");
    expect(reason).toContain('rg -n "hashThing"'); // escalation preserved
  });

  it("passes through a Bash 'rg -l <symbol>' (files mode, not content)", async () => {
    expect(await handleBash(buildPayload("rg -l AuthService"))).toBe(PASSTHROUGH);
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
