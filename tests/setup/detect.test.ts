import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  detectCursor,
  detectWindsurf,
  detectAider,
  detectAllIdes,
} from "../../src/setup/detect.js";

describe("setup/detect.ts", () => {
  const fx = join(tmpdir(), "engram-detect-test-" + Date.now());

  beforeAll(() => {
    mkdirSync(fx, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(fx)) rmSync(fx, { recursive: true, force: true });
  });

  it("detectWindsurf: absent by default", () => {
    const r = detectWindsurf(fx);
    expect(r.installed).toBe(false);
    expect(r.configured).toBe(false);
  });

  it("detectWindsurf: present when .windsurfrules exists", () => {
    writeFileSync(join(fx, ".windsurfrules"), "# engram rules", "utf-8");
    const r = detectWindsurf(fx);
    expect(r.installed).toBe(true);
    expect(r.configured).toBe(true);
    expect(r.status).toContain(".windsurfrules");
    rmSync(join(fx, ".windsurfrules"));
  });

  it("detectAider: marks configured when .aider-context.md exists", () => {
    writeFileSync(join(fx, ".aider-context.md"), "# context", "utf-8");
    const r = detectAider(fx);
    expect(r.configured).toBe(true);
    rmSync(join(fx, ".aider-context.md"));
  });

  it("detectCursor: reports adapter as absent in a fresh tmp dir", () => {
    const r = detectCursor(fx);
    expect(r.configured).toBe(false);
  });

  it("detectAllIdes: returns one entry per known IDE", () => {
    const all = detectAllIdes(fx);
    const names = all.map((d) => d.name);
    expect(names).toContain("Claude Code");
    expect(names).toContain("Cursor");
    expect(names).toContain("Windsurf");
    expect(names).toContain("Continue.dev");
    expect(names).toContain("Aider");
    expect(all.length).toBeGreaterThanOrEqual(5);
  });
});
