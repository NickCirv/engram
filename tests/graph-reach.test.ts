/**
 * Tests for path-based candidate reach (src/graph/reach.ts).
 */
import { describe, it, expect } from "vitest";
import {
  dirOf,
  sameDirSiblings,
  testImplCounterparts,
  pathReach,
} from "../src/graph/reach.js";

const ALL = [
  "src/a/foo.ts",
  "src/a/bar.ts",
  "src/a/foo.test.ts",
  "src/b/baz.ts",
  "tests/foo.spec.ts",
  "index.ts",
];

describe("dirOf", () => {
  it("returns the directory, or '' for a top-level file", () => {
    expect(dirOf("src/a/foo.ts")).toBe("src/a");
    expect(dirOf("index.ts")).toBe("");
  });
});

describe("sameDirSiblings", () => {
  it("returns same-directory files, excluding the file itself and other dirs", () => {
    const out = sameDirSiblings("src/a/foo.ts", ALL).sort();
    expect(out).toEqual(["src/a/bar.ts", "src/a/foo.test.ts"]);
  });

  it("top-level file → only other top-level files", () => {
    expect(sameDirSiblings("index.ts", ALL)).toEqual([]); // only one top-level file
  });
});

describe("testImplCounterparts", () => {
  it("impl → its tests (co-located AND mirror-located), opposite test-ness only", () => {
    const out = testImplCounterparts("src/a/foo.ts", ALL).sort();
    expect(out).toEqual(["src/a/foo.test.ts", "tests/foo.spec.ts"]);
  });

  it("test → its impl (excludes other tests of the same base)", () => {
    expect(testImplCounterparts("src/a/foo.test.ts", ALL)).toEqual(["src/a/foo.ts"]);
  });

  it("no counterpart → empty", () => {
    expect(testImplCounterparts("src/b/baz.ts", ALL)).toEqual([]);
  });
});

describe("pathReach", () => {
  it("is the de-duplicated union of siblings + test↔impl, never including self", () => {
    const out = pathReach("src/a/foo.ts", ALL).sort();
    expect(out).toEqual(["src/a/bar.ts", "src/a/foo.test.ts", "tests/foo.spec.ts"]);
    expect(out).not.toContain("src/a/foo.ts");
  });
});
