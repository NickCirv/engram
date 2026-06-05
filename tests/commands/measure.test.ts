/**
 * `engram measure` pure-helper tests. These two functions are where the honest
 * numbers come from — bareIdentifier feeds handleGrep's SYMBOL_RE gate (a wrong
 * strip → 0 intercepts), and fileLineSet powers recall-coverage (a format
 * mismatch → a false ~0% recall). Both were real bugs caught in the build.
 */
import { describe, it, expect } from "vitest";
import { bareIdentifier, fileLineSet } from "../../src/commands/measure.js";

describe("bareIdentifier", () => {
  it("strips () from a function label", () => {
    expect(bareIdentifier("init()")).toBe("init");
    expect(bareIdentifier("getStore()")).toBe("getStore");
  });

  it("takes the last segment of a qualified method", () => {
    expect(bareIdentifier("Foo.bar()")).toBe("bar");
    expect(bareIdentifier("a.b.c()")).toBe("c");
  });

  it("accepts a plain identifier", () => {
    expect(bareIdentifier("hashTok")).toBe("hashTok");
    expect(bareIdentifier("_private")).toBe("_private");
    expect(bareIdentifier("$ref")).toBe("$ref");
  });

  it("rejects non-identifiers (engram wouldn't intercept them)", () => {
    expect(bareIdentifier("1bad")).toBe(null);
    expect(bareIdentifier("a-b")).toBe(null);
    expect(bareIdentifier("")).toBe(null);
    expect(bareIdentifier("()")).toBe(null);
  });
});

describe("fileLineSet", () => {
  it("parses rg output (with ./ prefix)", () => {
    const s = fileLineSet("./src/a.ts:12: const x = 1;\n./src/b.ts:3: foo();");
    expect(s.has("src/a.ts:12")).toBe(true);
    expect(s.has("src/b.ts:3")).toBe(true);
  });

  it("parses indented call-site packet lines", () => {
    const s = fileLineSet("  src/c.ts:5: hashTok(x);\n  src/d.ts:9: hashTok(y);");
    expect(s.has("src/c.ts:5")).toBe(true);
    expect(s.has("src/d.ts:9")).toBe(true);
  });

  it("ignores headers and non-matching lines", () => {
    const s = fileLineSet('[engram] "x" — 5 call site(s) across 5 file(s):\nrandom prose\n');
    expect(s.size).toBe(0);
  });

  it("keeps Windows drive-letter paths intact (BUG-5)", () => {
    const s = fileLineSet("C:\\src\\a.ts:5: const x = 1;");
    expect(s.has("C:\\src\\a.ts:5")).toBe(true);
    expect(s.size).toBe(1);
  });

  it("normalises rg and packet forms so they're comparable", () => {
    const rg = fileLineSet("./src/a.ts:12: x");
    const pkt = fileLineSet("  src/a.ts:12: x();");
    expect([...rg].filter((k) => pkt.has(k))).toEqual(["src/a.ts:12"]);
  });
});
