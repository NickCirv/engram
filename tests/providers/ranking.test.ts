/**
 * Tests for Phase A blended ranking (ranking.ts).
 * Spec: docs/design/phaseA-displacement-resolver.md §2b, tests #5/#6.
 */
import { describe, it, expect } from "vitest";
import { priorityWeight, blendScore, blendSort } from "../../src/providers/ranking.js";
import type { ProviderResult } from "../../src/providers/types.js";

const PRIORITY = ["engram:ast", "engram:structure", "engram:git"]; // P=3
const W = 0.6;

const R = (provider: string, confidence: number): ProviderResult => ({
  provider,
  content: `content from ${provider}`,
  confidence,
  cached: false,
});

describe("priorityWeight", () => {
  it("top of list → highest, last → lowest, unknown → 0", () => {
    expect(priorityWeight("engram:ast", PRIORITY)).toBeCloseTo(1.0); // (3-0)/3
    expect(priorityWeight("engram:git", PRIORITY)).toBeCloseTo(1 / 3); // (3-2)/3
    expect(priorityWeight("mcp:unknown", PRIORITY)).toBe(0);
  });
});

describe("blendScore", () => {
  it("= W·confidence + (1-W)·priorityWeight", () => {
    // git idx2 conf0.95 → 0.6*0.95 + 0.4*(1/3)
    expect(blendScore(R("engram:git", 0.95), PRIORITY, W)).toBeCloseTo(0.6 * 0.95 + 0.4 * (1 / 3));
  });
});

describe("blendSort — the moat behavior", () => {
  it("a HIGH-confidence LOW-priority result beats a LOW-confidence HIGH-priority one", () => {
    const lowPriHighConf = R("engram:git", 0.95); // score ≈ 0.703
    const highPriLowConf = R("engram:ast", 0.3); // score ≈ 0.580
    const out = blendSort([highPriLowConf, lowPriHighConf], PRIORITY, W);
    expect(out[0]!.provider).toBe("engram:git"); // relevance wins over rank
  });

  it("priority still decides when confidence is equal (the (1-W) term)", () => {
    const out = blendSort([R("engram:git", 0.8), R("engram:ast", 0.8)], PRIORITY, W);
    expect(out[0]!.provider).toBe("engram:ast"); // higher priority breaks the tie
  });

  it("unknown provider (priorityWeight 0) ranks below an equal-confidence known one", () => {
    const out = blendSort([R("mcp:x", 0.8), R("engram:git", 0.8)], PRIORITY, W);
    expect(out[0]!.provider).toBe("engram:git");
  });

  it("is deterministic and does not mutate the input", () => {
    const input = [R("engram:git", 0.5), R("engram:ast", 0.9), R("mcp:x", 0.7)];
    const snapshot = input.map((r) => r.provider);
    const a = blendSort(input, PRIORITY, W).map((r) => r.provider);
    const b = blendSort(input, PRIORITY, W).map((r) => r.provider);
    expect(a).toEqual(b); // deterministic
    expect(input.map((r) => r.provider)).toEqual(snapshot); // no mutation
  });
});
