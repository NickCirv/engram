import { describe, it, expect } from "vitest";
import { resolve as pathResolve } from "node:path";
import {
  parseFileOps,
  handleBashPostTool,
} from "../../../src/intercept/handlers/bash-postool.js";

/**
 * Path helpers: expected values are built via pathResolve to match the
 * platform-native output of the implementation (Windows produces
 * backslashes, macOS/Linux produces forward slashes). Hard-coding POSIX
 * paths broke Windows CI on v2.1 PR #15 — this file is the fix.
 *
 * Uses a platform-appropriate "project root": on Windows pathResolve
 * pins to the current drive, which is fine because the tests only
 * compare against the same pathResolve output.
 */
const CWD = pathResolve("/proj");
const expectedAbs = (rel: string) => pathResolve(CWD, rel);

describe("bash-postool — parseFileOps: rm variants", () => {
  it("parses bare rm with single file", () => {
    const r = parseFileOps("rm src/foo.ts", CWD);
    expect(r).toEqual([{ action: "prune", path: expectedAbs("src/foo.ts") }]);
  });

  it("parses rm -f", () => {
    const r = parseFileOps("rm -f src/foo.ts", CWD);
    expect(r).toEqual([{ action: "prune", path: expectedAbs("src/foo.ts") }]);
  });

  it("parses rm -rf with multiple files", () => {
    const r = parseFileOps("rm -rf src/a.ts src/b.ts", CWD);
    expect(r).toEqual([
      { action: "prune", path: expectedAbs("src/a.ts") },
      { action: "prune", path: expectedAbs("src/b.ts") },
    ]);
  });

  it("keeps absolute paths absolute", () => {
    // Use a platform-native absolute path so this test is consistent
    // across macOS/Linux (/tmp) and Windows (resolves under current drive).
    const abs = pathResolve("/tmp/foo.ts");
    const r = parseFileOps(`rm ${abs}`, CWD);
    expect(r).toEqual([{ action: "prune", path: abs }]);
  });
});

describe("bash-postool — parseFileOps: mv and cp", () => {
  it("mv prunes src and reindexes dst", () => {
    const r = parseFileOps("mv src/old.ts src/new.ts", CWD);
    expect(r).toEqual([
      { action: "prune", path: expectedAbs("src/old.ts") },
      { action: "reindex", path: expectedAbs("src/new.ts") },
    ]);
  });

  it("mv with -v flag still parses", () => {
    const r = parseFileOps("mv -v src/old.ts src/new.ts", CWD);
    expect(r).toEqual([
      { action: "prune", path: expectedAbs("src/old.ts") },
      { action: "reindex", path: expectedAbs("src/new.ts") },
    ]);
  });

  it("cp reindexes dst only", () => {
    const r = parseFileOps("cp src/a.ts src/b.ts", CWD);
    expect(r).toEqual([{ action: "reindex", path: expectedAbs("src/b.ts") }]);
  });

  it("mv with wrong arg count returns empty", () => {
    expect(parseFileOps("mv a.ts", CWD)).toEqual([]);
    expect(parseFileOps("mv a.ts b.ts c.ts", CWD)).toEqual([]);
  });
});

describe("bash-postool — parseFileOps: git variants", () => {
  it("git rm prunes", () => {
    const r = parseFileOps("git rm src/foo.ts", CWD);
    expect(r).toEqual([{ action: "prune", path: expectedAbs("src/foo.ts") }]);
  });

  it("git rm -r prunes", () => {
    const r = parseFileOps("git rm -r src/foo.ts", CWD);
    expect(r).toEqual([{ action: "prune", path: expectedAbs("src/foo.ts") }]);
  });

  it("git mv prunes src and reindexes dst", () => {
    const r = parseFileOps("git mv old.ts new.ts", CWD);
    expect(r).toEqual([
      { action: "prune", path: expectedAbs("old.ts") },
      { action: "reindex", path: expectedAbs("new.ts") },
    ]);
  });

  it("unknown git subcommand returns empty", () => {
    expect(parseFileOps("git status", CWD)).toEqual([]);
    expect(parseFileOps("git commit -m foo", CWD)).toEqual([]);
  });
});

describe("bash-postool — parseFileOps: redirections", () => {
  it("cat with single > redirect reindexes dst", () => {
    const r = parseFileOps("cat template.ts > out.ts", CWD);
    expect(r).toEqual([{ action: "reindex", path: expectedAbs("out.ts") }]);
  });

  it(">> append redirect reindexes dst", () => {
    const r = parseFileOps("echo foo >> log.ts", CWD);
    expect(r).toEqual([{ action: "reindex", path: expectedAbs("log.ts") }]);
  });
});

describe("bash-postool — parseFileOps: pass-through cases", () => {
  it("globs pass through", () => {
    expect(parseFileOps("rm src/*.ts", CWD)).toEqual([]);
  });

  it("pipes pass through", () => {
    expect(parseFileOps("find . | xargs rm", CWD)).toEqual([]);
  });

  it("subshells pass through", () => {
    expect(parseFileOps("rm $(find . -name auth)", CWD)).toEqual([]);
  });

  it("backticks pass through", () => {
    expect(parseFileOps("rm `find . -name auth`", CWD)).toEqual([]);
  });

  it("unrelated commands pass through", () => {
    expect(parseFileOps("ls src/", CWD)).toEqual([]);
    expect(parseFileOps("grep foo src/*", CWD)).toEqual([]);
    expect(parseFileOps("npm test", CWD)).toEqual([]);
  });

  it("empty / invalid input passes through", () => {
    expect(parseFileOps("", CWD)).toEqual([]);
    expect(parseFileOps("   ", CWD)).toEqual([]);
    // @ts-expect-error — testing runtime guard
    expect(parseFileOps(null, CWD)).toEqual([]);
  });

  it("oversized command passes through", () => {
    const huge = "rm " + "x".repeat(501);
    expect(parseFileOps(huge, CWD)).toEqual([]);
  });

  it("touch passes through (empty file, nothing to index)", () => {
    expect(parseFileOps("touch foo.ts", CWD)).toEqual([]);
  });
});

describe("bash-postool — handleBashPostTool", () => {
  it("returns empty ops for non-Bash tool", () => {
    const r = handleBashPostTool({
      tool_name: "Read",
      tool_input: { command: "rm foo.ts" },
      cwd: CWD,
    });
    expect(r.ops).toEqual([]);
  });

  it("returns empty ops when command missing", () => {
    const r = handleBashPostTool({
      tool_name: "Bash",
      tool_input: {},
      cwd: CWD,
    });
    expect(r.ops).toEqual([]);
  });

  it("extracts ops for valid Bash rm", () => {
    const r = handleBashPostTool({
      tool_name: "Bash",
      tool_input: { command: "rm src/foo.ts" },
      cwd: CWD,
    });
    expect(r.ops).toEqual([{ action: "prune", path: expectedAbs("src/foo.ts") }]);
  });
});
