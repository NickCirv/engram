/**
 * Tests for Phase A cross-provider displacement (dedup.ts).
 * Spec: docs/design/phaseA-displacement-resolver.md §6.
 */
import { describe, it, expect } from "vitest";
import {
  fnv1a,
  normalize,
  shingles,
  jaccard,
  dedupResults,
  applyDisplacement,
} from "../../src/providers/dedup.js";
import type { ProviderResult } from "../../src/providers/types.js";

/** Deterministic token estimator for tests: word count. */
const est = (s: string): number => s.split(/\s+/).filter(Boolean).length;

const R = (provider: string, content: string, confidence = 0.8): ProviderResult => ({
  provider,
  content,
  confidence,
  cached: false,
});

describe("dedup primitives", () => {
  it("fnv1a is deterministic + 32-bit unsigned", () => {
    expect(fnv1a("hello")).toBe(fnv1a("hello"));
    expect(fnv1a("hello")).not.toBe(fnv1a("world"));
    expect(fnv1a("x")).toBeGreaterThanOrEqual(0);
    expect(fnv1a("x")).toBeLessThanOrEqual(0xffffffff);
  });

  it("normalize folds whitespace, case, unicode, headers, labels", () => {
    // strips the markdown marker (##) but keeps header WORDS as real content
    expect(normalize("## Header\n  Foo   BAR \n")).toBe("header foo bar");
    expect(normalize("[engram:git] foo bar")).toBe("foo bar");
    // NFKC: fullwidth → ascii
    expect(normalize("ｆｏｏ")).toBe("foo");
  });

  it("jaccard: identical=1, disjoint=0, both-empty=1, one-empty=0", () => {
    expect(jaccard(new Set([1, 2]), new Set([1, 2]))).toBe(1);
    expect(jaccard(new Set([1]), new Set([2]))).toBe(0);
    expect(jaccard(new Set(), new Set())).toBe(1);
    expect(jaccard(new Set([1]), new Set())).toBe(0);
  });

  it("shingles: short text → single whole-text shingle", () => {
    expect(shingles("one two").size).toBe(1);
    // 6 words, w=5 → 2 windows
    expect(shingles("a b c d e f").size).toBe(2);
  });
});

describe("dedupResults — section level", () => {
  it("collapses identical sections, accounts redundant tokens, keeps one", () => {
    const c = "the function foo calls bar and returns the baz value";
    const out = dedupResults([R("engram:structure", c), R("mcp:graph", c)], est);
    expect(out.kept).toHaveLength(1);
    expect(out.kept[0]!.provider).toBe("engram:structure"); // first = highest-ranked
    expect(out.redundantTokens).toBe(est(c));
  });

  it("collapses whitespace/unicode/header variants of the same section", () => {
    const a = "the function foo calls bar and returns the baz value";
    const b = "## THE   function  FOO calls BAR and returns the baz   value"; // same words, noisy
    const out = dedupResults([R("engram:structure", a), R("mcp:graph", b)], est);
    expect(out.kept).toHaveLength(1);
  });

  it("keeps the FIRST (highest-ranked) member of a duplicate cluster", () => {
    const c = "alpha beta gamma delta epsilon zeta eta theta iota";
    const out = dedupResults([R("mcp:graph", c, 0.95), R("engram:git", c, 0.3)], est);
    expect(out.kept).toHaveLength(1);
    expect(out.kept[0]!.provider).toBe("mcp:graph");
  });

  it("does NOT dedup genuinely distinct sections (no false positive)", () => {
    const a = "the function foo calls bar and returns the baz value";
    const b = "database migration adds a flat fee column to the org table";
    const out = dedupResults([R("a", a), R("b", b)], est);
    expect(out.kept).toHaveLength(2);
    expect(out.redundantTokens).toBe(0);
  });
});

