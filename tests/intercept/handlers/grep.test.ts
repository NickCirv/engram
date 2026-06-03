/**
 * PreToolUse:Grep handler integration tests (ADR-0001).
 *
 * Verifies the recall-safe symbol-search interception:
 *   1. Wrong tool_name           → passthrough
 *   2. Regex / metacharacter      → passthrough (text search, grep out-recalls)
 *   3. Multi-word / spaces        → passthrough
 *   4. Stopword identifier        → passthrough
 *   5. Unknown symbol (no callers)→ passthrough
 *   6. Kill switch enabled        → passthrough
 *   7. Known symbol with callers   → deny + ranked caller list + rg escalation  (money path)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { init } from "../../../src/core.js";
import { handleGrep } from "../../../src/intercept/handlers/grep.js";
import { PASSTHROUGH } from "../../../src/intercept/safety.js";
import { _resetCacheForTests } from "../../../src/intercept/context.js";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("handleGrep — integration tests", () => {
  let projectRoot: string;

  beforeEach(async () => {
    _resetCacheForTests();
    projectRoot = mkdtempSync(join(tmpdir(), "engram-grep-h-test-"));
    mkdirSync(join(projectRoot, "src"), { recursive: true });

    // util.ts DEFINES hashToken; svc.ts CALLS it. The reference miner builds a
    // `calls` edge svc.ts ──▶ hashToken, so callers("hashToken") === ["src/svc.ts"].
    writeFileSync(
      join(projectRoot, "src", "util.ts"),
      `export function hashToken(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h >>> 0;
}
export function normalize(s: string): string {
  return s.trim().toLowerCase();
}
`
    );
    writeFileSync(
      join(projectRoot, "src", "svc.ts"),
      `import { hashToken, normalize } from "./util";
export function keyFor(name: string): number {
  return hashToken(normalize(name));
}
export function lookup(name: string): number {
  return hashToken(name);
}
`
    );
    await init(projectRoot);
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function grepPayload(pattern: string): Record<string, unknown> {
    return {
      tool_name: "Grep",
      cwd: projectRoot,
      tool_input: { pattern },
    };
  }

  it("passes through when tool_name is not Grep", async () => {
    const r = await handleGrep({
      tool_name: "Read",
      cwd: projectRoot,
      tool_input: { pattern: "hashToken" },
    });
    expect(r).toBe(PASSTHROUGH);
  });

  it("passes through a regex / metacharacter pattern (text search)", async () => {
    expect(await handleGrep(grepPayload("hash.*Token"))).toBe(PASSTHROUGH);
    expect(await handleGrep(grepPayload("hashToken|normalize"))).toBe(
      PASSTHROUGH
    );
  });

  it("passes through a multi-word / spaced pattern", async () => {
    expect(await handleGrep(grepPayload("hash token"))).toBe(PASSTHROUGH);
  });

  it("passes through a stopword identifier", async () => {
    expect(await handleGrep(grepPayload("error"))).toBe(PASSTHROUGH);
    expect(await handleGrep(grepPayload("data"))).toBe(PASSTHROUGH);
  });

  it("passes through a bare identifier the graph doesn't know", async () => {
    expect(await handleGrep(grepPayload("nonexistentSymbolXyz"))).toBe(
      PASSTHROUGH
    );
  });

  it("passes through when the kill switch is enabled", async () => {
    mkdirSync(join(projectRoot, ".engram"), { recursive: true });
    writeFileSync(join(projectRoot, ".engram", "hook-disabled"), "");
    expect(await handleGrep(grepPayload("hashToken"))).toBe(PASSTHROUGH);
  });

  it("passes through when ENGRAM_GREP_INTERCEPT=0 (opt-out)", async () => {
    const prev = process.env.ENGRAM_GREP_INTERCEPT;
    process.env.ENGRAM_GREP_INTERCEPT = "0";
    try {
      expect(await handleGrep(grepPayload("hashToken"))).toBe(PASSTHROUGH);
    } finally {
      if (prev === undefined) delete process.env.ENGRAM_GREP_INTERCEPT;
      else process.env.ENGRAM_GREP_INTERCEPT = prev;
    }
  });

  it("denies + answers from the reference graph for a known symbol (money path)", async () => {
    const r = (await handleGrep(grepPayload("hashToken"))) as Record<
      string,
      unknown
    >;
    expect(r).not.toBe(PASSTHROUGH);
    const out = r.hookSpecificOutput as Record<string, unknown>;
    expect(out.permissionDecision).toBe("deny");
    const reason = out.permissionDecisionReason as string;
    // engram's structural answer names the calling file...
    expect(reason).toContain("svc.ts");
    expect(reason).toContain("hashToken");
    // ...and ALWAYS includes the recall-safety escalation command.
    expect(reason).toContain('rg -n "hashToken"');
  });
});
