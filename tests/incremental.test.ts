import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { init } from "../src/core.js";

describe("incremental indexing", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `engram-inc-${Date.now()}`);
    mkdirSync(join(testDir, "src"), { recursive: true });
    for (let i = 0; i < 5; i++) {
      writeFileSync(
        join(testDir, "src", `file${i}.ts`),
        `export function hello${i}() { return ${i}; }\n`
      );
    }
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("full init extracts all files", async () => {
    const result = await init(testDir);
    expect(result.fileCount).toBe(5);
    expect(result.nodes).toBeGreaterThan(0);
    expect(result.skippedFiles).toBe(0);
  });

  it("incremental skips unchanged files", async () => {
    // First full init
    await init(testDir);

    // Second incremental — nothing changed
    const result = await init(testDir, { incremental: true });
    expect(result.skippedFiles).toBe(5);
    expect(result.fileCount).toBe(0);
    expect(result.incremental).toBe(true);
  });

  it("incremental re-extracts modified files", async () => {
    await init(testDir);

    // Modify 1 file — need a small delay to ensure mtime changes
    const targetFile = join(testDir, "src", "file0.ts");
    writeFileSync(
      targetFile,
      `export function updated() { return 999; }\nexport const x = 1;\n`
    );

    const result = await init(testDir, { incremental: true });
    expect(result.skippedFiles).toBe(4);
    expect(result.fileCount).toBe(1);
  });

  it("incremental detects new files", async () => {
    await init(testDir);

    // Add a new file
    writeFileSync(
      join(testDir, "src", "newfile.ts"),
      `export function brand_new() { return true; }\n`
    );

    const result = await init(testDir, { incremental: true });
    expect(result.skippedFiles).toBe(5);
    expect(result.fileCount).toBe(1);
  });
});

describe(".engramignore", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `engram-ignore-${Date.now()}`);
    mkdirSync(join(testDir, "src"), { recursive: true });
    mkdirSync(join(testDir, "generated"), { recursive: true });
    writeFileSync(join(testDir, "src", "app.ts"), `export function app() {}\n`);
    writeFileSync(
      join(testDir, "generated", "types.ts"),
      `export type Generated = string;\n`
    );
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("ignores directories listed in .engramignore", async () => {
    writeFileSync(join(testDir, ".engramignore"), "generated\n");
    const result = await init(testDir);
    expect(result.fileCount).toBe(1); // only src/app.ts
  });

  it("supports comments and blank lines in .engramignore", async () => {
    writeFileSync(
      join(testDir, ".engramignore"),
      "# Ignore generated code\n\ngenerated\n"
    );
    const result = await init(testDir);
    expect(result.fileCount).toBe(1);
  });

  it("works without .engramignore file", async () => {
    const result = await init(testDir);
    expect(result.fileCount).toBe(2); // both files
  });
});
