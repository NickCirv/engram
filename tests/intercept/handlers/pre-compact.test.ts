/**
 * Tests for the PreCompact hook handler — context survival through compaction.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { init } from "../../../src/core.js";
import { handlePreCompact } from "../../../src/intercept/handlers/pre-compact.js";
import { PASSTHROUGH } from "../../../src/intercept/safety.js";

const rootDir = join(tmpdir(), `engram-precompact-test-${Date.now()}`);
const projectRoot = join(rootDir, "myapp");
const srcDir = join(projectRoot, "src");

const AUTH_CODE = `
export class AuthService {
  constructor(private readonly db: Database) {}
  async validateToken(token: string): Promise<boolean> {
    return this.db.verify(token);
  }
  async refreshToken(old: string): Promise<string> {
    return this.db.refresh(old);
  }
}

export function hashPassword(pw: string): string {
  return "hash_" + pw;
}
`;

beforeAll(async () => {
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(join(srcDir, "auth.ts"), AUTH_CODE);
  writeFileSync(
    join(srcDir, "index.ts"),
    'export { AuthService } from "./auth.js";\n'
  );
  await init(projectRoot);
});

afterAll(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

describe("handlePreCompact", () => {
  it("returns additionalContext with survival brief for initialized project", async () => {
    const result = await handlePreCompact({
      hook_event_name: "PreCompact",
      cwd: projectRoot,
    });
    expect(result).not.toBe(PASSTHROUGH);
    if (result === PASSTHROUGH || result === null || result === undefined) return;

    const output = (result as Record<string, unknown>).hookSpecificOutput as Record<string, unknown>;
    expect(output).toBeDefined();
    const ctx = output.additionalContext as string;
    expect(ctx).toBeDefined();
    expect(ctx).toContain("[engram] Compaction survival");
    expect(ctx).toContain("myapp");
  });

  it("includes key entities in the survival brief", async () => {
    const result = await handlePreCompact({
      hook_event_name: "PreCompact",
      cwd: projectRoot,
    });
    if (result === PASSTHROUGH || result === null || result === undefined) return;

    const ctx = ((result as Record<string, unknown>).hookSpecificOutput as Record<string, unknown>).additionalContext as string;
    expect(ctx).toContain("Key entities:");
    expect(ctx).toContain("interception continues after compaction");
  });

  it("returns PASSTHROUGH for wrong event name", async () => {
    const result = await handlePreCompact({
      hook_event_name: "SessionStart",
      cwd: projectRoot,
    });
    expect(result).toBe(PASSTHROUGH);
  });

  it("appends the 'previously explored' ledger block before wiping it (#84)", async () => {
    const sid = "ledgertest";
    const ledger = join(projectRoot, ".engram", `served-reads-${sid}.json`);
    const now = Date.now();
    writeFileSync(
      ledger,
      JSON.stringify({
        "src/auth.ts": { mtimeMs: 1, size: 9, at: now - 100 },
        "src/index.ts": { mtimeMs: 1, size: 9, at: now },
      })
    );
    const result = await handlePreCompact({
      hook_event_name: "PreCompact",
      cwd: projectRoot,
      session_id: sid,
    });
    expect(result).not.toBe(PASSTHROUGH);
    const ctx = ((result as Record<string, unknown>).hookSpecificOutput as Record<string, unknown>).additionalContext as string;
    expect(ctx).toContain("Previously read this session");
    // Scope to the ledger block — file names also appear in the god-node brief.
    const block = ctx.slice(ctx.indexOf("Previously read"));
    expect(block).toContain("- src/auth.ts");
    expect(block).toContain("- src/index.ts");
    // most-recent-first: index.ts (at=now) ranks before auth.ts (at=now-100)
    expect(block.indexOf("src/index.ts")).toBeLessThan(block.indexOf("src/auth.ts"));
    // ADR-0003 correctness: the ledger is still wiped after PreCompact.
    expect(existsSync(ledger)).toBe(false);
  });

  it("omits the ledger block when ENGRAM_COMPACT_LEDGER=0 (opt-out)", async () => {
    const sid = "ledgeroptout";
    writeFileSync(
      join(projectRoot, ".engram", `served-reads-${sid}.json`),
      JSON.stringify({ "src/auth.ts": { mtimeMs: 1, size: 9, at: Date.now() } })
    );
    const prev = process.env.ENGRAM_COMPACT_LEDGER;
    process.env.ENGRAM_COMPACT_LEDGER = "0";
    try {
      const result = await handlePreCompact({
        hook_event_name: "PreCompact",
        cwd: projectRoot,
        session_id: sid,
      });
      const ctx =
        ((result as Record<string, unknown>)?.hookSpecificOutput as Record<string, unknown> | undefined)?.additionalContext as string | undefined;
      expect(ctx ?? "").not.toContain("Previously read");
    } finally {
      if (prev === undefined) delete process.env.ENGRAM_COMPACT_LEDGER;
      else process.env.ENGRAM_COMPACT_LEDGER = prev;
    }
  });

  it("returns PASSTHROUGH for directory without engram", async () => {
    const emptyDir = join(rootDir, "empty");
    mkdirSync(emptyDir, { recursive: true });
    const result = await handlePreCompact({
      hook_event_name: "PreCompact",
      cwd: emptyDir,
    });
    expect(result).toBe(PASSTHROUGH);
  });

  it("returns PASSTHROUGH for invalid cwd", async () => {
    const result = await handlePreCompact({
      hook_event_name: "PreCompact",
      cwd: "",
    });
    expect(result).toBe(PASSTHROUGH);
  });
});
