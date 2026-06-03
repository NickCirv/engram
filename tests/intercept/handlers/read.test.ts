/**
 * PreToolUse:Read handler integration tests.
 *
 * These are the critical-path tests for v0.3.0 Sentinel. They verify the
 * complete Read interception flow: hook payload in → handler decides →
 * valid deny+reason response OR passthrough.
 *
 * Every branch in handleRead is covered:
 *   1. Wrong tool_name → passthrough
 *   2. Missing file_path → passthrough
 *   3. Partial read (offset/limit) → passthrough  [bypass mechanism]
 *   4. Binary/secret content → passthrough
 *   5. Outside project → passthrough
 *   6. Kill switch enabled → passthrough
 *   7. File not in graph → passthrough
 *   8. Stale graph → passthrough
 *   9. Low confidence → passthrough
 *   10. High confidence → deny + reason with summary  (the money path)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { init } from "../../../src/core.js";
import {
  handleRead,
  READ_CONFIDENCE_THRESHOLD,
  type ReadHookPayload,
} from "../../../src/intercept/handlers/read.js";
import { PASSTHROUGH } from "../../../src/intercept/safety.js";
import { _resetCacheForTests } from "../../../src/intercept/context.js";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  utimesSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("handleRead — integration tests", () => {
  let projectRoot: string;
  let authFile: string;
  let indexFile: string;
  let shallowFile: string;

  beforeEach(async () => {
    _resetCacheForTests();
    projectRoot = mkdtempSync(join(tmpdir(), "engram-read-h-test-"));
    mkdirSync(join(projectRoot, "src"), { recursive: true });

    // auth.ts: rich content — 2 classes + 3 exported functions so the AST
    // miner (which extracts classes and functions as nodes) produces
    // enough code declarations to cross the 0.7 confidence threshold.
    authFile = join(projectRoot, "src", "auth.ts");
    // A realistically-sized file (function bodies + comments) so engram's
    // structural summary is genuinely SMALLER than the raw file — i.e. a file
    // engram actually saves tokens on. (Tiny stub files now pass through by
    // design: replacing them would add tokens, not save them.)
    writeFileSync(
      authFile,
      `// Authentication service for the example app.
// Handles token validation, issuance, session lifecycle, and password hashing.
export class AuthService {
  constructor(readonly secret: string) {}

  validate(token: string): boolean {
    if (!token || typeof token !== "string") return false;
    if (!token.startsWith("tok_")) return false;
    const body = token.slice(4);
    if (body.length < 3) return false;
    return body.split("").every((c) => /[a-zA-Z0-9_]/.test(c));
  }

  issue(userId: string): string {
    const nonce = Math.floor(userId.length * 31 + this.secret.length);
    return "tok_" + userId + "_" + nonce.toString(36);
  }

  rotate(oldToken: string, userId: string): string {
    if (!this.validate(oldToken)) throw new Error("invalid token");
    return this.issue(userId);
  }
}

export class SessionStore {
  private sessions = new Map<string, number>();

  create(userId: string): string {
    const id = "sess_" + userId + "_" + this.sessions.size;
    this.sessions.set(id, Date.now());
    return id;
  }

  destroy(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  isActive(sessionId: string): boolean {
    const ts = this.sessions.get(sessionId);
    if (ts === undefined) return false;
    return Date.now() - ts < 3_600_000;
  }
}

export function createAuthService(secret: string): AuthService {
  if (!secret || secret.length < 8) throw new Error("weak secret");
  return new AuthService(secret);
}

export function verifyToken(token: string): boolean {
  return typeof token === "string" && token.startsWith("tok_");
}

export function hashPassword(pw: string): string {
  let h = 0;
  for (let i = 0; i < pw.length; i++) {
    h = (h * 31 + pw.charCodeAt(i)) | 0;
  }
  return "hash_" + (h >>> 0).toString(16);
}
`
    );

    indexFile = join(projectRoot, "src", "index.ts");
    writeFileSync(
      indexFile,
      `import { createAuthService } from "./auth.js";
const svc = createAuthService({ secret: "x" });
export { svc };
`
    );

    // shallow.ts: single tiny declaration → low confidence.
    shallowFile = join(projectRoot, "src", "shallow.ts");
    writeFileSync(shallowFile, `export const X = 1;\n`);

    await init(projectRoot);
  });

  afterEach(() => {
    _resetCacheForTests();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function buildPayload(
    filePath: string,
    extras: Partial<ReadHookPayload["tool_input"]> = {}
  ): ReadHookPayload {
    return {
      tool_name: "Read",
      cwd: projectRoot,
      tool_input: {
        file_path: filePath,
        ...extras,
      },
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // The money path: high-confidence file → deny + reason with summary
  // ────────────────────────────────────────────────────────────────────
  it("returns deny+reason with engram summary for a high-confidence file", async () => {
    const result = await handleRead(buildPayload(authFile));
    expect(result).not.toBe(PASSTHROUGH);
    if (result === PASSTHROUGH) return; // type narrow

    // Verify the exact empirically-verified shape.
    const wrapped = result as {
      hookSpecificOutput: {
        hookEventName: string;
        permissionDecision: string;
        permissionDecisionReason: string;
      };
    };
    expect(wrapped.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(wrapped.hookSpecificOutput.permissionDecision).toBe("deny");

    // The reason must contain the engram summary header.
    const reason = wrapped.hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain("[engram] Structural summary for src/auth.ts");
    expect(reason).toContain("NODE");
    expect(reason).toContain("offset/limit"); // escape hatch footer
  });

  // ────────────────────────────────────────────────────────────────────
  // Branch 1: wrong tool_name
  // ────────────────────────────────────────────────────────────────────
  it("passes through non-Read tool calls", async () => {
    const result = await handleRead({
      ...buildPayload(authFile),
      tool_name: "Edit" as const, // wrong tool
    });
    expect(result).toBe(PASSTHROUGH);
  });

  // ────────────────────────────────────────────────────────────────────
  // Branch 2: missing file_path
  // ────────────────────────────────────────────────────────────────────
  it("passes through when file_path is missing", async () => {
    const result = await handleRead({
      tool_name: "Read",
      cwd: projectRoot,
      tool_input: {},
    });
    expect(result).toBe(PASSTHROUGH);
  });

  it("passes through when file_path is not a string", async () => {
    const result = await handleRead({
      tool_name: "Read",
      cwd: projectRoot,
      tool_input: { file_path: 42 as unknown as string },
    });
    expect(result).toBe(PASSTHROUGH);
  });

  // ────────────────────────────────────────────────────────────────────
  // Branch 3: partial read bypass
  // ────────────────────────────────────────────────────────────────────
  it("passes through when offset is specified (partial read)", async () => {
    const result = await handleRead(buildPayload(authFile, { offset: 10 }));
    expect(result).toBe(PASSTHROUGH);
  });

  it("passes through when limit is specified (partial read)", async () => {
    const result = await handleRead(buildPayload(authFile, { limit: 50 }));
    expect(result).toBe(PASSTHROUGH);
  });

  it("does NOT pass through when offset=0 (treat as full read)", async () => {
    const result = await handleRead(buildPayload(authFile, { offset: 0 }));
    expect(result).not.toBe(PASSTHROUGH);
  });

  // ────────────────────────────────────────────────────────────────────
  // Branch 4: content safety
  // ────────────────────────────────────────────────────────────────────
  it("passes through for binary file extensions", async () => {
    const binFile = join(projectRoot, "logo.png");
    writeFileSync(binFile, "\x89PNG fake binary");
    const result = await handleRead(buildPayload(binFile));
    expect(result).toBe(PASSTHROUGH);
  });

  it("passes through for .env files", async () => {
    const envFile = join(projectRoot, ".env");
    writeFileSync(envFile, "SECRET=xyz\n");
    const result = await handleRead(buildPayload(envFile));
    expect(result).toBe(PASSTHROUGH);
  });

  it("passes through for .pem private keys", async () => {
    const pemFile = join(projectRoot, "server.pem");
    writeFileSync(pemFile, "-----BEGIN PRIVATE KEY-----\n");
    const result = await handleRead(buildPayload(pemFile));
    expect(result).toBe(PASSTHROUGH);
  });

  // ────────────────────────────────────────────────────────────────────
  // Branch 5: outside project
  // ────────────────────────────────────────────────────────────────────
  it("passes through for files outside any engram project", async () => {
    const strayFile = join(tmpdir(), "engram-stray.ts");
    writeFileSync(strayFile, "export const X = 1;\n");
    try {
      const result = await handleRead({
        ...buildPayload(strayFile),
        cwd: tmpdir(),
      });
      expect(result).toBe(PASSTHROUGH);
    } finally {
      rmSync(strayFile, { force: true });
    }
  });

  it("passes through for files in node_modules", async () => {
    const nmFile = join(projectRoot, "node_modules", "foo", "index.js");
    mkdirSync(join(projectRoot, "node_modules", "foo"), { recursive: true });
    writeFileSync(nmFile, "module.exports = {};");
    const result = await handleRead(buildPayload(nmFile));
    expect(result).toBe(PASSTHROUGH);
  });

  // ────────────────────────────────────────────────────────────────────
  // Branch 6: kill switch
  // ────────────────────────────────────────────────────────────────────
  it("passes through when hook-disabled flag is present", async () => {
    writeFileSync(join(projectRoot, ".engram", "hook-disabled"), "");
    const result = await handleRead(buildPayload(authFile));
    expect(result).toBe(PASSTHROUGH);
  });

  it("intercepts normally after hook-disabled flag is removed", async () => {
    const flag = join(projectRoot, ".engram", "hook-disabled");
    writeFileSync(flag, "");
    const off = await handleRead(buildPayload(authFile));
    expect(off).toBe(PASSTHROUGH);

    rmSync(flag);
    const on = await handleRead(buildPayload(authFile));
    expect(on).not.toBe(PASSTHROUGH);
  });

  // ────────────────────────────────────────────────────────────────────
  // Branch 7: file not in graph
  // ────────────────────────────────────────────────────────────────────
  it("passes through for files with no graph coverage", async () => {
    const ghost = join(projectRoot, "src", "brand-new.ts");
    writeFileSync(ghost, "export const NEW = 1;\n");
    // No re-init — the graph still has the old snapshot without this file.
    const result = await handleRead(buildPayload(ghost));
    expect(result).toBe(PASSTHROUGH);
  });

  // ────────────────────────────────────────────────────────────────────
  // Branch 8: stale graph
  // ────────────────────────────────────────────────────────────────────
  it("passes through when the file is newer than the graph (stale)", async () => {
    // Make auth.ts newer than graph.db.
    const future = new Date(Date.now() + 60_000);
    utimesSync(authFile, future, future);
    const result = await handleRead(buildPayload(authFile));
    expect(result).toBe(PASSTHROUGH);
  });

  // ────────────────────────────────────────────────────────────────────
  // Branch 9: low confidence
  // ────────────────────────────────────────────────────────────────────
  it("passes through for files with low confidence (few nodes)", async () => {
    // shallow.ts has only a single const — should be below the threshold.
    const result = await handleRead(buildPayload(shallowFile));
    expect(result).toBe(PASSTHROUGH);
  });

  it("READ_CONFIDENCE_THRESHOLD is conservative (0.7)", () => {
    expect(READ_CONFIDENCE_THRESHOLD).toBe(0.7);
  });

  // ────────────────────────────────────────────────────────────────────
  // Safety: handler never throws
  // ────────────────────────────────────────────────────────────────────
  it("never throws on malformed payload", async () => {
    await expect(
      handleRead({
        tool_name: "Read",
        cwd: projectRoot,
        tool_input: { file_path: "///\0invalid\0path" },
      })
    ).resolves.toBeDefined();
  });

  it("never throws on empty payload fields", async () => {
    await expect(
      handleRead({
        tool_name: "Read",
        cwd: "",
        tool_input: { file_path: "" },
      })
    ).resolves.toBe(PASSTHROUGH);
  });
});
