/**
 * packetRatioPhrase (C1) — honest phrasing for a packet/baseline ratio.
 * A ratio < 1 means the packet is LARGER than the baseline; the old code
 * printed "0.2x smaller packet" (backwards over-claim). The helper now states
 * it honestly and centralises the wording for cli + bench + the HTTP server.
 */
import { describe, it, expect } from "vitest";
import { packetRatioPhrase } from "../src/core.js";

describe("packetRatioPhrase", () => {
  it("phrases a genuine reduction (ratio > 1) as smaller", () => {
    expect(packetRatioPhrase(7.8)).toBe("7.8x smaller packet");
    expect(packetRatioPhrase(1)).toBe("1x smaller packet");
  });

  it("phrases a sub-1 ratio as LARGER, never as a fake reduction (the bug)", () => {
    const p = packetRatioPhrase(0.2);
    expect(p).toContain("LARGER");
    expect(p).toContain("passes through");
    expect(p).not.toContain("smaller");
    expect(p).toBe("5x LARGER — engram passes through");
  });

  it("never claims '0.Nx smaller'", () => {
    for (const r of [0.1, 0.25, 0.5, 0.9]) {
      expect(packetRatioPhrase(r)).not.toMatch(/0\.\d+x smaller/);
      expect(packetRatioPhrase(r)).toContain("LARGER");
    }
  });

  it("returns n/a for non-finite or non-positive ratios", () => {
    expect(packetRatioPhrase(0)).toBe("n/a");
    expect(packetRatioPhrase(-3)).toBe("n/a");
    expect(packetRatioPhrase(NaN)).toBe("n/a");
    expect(packetRatioPhrase(Infinity)).toBe("n/a");
  });
});
