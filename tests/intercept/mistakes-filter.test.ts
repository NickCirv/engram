/**
 * Tests for the new `sourceFile` option on core.ts::mistakes().
 * Exercises the filter both when matching mistakes exist and when they
 * don't. Used by the Edit/Write hook handler for per-file landmine lookup.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { init, learn, mistakes } from "../../src/core.js";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("mistakes() — sourceFile filter", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), "engram-mistakes-filter-"));
    mkdirSync(join(projectRoot, "src"), { recursive: true });

    writeFileSync(
      join(projectRoot, "src", "auth.ts"),
      `export class AuthService {}\nexport function verify() {}\nexport function hash() {}\n`
    );
    writeFileSync(
      join(projectRoot, "src", "db.ts"),
      `export class Db {}\nexport function query() {}\nexport function close() {}\n`
    );

    await init(projectRoot);

    // Seed mistakes via learn(). The session miner parses bug:/fix: lines.
    await learn(
      projectRoot,
      `bug: null pointer in verify when token empty
fix: check token length before verify`,
      "src/auth.ts"
    );
    await learn(
      projectRoot,
      `bug: db connection leaks on error
fix: use try/finally around query`,
      "src/db.ts"
    );
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("returns mistakes from all files when no sourceFile filter is set", async () => {
    const all = await mistakes(projectRoot);
    expect(all.length).toBeGreaterThan(0);
    // At least one from each source file.
    const sources = new Set(all.map((m) => m.sourceFile));
    expect(sources.size).toBeGreaterThanOrEqual(2);
  });

  it("filters to only mistakes matching the given sourceFile", async () => {
    const authMistakes = await mistakes(projectRoot, {
      sourceFile: "src/auth.ts",
    });
    expect(authMistakes.length).toBeGreaterThan(0);
    for (const m of authMistakes) {
      expect(m.sourceFile).toBe("src/auth.ts");
    }
  });

  it("returns empty array when sourceFile has no mistakes", async () => {
    const noneMistakes = await mistakes(projectRoot, {
      sourceFile: "src/nonexistent.ts",
    });
    expect(noneMistakes).toEqual([]);
  });

  it("respects limit alongside sourceFile filter", async () => {
    const limited = await mistakes(projectRoot, {
      sourceFile: "src/auth.ts",
      limit: 1,
    });
    expect(limited.length).toBeLessThanOrEqual(1);
  });

  it("does not match partial paths (exact string match)", async () => {
    const partial = await mistakes(projectRoot, {
      sourceFile: "auth.ts",
    });
    expect(partial).toEqual([]);
  });
});
