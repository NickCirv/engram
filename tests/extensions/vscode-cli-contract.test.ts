import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Contract test: every CLI subcommand the VS Code extension invokes must be
 * declared by src/cli.ts.
 *
 * Background: the September 2026 documentation audit reported the extension's
 * `engram dashboard` invocation as incompatible with a CLI that "declares
 * `ui`". Execution shows the CLI declares BOTH: `dashboard|hud` (terminal
 * HUD, since v0.4.2) and `ui` (web dashboard). This test pins the real
 * contract so any future rename/removal on either side fails loudly instead
 * of shipping a broken editor command.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf-8");

/** Subcommands the extension sends to the terminal: `${cfg.cliPath} <cmd> ...` */
function extensionInvocations(): string[] {
  const src = read("extensions/vscode/src/extension.ts");
  const out = new Set<string>();
  for (const m of src.matchAll(/\$\{cfg\.cliPath\}\s+([a-z][a-z-]*)/g)) {
    out.add(m[1]);
  }
  return [...out];
}

/** Command names and aliases declared anywhere in the CLI. */
function declaredCliCommands(): Set<string> {
  const cli = read("src/cli.ts");
  const names = new Set<string>();
  for (const m of cli.matchAll(/\.command\("([a-z][a-z-]*)"/g)) names.add(m[1]);
  for (const m of cli.matchAll(/\.alias\("([a-z][a-z-]*)"\)/g)) names.add(m[1]);
  return names;
}

describe("vscode extension ↔ CLI command contract", () => {
  it("extracts a non-trivial invocation list (parser guard)", () => {
    const invoked = extensionInvocations();
    expect(invoked.length).toBeGreaterThanOrEqual(5);
    expect(invoked).toContain("init");
    expect(invoked).toContain("dashboard");
  });

  it("every subcommand the extension invokes is declared by the CLI", () => {
    const declared = declaredCliCommands();
    for (const cmd of extensionInvocations()) {
      expect(declared, `extension invokes 'engram ${cmd}'`).toContain(cmd);
    }
  });

  it("the audited pair both exist: terminal 'dashboard' and web 'ui'", () => {
    const declared = declaredCliCommands();
    expect(declared).toContain("dashboard");
    expect(declared).toContain("ui");
  });
});
