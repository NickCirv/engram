import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Honesty-claims contract (Sub-project 1, 2026-06-02).
 *
 * The 89% figure is a STRUCTURAL per-file context-packet reduction, not an
 * agent-loop cost saving. These tests are a regression guard: they fail loudly
 * if any user-facing surface re-introduces a cost/bill-savings framing or drops
 * the self-disclosing baseline note. See
 * docs/superpowers/specs/2026-06-02-sp1-honest-headline-design.md.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

describe("honesty: bench output self-discloses its baseline", () => {
  const cli = read("src/cli.ts");
  const bench = read("bench/real-world.ts");

  it("engram bench/stats output states the baseline + 'not a bill saving'", () => {
    // init-path disclaimer
    expect(cli).toContain("not a bill saving");
    expect(cli).toMatch(/reading files raw, uncached/);
    // stats-path disclaimer
    expect(cli).toContain("structural packet size, not a bill saving");
  });

  it("real-world bench console + markdown disclose the baseline", () => {
    expect(bench).toMatch(/baseline = reading each file raw and uncached/i);
    expect(bench).toContain("not** a bill saving"); // markdown blockquote
    expect(bench).toMatch(/NOT a bill saving/); // console note
  });
});

describe("honesty: no cost/bill-savings framing on user-facing surfaces", () => {
  it("CLI does not label structural reduction as 'Token savings'", () => {
    const cli = read("src/cli.ts");
    // The misleading "Token savings:" headline must not return.
    expect(cli).not.toMatch(/Token savings:/);
    // No bare numeric cost-savings claim in comments/strings.
    expect(cli).not.toMatch(/\d+%\s+token savings/i);
  });

  it("README hero carries no forward cost-savings promise and no bare savings %", () => {
    const readme = read("README.md");
    expect(readme).not.toMatch(/agent-loop savings landing in/i);
    expect(readme).not.toMatch(/measured (token )?savings/i);
  });

  it("real-world bench reports 'reduction', not 'savings', in its tables/verdict", () => {
    const bench = read("bench/real-world.ts");
    expect(bench).toContain("Aggregate per-file structural reduction");
    expect(bench).toContain("aggregate structural reduction");
    expect(bench).not.toContain("## Top 10 savings");
  });
});
