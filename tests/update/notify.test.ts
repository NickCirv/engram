import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { cachePath } from "../../src/update/check.js";
import {
  maybePrintUpdateHint,
  _resetPrintedFlag,
} from "../../src/update/notify.js";

describe("update/notify.ts — maybePrintUpdateHint", () => {
  const origEnv = { ...process.env };
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  let captured = "";

  beforeEach(() => {
    _resetPrintedFlag();
    captured = "";
    // @ts-expect-error — stubbing stderr.write for test capture
    process.stderr.write = (chunk: string) => {
      captured += typeof chunk === "string" ? chunk : String(chunk);
      return true;
    };
    const p = cachePath();
    if (existsSync(p)) rmSync(p);
  });

  afterEach(() => {
    process.stderr.write = origStderrWrite;
    process.env = { ...origEnv };
    const p = cachePath();
    if (existsSync(p)) rmSync(p);
  });

  it("prints when newer version cached and not opted out", () => {
    delete process.env.ENGRAM_NO_UPDATE_CHECK;
    delete process.env.CI;
    const p = cachePath();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(
      p,
      JSON.stringify({ latest: "9.9.9", checkedAt: Date.now() }),
      "utf-8"
    );

    const hint = maybePrintUpdateHint("2.0.2");
    expect(hint).not.toBeNull();
    expect(captured).toMatch(/9\.9\.9/);
    expect(captured).toMatch(/engram update/);
  });

  it("silent when no cache exists", () => {
    delete process.env.ENGRAM_NO_UPDATE_CHECK;
    delete process.env.CI;
    const hint = maybePrintUpdateHint("2.0.2");
    expect(hint).toBeNull();
    expect(captured).toBe("");
  });

  it("silent when cached version not newer", () => {
    delete process.env.ENGRAM_NO_UPDATE_CHECK;
    delete process.env.CI;
    const p = cachePath();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(
      p,
      JSON.stringify({ latest: "2.0.2", checkedAt: Date.now() }),
      "utf-8"
    );
    const hint = maybePrintUpdateHint("2.0.2");
    expect(hint).toBeNull();
    expect(captured).toBe("");
  });

  it("silent when opted out via env", () => {
    process.env.ENGRAM_NO_UPDATE_CHECK = "1";
    const p = cachePath();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(
      p,
      JSON.stringify({ latest: "9.9.9", checkedAt: Date.now() }),
      "utf-8"
    );
    const hint = maybePrintUpdateHint("2.0.2");
    expect(hint).toBeNull();
    expect(captured).toBe("");
  });

  it("silent when $CI is set", () => {
    delete process.env.ENGRAM_NO_UPDATE_CHECK;
    process.env.CI = "true";
    const p = cachePath();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(
      p,
      JSON.stringify({ latest: "9.9.9", checkedAt: Date.now() }),
      "utf-8"
    );
    const hint = maybePrintUpdateHint("2.0.2");
    expect(hint).toBeNull();
    expect(captured).toBe("");
  });

  it("prints at most once per process", () => {
    delete process.env.ENGRAM_NO_UPDATE_CHECK;
    delete process.env.CI;
    const p = cachePath();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(
      p,
      JSON.stringify({ latest: "9.9.9", checkedAt: Date.now() }),
      "utf-8"
    );

    const first = maybePrintUpdateHint("2.0.2");
    const second = maybePrintUpdateHint("2.0.2");
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    // captured string contains exactly one hint line
    const matches = captured.match(/engram update/g);
    expect(matches).toHaveLength(1);
  });
});
