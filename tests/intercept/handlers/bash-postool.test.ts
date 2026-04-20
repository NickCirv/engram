import { describe, it, expect } from "vitest";
import {
  parseFileOps,
  handleBashPostTool,
} from "../../../src/intercept/handlers/bash-postool.js";

describe("bash-postool — parseFileOps: rm variants", () => {
  it("parses bare rm with single file", () => {
    const r = parseFileOps("rm src/foo.ts", "/proj");
    expect(r).toEqual([{ action: "prune", path: "/proj/src/foo.ts" }]);
  });

  it("parses rm -f", () => {
    const r = parseFileOps("rm -f src/foo.ts", "/proj");
    expect(r).toEqual([{ action: "prune", path: "/proj/src/foo.ts" }]);
  });

  it("parses rm -rf with multiple files", () => {
    const r = parseFileOps("rm -rf src/a.ts src/b.ts", "/proj");
    expect(r).toEqual([
      { action: "prune", path: "/proj/src/a.ts" },
      { action: "prune", path: "/proj/src/b.ts" },
    ]);
  });

  it("keeps absolute paths absolute", () => {
    const r = parseFileOps("rm /tmp/foo.ts", "/proj");
    expect(r).toEqual([{ action: "prune", path: "/tmp/foo.ts" }]);
  });
});

describe("bash-postool — parseFileOps: mv and cp", () => {
  it("mv prunes src and reindexes dst", () => {
    const r = parseFileOps("mv src/old.ts src/new.ts", "/proj");
    expect(r).toEqual([
      { action: "prune", path: "/proj/src/old.ts" },
      { action: "reindex", path: "/proj/src/new.ts" },
    ]);
  });

  it("mv with -v flag still parses", () => {
    const r = parseFileOps("mv -v src/old.ts src/new.ts", "/proj");
    expect(r).toEqual([
      { action: "prune", path: "/proj/src/old.ts" },
      { action: "reindex", path: "/proj/src/new.ts" },
    ]);
  });

  it("cp reindexes dst only", () => {
    const r = parseFileOps("cp src/a.ts src/b.ts", "/proj");
    expect(r).toEqual([{ action: "reindex", path: "/proj/src/b.ts" }]);
  });

  it("mv with wrong arg count returns empty", () => {
    expect(parseFileOps("mv a.ts", "/proj")).toEqual([]);
    expect(parseFileOps("mv a.ts b.ts c.ts", "/proj")).toEqual([]);
  });
});

describe("bash-postool — parseFileOps: git variants", () => {
  it("git rm prunes", () => {
    const r = parseFileOps("git rm src/foo.ts", "/proj");
    expect(r).toEqual([{ action: "prune", path: "/proj/src/foo.ts" }]);
  });

  it("git rm -r prunes", () => {
    const r = parseFileOps("git rm -r src/foo.ts", "/proj");
    expect(r).toEqual([{ action: "prune", path: "/proj/src/foo.ts" }]);
  });

  it("git mv prunes src and reindexes dst", () => {
    const r = parseFileOps("git mv old.ts new.ts", "/proj");
    expect(r).toEqual([
      { action: "prune", path: "/proj/old.ts" },
      { action: "reindex", path: "/proj/new.ts" },
    ]);
  });

  it("unknown git subcommand returns empty", () => {
    expect(parseFileOps("git status", "/proj")).toEqual([]);
    expect(parseFileOps("git commit -m foo", "/proj")).toEqual([]);
  });
});

describe("bash-postool — parseFileOps: redirections", () => {
  it("cat with single > redirect reindexes dst", () => {
    const r = parseFileOps("cat template.ts > out.ts", "/proj");
    expect(r).toEqual([{ action: "reindex", path: "/proj/out.ts" }]);
  });

  it(">> append redirect reindexes dst", () => {
    const r = parseFileOps("echo foo >> log.ts", "/proj");
    expect(r).toEqual([{ action: "reindex", path: "/proj/log.ts" }]);
  });
});

describe("bash-postool — parseFileOps: pass-through cases", () => {
  it("globs pass through", () => {
    expect(parseFileOps("rm src/*.ts", "/proj")).toEqual([]);
  });

  it("pipes pass through", () => {
    expect(parseFileOps("find . | xargs rm", "/proj")).toEqual([]);
  });

  it("subshells pass through", () => {
    expect(parseFileOps("rm $(find . -name auth)", "/proj")).toEqual([]);
  });

  it("backticks pass through", () => {
    expect(parseFileOps("rm `find . -name auth`", "/proj")).toEqual([]);
  });

  it("unrelated commands pass through", () => {
    expect(parseFileOps("ls src/", "/proj")).toEqual([]);
    expect(parseFileOps("grep foo src/*", "/proj")).toEqual([]);
    expect(parseFileOps("npm test", "/proj")).toEqual([]);
  });

  it("empty / invalid input passes through", () => {
    expect(parseFileOps("", "/proj")).toEqual([]);
    expect(parseFileOps("   ", "/proj")).toEqual([]);
    // @ts-expect-error — testing runtime guard
    expect(parseFileOps(null, "/proj")).toEqual([]);
  });

  it("oversized command passes through", () => {
    const huge = "rm " + "x".repeat(501);
    expect(parseFileOps(huge, "/proj")).toEqual([]);
  });

  it("touch passes through (empty file, nothing to index)", () => {
    expect(parseFileOps("touch foo.ts", "/proj")).toEqual([]);
  });
});

describe("bash-postool — handleBashPostTool", () => {
  it("returns empty ops for non-Bash tool", () => {
    const r = handleBashPostTool({
      tool_name: "Read",
      tool_input: { command: "rm foo.ts" },
      cwd: "/proj",
    });
    expect(r.ops).toEqual([]);
  });

  it("returns empty ops when command missing", () => {
    const r = handleBashPostTool({
      tool_name: "Bash",
      tool_input: {},
      cwd: "/proj",
    });
    expect(r.ops).toEqual([]);
  });

  it("extracts ops for valid Bash rm", () => {
    const r = handleBashPostTool({
      tool_name: "Bash",
      tool_input: { command: "rm src/foo.ts" },
      cwd: "/proj",
    });
    expect(r.ops).toEqual([{ action: "prune", path: "/proj/src/foo.ts" }]);
  });
});
