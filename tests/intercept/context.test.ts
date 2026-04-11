import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  normalizePath,
  isExemptPath,
  findProjectRoot,
  isInsideProject,
  resolveInterceptContext,
  _resetCacheForTests,
} from "../../src/intercept/context.js";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

describe("context — normalizePath", () => {
  it("returns empty string for empty input", () => {
    expect(normalizePath("", "/home/user")).toBe("");
  });

  it("returns absolute paths unchanged (but canonicalized)", () => {
    expect(normalizePath("/foo/bar", "/home/user")).toBe("/foo/bar");
  });

  it("resolves relative paths against cwd", () => {
    expect(normalizePath("src/index.ts", "/home/user/proj")).toBe(
      "/home/user/proj/src/index.ts"
    );
  });

  it("collapses .. and . segments", () => {
    expect(normalizePath("/foo/bar/../baz", "/any")).toBe("/foo/baz");
    expect(normalizePath("./x/./y", "/tmp/cwd")).toBe("/tmp/cwd/x/y");
  });
});

describe("context — isExemptPath (project-internal ignored zones)", () => {
  it("exempts paths inside .engram/cache/", () => {
    expect(isExemptPath("/home/user/proj/.engram/cache/summary.md")).toBe(true);
  });

  it("exempts paths inside node_modules", () => {
    expect(isExemptPath("/home/user/proj/node_modules/foo/index.js")).toBe(true);
  });

  it("exempts paths inside .git", () => {
    expect(isExemptPath("/home/user/proj/.git/HEAD")).toBe(true);
  });

  it("does NOT blanket-exempt /tmp/ (that's handled by project walk)", () => {
    // This is intentional: a legitimate engram project inside /tmp/ (e.g.
    // a test fixture) should still be intercepted. Scratch files in /tmp/
    // without an engram ancestor are exempted naturally by findProjectRoot.
    expect(isExemptPath("/tmp/foo.txt")).toBe(false);
  });

  it("does NOT exempt regular project files", () => {
    expect(isExemptPath("/home/user/proj/src/index.ts")).toBe(false);
  });

  it("treats empty path as exempt (fail-safe)", () => {
    expect(isExemptPath("")).toBe(true);
  });
});

describe("context — findProjectRoot", () => {
  let rootDir: string;
  let projectA: string;
  let fileInA: string;
  let nestedFile: string;
  let outsideFile: string;

  beforeEach(() => {
    _resetCacheForTests();
    rootDir = mkdtempSync(join(tmpdir(), "engram-context-test-"));
    projectA = join(rootDir, "projectA");
    mkdirSync(join(projectA, ".engram"), { recursive: true });
    writeFileSync(join(projectA, ".engram", "graph.db"), "mock-db-content");

    // File directly in project
    fileInA = join(projectA, "src", "index.ts");
    mkdirSync(join(projectA, "src"), { recursive: true });
    writeFileSync(fileInA, "// hello");

    // Deeply nested file
    nestedFile = join(projectA, "src", "deep", "nested", "util.ts");
    mkdirSync(join(projectA, "src", "deep", "nested"), { recursive: true });
    writeFileSync(nestedFile, "// deep");

    // File outside any project
    outsideFile = join(rootDir, "scratch.txt");
    writeFileSync(outsideFile, "// outside");
  });

  afterEach(() => {
    _resetCacheForTests();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("finds project root for a direct file", () => {
    expect(findProjectRoot(fileInA)).toBe(resolve(projectA));
  });

  it("finds project root for a deeply nested file", () => {
    expect(findProjectRoot(nestedFile)).toBe(resolve(projectA));
  });

  it("returns null for files outside any engram project", () => {
    expect(findProjectRoot(outsideFile)).toBe(null);
  });

  it("returns null for empty path", () => {
    expect(findProjectRoot("")).toBe(null);
  });

  it("returns null for files in a non-existent directory that has no engram ancestor", () => {
    const ghost = join(rootDir, "does-not-exist", "file.ts");
    expect(findProjectRoot(ghost)).toBe(null);
  });

  it("caches results per starting directory", () => {
    // First call populates cache; second call hits it. Both should return
    // the same value. (Correctness test, not timing test.)
    const a = findProjectRoot(fileInA);
    const b = findProjectRoot(fileInA);
    expect(a).toBe(b);
    expect(a).toBe(resolve(projectA));
  });
});

describe("context — isInsideProject", () => {
  let rootDir: string;
  let projectA: string;
  let projectB: string;
  let fileInA: string;
  let fileInB: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), "engram-inside-test-"));
    projectA = join(rootDir, "projectA");
    projectB = join(rootDir, "projectB");
    mkdirSync(projectA, { recursive: true });
    mkdirSync(projectB, { recursive: true });

    fileInA = join(projectA, "file.ts");
    fileInB = join(projectB, "file.ts");
    writeFileSync(fileInA, "// A");
    writeFileSync(fileInB, "// B");
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("returns true when file is directly inside project", () => {
    expect(isInsideProject(fileInA, projectA)).toBe(true);
  });

  it("returns false when file is outside project", () => {
    expect(isInsideProject(fileInA, projectB)).toBe(false);
  });

  it("returns true when file equals project root", () => {
    expect(isInsideProject(projectA, projectA)).toBe(true);
  });

  it("returns false for empty paths", () => {
    expect(isInsideProject("", projectA)).toBe(false);
    expect(isInsideProject(fileInA, "")).toBe(false);
  });

  it("does not match on bare prefix (directory boundary check)", () => {
    // projectA vs projectA-sibling — a naive prefix match would falsely
    // report the sibling as inside projectA.
    const sibling = join(rootDir, "projectA-sibling");
    mkdirSync(sibling, { recursive: true });
    const siblingFile = join(sibling, "file.ts");
    writeFileSync(siblingFile, "// sib");
    expect(isInsideProject(siblingFile, projectA)).toBe(false);
  });
});

