/**
 * Tests for the Read never-worse gate (never-worse.ts).
 */
import { describe, it, expect } from "vitest";
import {
  estimatePacketTokens,
  packetBeatsRawFile,
} from "../../src/intercept/never-worse.js";

describe("estimatePacketTokens", () => {
  it("is ceil(chars / 4)", () => {
    expect(estimatePacketTokens("")).toBe(0);
    expect(estimatePacketTokens("abcd")).toBe(1);
    expect(estimatePacketTokens("abcde")).toBe(2); // 5/4 → 2
  });
});

describe("packetBeatsRawFile", () => {
  it("strictly smaller packet → true (intercept is a saving)", () => {
    // 8-char packet → 2 tokens; file = 10 tokens
    expect(packetBeatsRawFile("12345678", 10)).toBe(true);
  });

  it("equal-size packet → false (not strictly smaller → never-worse fails)", () => {
    // 8 chars → 2 tokens; file = 2 tokens
    expect(packetBeatsRawFile("12345678", 2)).toBe(false);
  });

  it("larger packet → false (would ADD tokens — serve fallback instead)", () => {
    expect(packetBeatsRawFile("a".repeat(100), 5)).toBe(false);
  });

  it("non-positive / non-finite fileTokens → false (can't prove a saving)", () => {
    expect(packetBeatsRawFile("x", 0)).toBe(false);
    expect(packetBeatsRawFile("x", -3)).toBe(false);
    expect(packetBeatsRawFile("x", Number.NaN)).toBe(false);
    expect(packetBeatsRawFile("x", Number.POSITIVE_INFINITY)).toBe(false);
  });
});
