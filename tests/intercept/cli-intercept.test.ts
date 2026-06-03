/**
 * End-to-end CLI tests for `engram intercept`. Spawns the built CLI
 * as a subprocess, pipes a JSON payload on stdin, and asserts the
 * stdout JSON matches the expected handler response.
 *
 * This is the first layer that proves the whole pipeline works:
 *   stdin JSON → dispatchHook → handler → formatter → stdout JSON
 *
 * Requires `npm run build` before running so dist/cli.js exists.
 * The test auto-builds in beforeAll if the dist file is missing.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { init } from "../../src/core.js";

// fileURLToPath is required on Windows — `new URL(...).pathname` returns
// `/C:/Users/...` which then gets a second drive letter prepended by
// resolve(), producing `C:\C:\Users\...` and an ENOENT.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI_PATH = join(REPO_ROOT, "dist", "cli.js");

// Guard: build the CLI if it doesn't exist yet. On Windows `npm` is a
// `.cmd` shim that spawnSync can't exec without `shell: true`, so we
// detect the platform and enable shell there.
beforeAll(() => {
  if (!existsSync(CLI_PATH)) {
    const r = spawnSync("npm", ["run", "build"], {
      cwd: REPO_ROOT,
      stdio: "ignore",
      timeout: 60_000,
      shell: process.platform === "win32",
    });
    if (r.status !== 0) {
      throw new Error(`npm run build failed with status ${r.status}`);
    }
  }
}, 90_000);

/**
 * Run `engram intercept` with a given JSON payload on stdin.
 * Returns { stdout, stderr, status }.
 */
function runIntercept(payload: unknown): {
  stdout: string;
  stderr: string;
  status: number | null;
} {
  const result = spawnSync("node", [CLI_PATH, "intercept"], {
    input: JSON.stringify(payload),
    encoding: "utf-8",
    timeout: 10_000,
  });
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    status: result.status,
  };
}

describe("engram intercept — end-to-end subprocess tests", () => {
  let projectRoot: string;
  let authFile: string;

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), "engram-cli-intercept-"));
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    authFile = join(projectRoot, "src", "auth.ts");
    writeFileSync(
      authFile,
      `// Realistically sized so engram's summary is smaller than the file
// (the Read hook now passes tiny files through — they don't benefit).
export class AuthService {
  validate(token: string): boolean {
    if (!token) return false;
    return token.startsWith("tok_") && token.length > 6;
  }
  issue(userId: string): string {
    return "tok_" + userId + "_" + userId.length.toString(36);
  }
  rotate(oldToken: string, userId: string): string {
    if (!this.validate(oldToken)) throw new Error("invalid");
    return this.issue(userId);
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
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("ALWAYS exits 0 (never blocks Claude Code)", () => {
    // Empty input.
    let r = runIntercept(undefined);
    expect(r.status).toBe(0);
    // Malformed JSON.
    r = spawnSync("node", [CLI_PATH, "intercept"], {
      input: "not valid json",
      encoding: "utf-8",
      timeout: 10_000,
    });
    expect(r.status).toBe(0);
    // Bizarre payload.
    r = runIntercept({ totally_wrong: true });
    expect(r.status).toBe(0);
  });

  it("produces deny+reason for a high-confidence Read", () => {
    const result = runIntercept({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      cwd: projectRoot,
      tool_input: { file_path: authFile },
    });
    expect(result.status).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.hookSpecificOutput).toBeDefined();
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(
      parsed.hookSpecificOutput.permissionDecisionReason
    ).toContain("[engram] Structural summary");
  });

  it("produces no stdout (passthrough) for a file not in the graph", () => {
    const ghost = join(projectRoot, "src", "not-indexed-yet.ts");
    writeFileSync(ghost, "export const X = 1;\n");
    const result = runIntercept({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      cwd: projectRoot,
      tool_input: { file_path: ghost },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("produces no stdout for unknown tool names", () => {
    const result = runIntercept({
      hook_event_name: "PreToolUse",
      tool_name: "Glob",
      cwd: projectRoot,
      tool_input: { pattern: "*.ts" },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("produces SessionStart additionalContext for startup source", () => {
    const result = runIntercept({
      hook_event_name: "SessionStart",
      cwd: projectRoot,
      source: "startup",
    });
    expect(result.status).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "[engram] Project brief"
    );
  });

  it("produces no stdout for SessionStart with source=resume", () => {
    const result = runIntercept({
      hook_event_name: "SessionStart",
      cwd: projectRoot,
      source: "resume",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("respects the kill switch flag", () => {
    writeFileSync(join(projectRoot, ".engram", "hook-disabled"), "");
    const result = runIntercept({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      cwd: projectRoot,
      tool_input: { file_path: authFile },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });
}, 60_000);
