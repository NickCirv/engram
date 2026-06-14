/**
 * cli-guards — the "no graph here" guard for read-commands (engram issue #92).
 *
 * Before this, `query`/`gen` on a path with no graph printed "no nodes" and
 * exited 0, which reads as "your code is empty" rather than "wrong --project".
 * These cover the pure predicate the commands now gate on.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { hasGraph, noGraphMessage } from "../src/cli-guards.js";

describe("cli-guards: hasGraph", () => {
  it("is false for a path that does not exist", () => {
    expect(hasGraph("/no/such/engram/path/xyz")).toBe(false);
  });

  it("is false for a real directory with no .engram/graph.db", () => {
    const d = mkdtempSync(join(tmpdir(), "eg-noguard-"));
    try {
      expect(hasGraph(d)).toBe(false);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("is true for a directory containing .engram/graph.db", () => {
    const d = mkdtempSync(join(tmpdir(), "eg-guard-"));
    try {
      mkdirSync(join(d, ".engram"), { recursive: true });
      writeFileSync(join(d, ".engram", "graph.db"), "");
      expect(hasGraph(d)).toBe(true);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("noGraphMessage names the resolved path and points at `engram init`", () => {
    const msg = noGraphMessage("/no/such/path");
    expect(msg).toContain(resolve("/no/such/path"));
    expect(msg).toContain("engram init");
  });
});