describe("context — resolveInterceptContext (end-to-end)", () => {
  let rootDir: string;
  let projectA: string;

  beforeEach(() => {
    _resetCacheForTests();
    rootDir = mkdtempSync(join(tmpdir(), "engram-resolve-test-"));
    projectA = join(rootDir, "proj");
    mkdirSync(join(projectA, ".engram"), { recursive: true });
    writeFileSync(join(projectA, ".engram", "graph.db"), "db");
    mkdirSync(join(projectA, "src"), { recursive: true });
    writeFileSync(join(projectA, "src", "index.ts"), "// code");
  });

  afterEach(() => {
    _resetCacheForTests();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("returns proceed=true with resolved paths for a valid file", () => {
    const ctx = resolveInterceptContext(
      join(projectA, "src", "index.ts"),
      projectA
    );
    expect(ctx.proceed).toBe(true);
    if (ctx.proceed) {
      expect(ctx.absPath).toBe(resolve(projectA, "src", "index.ts"));
      expect(ctx.projectRoot).toBe(resolve(projectA));
    }
  });

  it("rejects empty file path", () => {
    const ctx = resolveInterceptContext("", projectA);
    expect(ctx.proceed).toBe(false);
    if (!ctx.proceed) expect(ctx.reason).toBe("empty-path");
  });

  it("rejects /tmp/ paths that have no engram ancestor via no-project-root", () => {
    const ctx = resolveInterceptContext("/tmp/foo.txt", projectA);
    expect(ctx.proceed).toBe(false);
    if (!ctx.proceed) expect(ctx.reason).toBe("no-project-root");
  });

  it("rejects hard system paths with reason=system-path", () => {
    const ctx = resolveInterceptContext("/dev/null", projectA);
    expect(ctx.proceed).toBe(false);
    if (!ctx.proceed) expect(ctx.reason).toBe("system-path");
  });

  it("rejects project-internal ignored paths (node_modules) with reason=exempt-path", () => {
    const nodeModFile = join(projectA, "node_modules", "foo", "index.js");
    mkdirSync(join(projectA, "node_modules", "foo"), { recursive: true });
    writeFileSync(nodeModFile, "// dep");
    const ctx = resolveInterceptContext(nodeModFile, projectA);
    expect(ctx.proceed).toBe(false);
    if (!ctx.proceed) expect(ctx.reason).toBe("exempt-path");
  });

  it("rejects files without an engram-initialized ancestor", () => {
    const lone = join(rootDir, "orphan.ts");
    writeFileSync(lone, "// lone");
    const ctx = resolveInterceptContext(lone, rootDir);
    expect(ctx.proceed).toBe(false);
    if (!ctx.proceed) expect(ctx.reason).toBe("no-project-root");
  });

  it("resolves relative paths against cwd", () => {
    const ctx = resolveInterceptContext("src/index.ts", projectA);
    expect(ctx.proceed).toBe(true);
    if (ctx.proceed) {
      expect(ctx.absPath).toBe(resolve(projectA, "src", "index.ts"));
    }
  });
});
