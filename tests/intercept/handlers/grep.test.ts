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
    // Many caller files, each calling hashToken twice, so the raw `rg` is
    // genuinely LARGER than engram's (capped) call-site packet — a real win that
    // clears the ADR-0007 never-worse size gate, not just MIN_CALLER_FILES.
    // (svc.ts sorts first, so its `return hashToken(name)` stays in the packet.)
    for (let n = 2; n <= 20; n++) {
      writeFileSync(
        join(projectRoot, "src", `svc${n}.ts`),
        `import { hashToken } from "./util";\n` +
          `export function use${n}a(x: string): number { return hashToken(x); }\n` +
          `export function use${n}b(x: string): number { return hashToken(hashToken(x)); }\n`
      );
    }
    await init(projectRoot);
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function grepPayload(
    pattern: string,
    outputMode: string | undefined = "content"
  ): Record<string, unknown> {
    return {
      tool_name: "Grep",
      cwd: projectRoot,
      tool_input:
        outputMode === undefined
          ? { pattern }
          : { pattern, output_mode: outputMode },
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
    // ...with the ACTUAL call-site lines (file:line: code) — the recall
    // sufficiency a bare file list lacked (ADR-0004)...
    expect(reason).toContain("call site");
    expect(reason).toMatch(/src\/svc\.ts:\d+:/); // file:line prefix
    expect(reason).toContain("return hashToken(name)"); // a real usage line
    // ...and ALWAYS includes the recall-safety escalation command.
    expect(reason).toContain('rg -n "hashToken"');
  });

  it("passes through when the packet would be larger than the raw grep (ADR-0007 never-worse)", async () => {
    // A fresh tiny project: a symbol with ≥4 caller files but one short call
    // each, so the raw grep is small and engram's packet (header + sites +
    // escalation footer) would exceed it. The size gate must pass through.
    const tiny = mkdtempSync(join(tmpdir(), "engram-grep-nw-"));
    try {
      mkdirSync(join(tiny, "src"), { recursive: true });
      writeFileSync(join(tiny, "src", "u.ts"), "export function tok(s: string): number { return s.length; }\n");
      for (let i = 0; i < 5; i++) {
        writeFileSync(join(tiny, "src", `c${i}.ts`), `import {tok} from "./u";\nexport const x${i}=tok("${i}");\n`);
      }
      await init(tiny);
      const r = await handleGrep({
        tool_name: "Grep",
        cwd: tiny,
        tool_input: { pattern: "tok", output_mode: "content" },
      });
      expect(r).toBe(PASSTHROUGH);
    } finally {
      rmSync(tiny, { recursive: true, force: true });
    }
  });

  it("passes through when the agent scopes its grep narrower than the repo-wide packet (ADR-0007)", async () => {
    // hashToken is a big win repo-wide, but scoped to one small file the agent's
    // actual grep returns little — the repo-wide packet would be LARGER, so the
    // gate must size against the AGENT'S scope (path) and pass through.
    const r = await handleGrep({
      tool_name: "Grep",
      cwd: projectRoot,
      tool_input: { pattern: "hashToken", output_mode: "content", path: "src/svc4.ts" },
    });
    expect(r).toBe(PASSTHROUGH);
  });

  it("passes through when path/glob is a non-string scope it can't reproduce (ADR-0007)", async () => {
    const r = await handleGrep({
      tool_name: "Grep",
      cwd: projectRoot,
      tool_input: { pattern: "hashToken", output_mode: "content", glob: ["*.ts"] },
    });
    expect(r).toBe(PASSTHROUGH);
  });

  it("caps the call-site list for a heavily-used symbol", async () => {
    // a caller file with far more than MAX_SITES (25) references to hashToken
    const many = Array.from(
      { length: 60 },
      (_, i) => `export function use${i}(n: string): number { return hashToken(n) + ${i}; }`
    ).join("\n");
    writeFileSync(join(projectRoot, "src", "heavy.ts"), `import { hashToken } from "./util";\n${many}\n`);
    await init(projectRoot);

    const r = (await handleGrep(grepPayload("hashToken"))) as Record<
      string,
      unknown
    >;
    const reason = (r.hookSpecificOutput as Record<string, unknown>)
      .permissionDecisionReason as string;
    // cap marker present, and the rendered line count never exceeds the cap
    expect(reason).toContain("more call sites exist");
    expect(reason).toMatch(/\d+\+ call site/); // "25+ call site(s)"
    const siteLines = reason.split("\n").filter((l) => /:\d+:/.test(l));
    expect(siteLines.length).toBeLessThanOrEqual(25);
  });

  it("passes through a non-content grep (files_with_matches / default / count)", async () => {
    // engram's call-site packet can't beat a filenames-only or count grep
    expect(await handleGrep(grepPayload("hashToken", "files_with_matches"))).toBe(
      PASSTHROUGH
    );
    expect(await handleGrep(grepPayload("hashToken", "count"))).toBe(PASSTHROUGH);
    // output_mode omitted entirely = default files mode → passthrough.
    // (Built as a raw payload; passing `undefined` to grepPayload would trigger
    // its `= "content"` default — the classic JS default-param gotcha.)
    expect(
      await handleGrep({
        tool_name: "Grep",
        cwd: projectRoot,
        tool_input: { pattern: "hashToken" },
      } as never)
    ).toBe(PASSTHROUGH);
  });

  it("passes through a symbol with too few caller files (content grep is small)", async () => {
    // `normalize` is called only by svc.ts (1 caller) < MIN_CALLER_FILES → a
    // content grep would be tiny, so engram's packet would cost more → passthrough
    expect(await handleGrep(grepPayload("normalize"))).toBe(PASSTHROUGH);
  });
});
