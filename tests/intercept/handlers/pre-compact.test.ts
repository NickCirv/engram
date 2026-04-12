/**
 * Tests for the PreCompact hook handler — context survival through compaction.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
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
