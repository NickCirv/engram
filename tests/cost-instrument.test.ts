/**
 * v3.3 Cost Lens — instrumentation unit tests.
 *
 * Tests cover the pure helpers in src/cost/instrument.ts:
 *   - tokensFromChars — bounds, NaN safety
 *   - extractInjectedTokens — both injection seams + safety
 *   - estimateWouldHaveReadTokens — tool gating + stat failure
 *   - composeCostFields — clamp + key omission
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  tokensFromChars,
  extractInjectedTokens,
  estimateWouldHaveReadTokens,
  composeCostFields,
} from "../src/cost/instrument.js";

describe("cost.instrument.tokensFromChars", () => {
  it("rounds up", () => {
    expect(tokensFromChars(1)).toBe(1);
    expect(tokensFromChars(4)).toBe(1);
    expect(tokensFromChars(5)).toBe(2);
    expect(tokensFromChars(400)).toBe(100);
  });

  it("returns 0 for non-positive or non-finite", () => {
    expect(tokensFromChars(0)).toBe(0);
    expect(tokensFromChars(-10)).toBe(0);
    expect(tokensFromChars(NaN)).toBe(0);
    expect(tokensFromChars(Infinity)).toBe(0);
  });
});

describe("cost.instrument.extractInjectedTokens", () => {
  it("extracts tokens from deny path (permissionDecisionReason)", () => {
    const result = {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "x".repeat(400),
      },
    };
    expect(extractInjectedTokens(result)).toBe(100);
  });

  it("extracts tokens from allow path (additionalContext)", () => {
    const result = {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        additionalContext: "y".repeat(800),
      },
    };
    expect(extractInjectedTokens(result)).toBe(200);
  });

  it("prefers reason over additionalContext when both present", () => {
    const result = {
      hookSpecificOutput: {
        permissionDecisionReason: "x".repeat(400), // 100 tokens
        additionalContext: "y".repeat(8000),       // 2000 tokens
      },
    };
    expect(extractInjectedTokens(result)).toBe(100);
  });

  it("returns 0 for null / undefined / passthrough", () => {
    expect(extractInjectedTokens(null)).toBe(0);
    expect(extractInjectedTokens(undefined)).toBe(0);
    expect(extractInjectedTokens({})).toBe(0);
    expect(extractInjectedTokens({ hookSpecificOutput: {} })).toBe(0);
  });

  it("never throws on hostile input", () => {
    expect(() => extractInjectedTokens("not-an-object")).not.toThrow();
    expect(() => extractInjectedTokens(42)).not.toThrow();
    expect(() =>
      extractInjectedTokens({
        get hookSpecificOutput() {
          throw new Error("boom");
        },
      }),
    ).not.toThrow();
  });
});

describe("cost.instrument.estimateWouldHaveReadTokens", () => {
  it("returns 0 for non-Read tools", () => {
    expect(estimateWouldHaveReadTokens("Edit", "/tmp/a.txt")).toBe(0);
    expect(estimateWouldHaveReadTokens("Write", "/tmp/a.txt")).toBe(0);
    expect(estimateWouldHaveReadTokens("Bash", "/tmp/a.txt")).toBe(0);
  });

  it("returns 0 for missing path", () => {
    expect(estimateWouldHaveReadTokens("Read", undefined)).toBe(0);
    expect(estimateWouldHaveReadTokens("Read", "")).toBe(0);
  });

  it("returns 0 for non-existent file (stat failure swallowed)", () => {
    expect(
      estimateWouldHaveReadTokens(
        "Read",
        "/definitely/does/not/exist/zzz.txt",
      ),
    ).toBe(0);
  });

  it("returns ceil(size/4) for an existing file", () => {
    const dir = mkdtempSync(join(tmpdir(), "engram-cost-stat-"));
    const file = join(dir, "fixture.txt");
    writeFileSync(file, "a".repeat(4000));
    expect(estimateWouldHaveReadTokens("Read", file)).toBe(1000);
  });
});

describe("cost.instrument.composeCostFields", () => {
  it("omits keys with zero values", () => {
    expect(composeCostFields("Bash", undefined, null)).toEqual({});
  });

  it("clamps tokensSaved to >=0 (engram packet larger than file)", () => {
    const dir = mkdtempSync(join(tmpdir(), "engram-cost-clamp-"));
    const file = join(dir, "tiny.txt");
    writeFileSync(file, "short");
    const fakeResult = {
      hookSpecificOutput: {
        permissionDecisionReason: "y".repeat(4000), // 1000 tokens injected
      },
    };
    const fields = composeCostFields("Read", file, fakeResult);
    expect(fields.tokensSaved).toBeUndefined(); // omitted because saved is 0 (clamped)
    expect(fields.injected).toBe(1000);
    // wouldHaveRead is small but present
    expect(fields.wouldHaveRead).toBeGreaterThan(0);
  });

  it("computes correct savings on a realistic Read intercept", () => {
    const dir = mkdtempSync(join(tmpdir(), "engram-cost-real-"));
    const file = join(dir, "big.txt");
    writeFileSync(file, "x".repeat(40_000)); // 10K tokens
    const fakeResult = {
      hookSpecificOutput: {
        permissionDecisionReason: "x".repeat(1200), // 1200 chars = 300 tokens
      },
    };
    const fields = composeCostFields("Read", file, fakeResult);
    expect(fields.wouldHaveRead).toBe(10_000);
    expect(fields.injected).toBe(300);
    expect(fields.tokensSaved).toBe(9_700);
  });

  it("Edit/Write augmentation logs injected only (no wouldHaveRead)", () => {
    const fakeResult = {
      hookSpecificOutput: {
        permissionDecision: "allow",
        additionalContext: "z".repeat(800), // 200 tokens
      },
    };
    const fields = composeCostFields("Edit", "/tmp/foo.ts", fakeResult);
    expect(fields.injected).toBe(200);
    expect(fields.wouldHaveRead).toBeUndefined();
    expect(fields.tokensSaved).toBeUndefined();
  });
});
