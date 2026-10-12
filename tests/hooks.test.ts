import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { install, uninstall, status } from "../src/hooks";

/**
 * Regression tests: generated git hooks must invoke the CLI with flags the
 * CLI actually declares.
 *
 * Defect 1: the generated post-commit / post-checkout scripts passed
 * `init . --quiet`, but `engram init` declares no `--quiet` option, so
 * commander exited 1 with "unknown option" (silenced by 2>/dev/null) and the
 * background re-index never ran.
 *
 * Defect 2: the global-install fallback path pointed at
 * `$(npm root -g)/engram/dist/cli.js`, but the npm package is `engramx`, so
 * the fallback could never resolve.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

let tmpRepo: string;

beforeEach(() => {
  tmpRepo = mkdtempSync(join(tmpdir(), "engram-hooks-"));
  mkdirSync(join(tmpRepo, ".git", "hooks"), { recursive: true });
});

afterEach(() => {
  rmSync(tmpRepo, { recursive: true, force: true });
});

function installedHook(name: string): string {
  return readFileSync(join(tmpRepo, ".git", "hooks", name), "utf-8");
}

/** Every --flag passed to `init` inside a generated hook script. */
function initFlagsIn(script: string): string[] {
  const flags: string[] = [];
  for (const line of script.split("\n")) {
    const m = line.match(/init\s+\.\s*(.*)$/);
    if (!m) continue;
    for (const f of m[1].matchAll(/--[a-z][a-z-]*/g)) flags.push(f[0]);
  }
  return flags;
}

/** Long options the CLI's top-level `init` command declares (src/cli.ts). */
function declaredInitOptions(): string[] {
  const cli = readFileSync(join(repoRoot, "src", "cli.ts"), "utf-8");
  const start = cli.indexOf('.command("init")');
  const end = cli.indexOf(".action", start);
  const section = cli.slice(start, end);
  return [...section.matchAll(/"(--[a-z][a-z-]*)/g)].map((m) => m[1]);
}

describe("git hooks: generated scripts match the real CLI surface", () => {
  it("passes only init flags the CLI declares (regression: unsupported --quiet)", () => {
    install(tmpRepo);
    const declared = declaredInitOptions();
    expect(declared.length).toBeGreaterThan(0); // the parser guard itself works

    for (const name of ["post-commit", "post-checkout"]) {
      const script = installedHook(name);
      expect(script).not.toContain("--quiet");
      for (const flag of initFlagsIn(script)) {
        expect(declared).toContain(flag);
      }
    }
  });

  it("silences the background re-index on both stdout and stderr", () => {
    install(tmpRepo);
    for (const name of ["post-commit", "post-checkout"]) {
      const script = installedHook(name);
      expect(script).toMatch(/init \. >\/dev\/null 2>&1 &/);
    }
  });

  it("falls back to the engramx global package path (regression: /engram/)", () => {
    install(tmpRepo);
    for (const name of ["post-commit", "post-checkout"]) {
      const script = installedHook(name);
      expect(script).toContain("/engramx/dist/cli.js");
      expect(script).not.toMatch(/\/engram\/dist\/cli\.js/);
    }
  });

  it("install → status → uninstall round-trips cleanly", () => {
    expect(install(tmpRepo)).toContain("post-commit: installed");
    expect(status(tmpRepo)).toContain("post-commit: installed");
    expect(uninstall(tmpRepo)).toContain("post-commit: removed");
    expect(status(tmpRepo)).toContain("post-commit: not installed");
  });
});