describe("dedupResults — line level", () => {
  it("strips lines already emitted by a higher-ranked result", () => {
    const a =
      "line one alpha beta gamma delta echo\nshared sentence here is exactly the same text now\nline three unique foxtrot golf hotel india";
    const b =
      "shared sentence here is exactly the same text now\ndistinct line for b juliet kilo lima mike november";
    const out = dedupResults([R("a", a), R("b", b)], est);
    expect(out.kept).toHaveLength(2); // both sections survive
    expect(out.kept[1]!.content).not.toContain("shared sentence here is exactly the same text now");
    expect(out.kept[1]!.content).toContain("distinct line for b");
    expect(out.redundantTokens).toBeGreaterThan(0);
  });
});

describe("dedupResults — safety + invariants", () => {
  it("survives malformed/empty results without throwing", () => {
    const bad = { provider: "x", confidence: 0.5, cached: false } as unknown as ProviderResult;
    const out = dedupResults([bad, R("ok", "real content words here for sure"), R("empty", "   ")], est);
    expect(out.kept.some((r) => r.provider === "ok")).toBe(true);
  });

  it("MONOTONIC: kept content never exceeds input content (never grows the packet)", () => {
    const results = [
      R("a", "function foo calls bar baz qux quux corge grault"),
      R("b", "function foo calls bar baz qux quux corge grault"), // dup of a
      R("c", "wholly different garply waldo fred plugh xyzzy thud"),
      R("d", "wholly different garply waldo fred plugh xyzzy thud"), // dup of c
    ];
    const out = dedupResults(results, est);
    const inTok = results.reduce((s, r) => s + est(r.content), 0);
    const outTok = out.kept.reduce((s, r) => s + est(r.content), 0);
    expect(outTok).toBeLessThanOrEqual(inTok);
    expect(out.kept).toHaveLength(2);
    expect(out.redundantTokens).toBe(inTok - outTok);
  });

  it("empty input → empty output, zero redundancy", () => {
    const out = dedupResults([], est);
    expect(out.kept).toHaveLength(0);
    expect(out.redundantTokens).toBe(0);
  });
});

describe("applyDisplacement — the resolver wiring (pure)", () => {
  it("#9 — a clear duplicate yields tokensDisplaced > 0 and one survivor", () => {
    const c = "function foo calls bar baz qux quux corge grault garply";
    const d = applyDisplacement([R("engram:structure", c), R("mcp:graph", c)], est);
    expect(d.kept).toHaveLength(1);
    expect(d.tokensDisplaced).toBeGreaterThan(0);
    expect(d.redundantTokens).toBeGreaterThan(0);
    expect(d.baselineTokens).toBe(est(c) * 2);
  });

  it("#14 — counter consistency: tokensDisplaced === baseline − sum(kept)", () => {
    const c = "alpha bravo charlie delta echo foxtrot golf hotel india";
    const d = applyDisplacement([R("a", c), R("b", c), R("c", "wholly distinct juliet kilo lima mike")], est);
    const keptTokens = d.kept.reduce((s, r) => s + est(r.content), 0);
    expect(d.tokensDisplaced).toBe(d.baselineTokens - keptTokens);
  });

  it("distinct results → nothing displaced", () => {
    const d = applyDisplacement(
      [R("a", "function foo calls bar baz qux quux"), R("b", "database migration adds a flat fee column")],
      est
    );
    expect(d.kept).toHaveLength(2);
    expect(d.tokensDisplaced).toBe(0);
    expect(d.redundantTokens).toBe(0);
  });

  it("NEVER-WORSE: displaced ≥ 0 and kept-content ≤ baseline for arbitrary inputs", () => {
    const inputs = [
      R("a", "function foo calls bar baz qux quux corge"),
      R("b", "function foo calls bar baz qux quux corge"),
      R("c", "unrelated waldo fred plugh xyzzy thud spam"),
      R("d", "another distinct ham eggs bacon sausage beans toast"),
    ];
    const d = applyDisplacement(inputs, est);
    const keptTokens = d.kept.reduce((s, r) => s + est(r.content), 0);
    expect(d.tokensDisplaced).toBeGreaterThanOrEqual(0);
    expect(keptTokens).toBeLessThanOrEqual(d.baselineTokens);
  });

  it("empty input → zeros, no throw", () => {
    const d = applyDisplacement([], est);
    expect(d.kept).toHaveLength(0);
    expect(d.tokensDisplaced).toBe(0);
    expect(d.baselineTokens).toBe(0);
  });
});
