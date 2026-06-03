/**
 * Regression test for Fix #3 incremental reference maintenance.
 *
 * The `calls` reference graph (which PageRank ranking depends on) must stay
 * correct across INCREMENTAL re-index, not just full init. Before the
 * two-phase-init fix, editing a file dropped its calls edges without rebuild,
 * so ranking drifted. This locks the maintained behaviour.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { init, callers } from "../src/core.js";

describe("incremental reference-graph maintenance", () => {
  let dir: string;
  const bumpMtime = (rel: string) => {
    const future = new Date(Date.now() + 10_000);
    utimesSync(join(dir, rel), future, future);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "engram-incr-ref-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/hub.ts"), "export function hub(){ return 1; }\n");
    writeFileSync(join(dir, "src/a.ts"), 'import { hub } from "./hub";\nexport function a(){ return hub(); }\n');
    writeFileSync(join(dir, "src/b.ts"), 'import { hub } from "./hub";\nexport function b(){ return hub(); }\n');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("preserves a file's calls edges across incremental re-index", async () => {
    await init(dir);
    expect((await callers(dir, "hub")).sort()).toEqual(["src/a.ts", "src/b.ts"]);

    // Edit a.ts (still calls hub) and re-index incrementally.
    writeFileSync(join(dir, "src/a.ts"), 'import { hub } from "./hub";\n// edited\nexport function a(){ return hub(); }\n');
    bumpMtime("src/a.ts");
    await init(dir, { incremental: true });

    // a.ts must STILL be a caller of hub (would have been dropped before the fix).
    expect((await callers(dir, "hub")).sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("reflects a newly-removed call after incremental re-index", async () => {
    await init(dir);
    expect((await callers(dir, "hub"))).toContain("src/a.ts");

    // a.ts no longer calls hub.
    writeFileSync(join(dir, "src/a.ts"), "export function a(){ return 0; }\n");
    bumpMtime("src/a.ts");
    await init(dir, { incremental: true });

    const c = await callers(dir, "hub");
    expect(c).not.toContain("src/a.ts");
    expect(c).toContain("src/b.ts"); // b unchanged, still a caller
  });
});
