import { describe, it, expect } from "vitest";
import { sliceGraphemeSafe, truncateGraphemeSafe, formatThousands } from "../src/graph/render-utils.js";

describe("sliceGraphemeSafe", () => {
  it("returns the string unchanged when it fits", () => {
    expect(sliceGraphemeSafe("hello", 10)).toBe("hello");
    expect(sliceGraphemeSafe("hello", 5)).toBe("hello");
  });

  it("returns empty string for non-positive max", () => {
    expect(sliceGraphemeSafe("hello", 0)).toBe("");
    expect(sliceGraphemeSafe("hello", -1)).toBe("");
  });

  it("slices at max for pure ASCII", () => {
    expect(sliceGraphemeSafe("hello world", 5)).toBe("hello");
  });

  it("does not split a surrogate pair at the boundary", () => {
    // "a🎉" is 3 UTF-16 code units: 'a' + high surrogate + low surrogate.
    // Slicing at length 2 would cut between the high and low surrogate
    // halves of the emoji, leaving a lone high surrogate (invalid UTF-16).
    // sliceGraphemeSafe should back off to length 1 ("a").
    const s = "a\uD83C\uDF89"; // "a🎉"
    expect(s.length).toBe(3);
    const cut = sliceGraphemeSafe(s, 2);
    expect(cut).toBe("a");
    // The result must be valid UTF-16 (no lone surrogates)
    for (let i = 0; i < cut.length; i++) {
      const code = cut.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF) {
        const next = cut.charCodeAt(i + 1);
        expect(next >= 0xDC00 && next <= 0xDFFF).toBe(true);
      }
    }
  });

  it("keeps full surrogate pairs when they fit within max", () => {
    const s = "a\uD83C\uDF89b"; // "a🎉b"
    expect(s.length).toBe(4);
    expect(sliceGraphemeSafe(s, 4)).toBe("a\uD83C\uDF89b");
    expect(sliceGraphemeSafe(s, 3)).toBe("a\uD83C\uDF89");
  });

  it("handles empty input", () => {
    expect(sliceGraphemeSafe("", 10)).toBe("");
  });
});

describe("truncateGraphemeSafe", () => {
  it("returns the string unchanged when it fits", () => {
    expect(truncateGraphemeSafe("hello", 10)).toBe("hello");
    expect(truncateGraphemeSafe("hello", 5)).toBe("hello");
  });

  it("returns empty for max ≤ 0", () => {
    expect(truncateGraphemeSafe("hello", 0)).toBe("");
    expect(truncateGraphemeSafe("hello", -5)).toBe("");
  });

  it("returns empty when max leaves no room for content plus ellipsis", () => {
    expect(truncateGraphemeSafe("hello", 1)).toBe("");
  });

  it("truncates pure ASCII with ellipsis inside the budget", () => {
    const result = truncateGraphemeSafe("hello world", 6);
    expect(result).toBe("hello…");
    expect(result.length).toBeLessThanOrEqual(6);
  });

  it("does not split a surrogate pair and appends ellipsis", () => {
    const s = "a\uD83C\uDF89b"; // "a🎉b"
    // Budget 3 means cut at index 2 minus ellipsis = index 1, then check surrogate
    // index 1 is high surrogate of 🎉, so step back to index 1 - 1 = 0... wait let me think
    // cut = max - 1 = 2; charCodeAt(1) = 0xD83C (high surrogate) → cut-- → cut = 1
    // result = s.slice(0, 1) + "…" = "a…"
    expect(truncateGraphemeSafe(s, 3)).toBe("a…");
  });

  it("result never contains a lone surrogate", () => {
    const s = "\uD83C\uDF89\uD83C\uDF89\uD83C\uDF89"; // three emojis
    for (let max = 1; max <= s.length + 2; max++) {
      const result = truncateGraphemeSafe(s, max);
      for (let i = 0; i < result.length; i++) {
        const code = result.charCodeAt(i);
        if (code >= 0xD800 && code <= 0xDBFF) {
          const next = result.charCodeAt(i + 1);
          expect(next >= 0xDC00 && next <= 0xDFFF).toBe(true);
        }
      }
      // Also must round-trip through JSON without errors
      expect(() => JSON.stringify({ label: result })).not.toThrow();
      expect(JSON.parse(JSON.stringify({ label: result })).label).toBe(result);
    }
  });

  it("handles empty input", () => {
    expect(truncateGraphemeSafe("", 10)).toBe("");
    expect(truncateGraphemeSafe("", 0)).toBe("");
  });
});

describe("formatThousands", () => {
  it("returns single-digit numbers unchanged", () => {
    expect(formatThousands(0)).toBe("0");
    expect(formatThousands(7)).toBe("7");
  });

  it("returns 2- and 3-digit numbers unchanged", () => {
    expect(formatThousands(42)).toBe("42");
    expect(formatThousands(999)).toBe("999");
  });

  it("inserts a comma at the thousands boundary", () => {
    expect(formatThousands(1000)).toBe("1,000");
    expect(formatThousands(1234)).toBe("1,234");
    expect(formatThousands(9999)).toBe("9,999");
  });

  it("inserts commas in multi-group numbers", () => {
    expect(formatThousands(10_000)).toBe("10,000");
    expect(formatThousands(123_456)).toBe("123,456");
    expect(formatThousands(1_234_567)).toBe("1,234,567");
    expect(formatThousands(999_999_999)).toBe("999,999,999");
  });

  it("handles negative numbers", () => {
    expect(formatThousands(-1234)).toBe("-1,234");
    expect(formatThousands(-1_000_000)).toBe("-1,000,000");
  });

  it("is locale-independent (no difference under a foreign LANG)", () => {
    // The regex-based formatter uses only `\d` and `\B` with no locale
    // sensitivity, so output must match on any system locale. This test
    // doesn't actually change the locale (platform-dependent), but locks
    // in the expected output so any future migration back to
    // `toLocaleString` would fail here.
    expect(formatThousands(1234)).toBe("1,234");
    expect(formatThousands(1234)).not.toBe("1.234");
    expect(formatThousands(1234)).not.toBe("1 234");
  });
});
