/**
 * Co-change reach tier (#143) — end-to-end on a real git repo.
 * Proves the cross-directory win path-reach structurally can't reach:
 * a src/lib file co-changing with a prisma/ schema in different directories.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { init, relatedFilesFor, getStore } from "../src/core.js";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

describe("co-change reach tier (#143)", () => {
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "engram-cc-"));
    git(root, "init", "-q");
    git(root, "config", "user.email", "t@t");
    git(root, "config", "user.name", "t");
    mkdirSync(join(root, "src", "lib"), { recursive: true });
    mkdirSync(join(root, "prisma"), { recursive: true });
    // 3 commits that change a src/lib file AND a prisma schema together — a
    // cross-directory co-change pair (count 3 ≥ CO_CHANGE_MIN_COUNT=2).
    for (let i = 0; i < 3; i++) {
      writeFileSync(join(root, "src", "lib", "db.ts"), `export const q${i} = ${i};\n`);
      writeFileSync(join(root, "prisma", "schema.prisma"), `model M${i} {}\n`);
      git(root, "add", "-A");
      git(root, "commit", "-q", "-m", `change ${i}`);
    }
    await init(root);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("getCoChangeNeighbors surfaces the cross-dir co-changed file (either query direction)", async () => {
    const store = await getStore(root);
    try {
      expect(store.getCoChangeNeighbors("src/lib/db.ts", 10)).toContain("prisma/schema.prisma");
      expect(store.getCoChangeNeighbors("prisma/schema.prisma", 10)).toContain("src/lib/db.ts");
    } finally {
      store.close();
    }
  });

  it("relatedFilesFor reaches the co-changed schema (a non-code, cross-dir file with no graph node)", async () => {
    const rel = await relatedFilesFor(root, "src/lib/db.ts", 5);
    expect(rel).toContain("prisma/schema.prisma");
  });

  it("co-change is rebuilt as a full replace on re-init (idempotent, no duplicates)", async () => {
    await init(root); // second mine
    const store = await getStore(root);
    try {
      const n = store.getCoChangeNeighbors("src/lib/db.ts", 10);
      expect(n.filter((f) => f === "prisma/schema.prisma")).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("getCoChangeNeighbors: bidirectional lookup + count ordering + tie-break (direct)", async () => {
    const store = await getStore(root);
    try {
      // Hand-seed known pairs (stored once under the sorted key, a < b).
      store.replaceCoChange([
        { a: "a.ts", b: "b.ts", count: 5 }, // query side = file_a
        { a: "b.ts", b: "c.ts", count: 9 }, // query "b.ts" must hit the file_a side
        { a: "b.ts", b: "d.ts", count: 9 }, // tie with c.ts at count 9 → path ASC
      ]);
      // From b.ts: neighbours are c.ts(9), d.ts(9), a.ts(5) — count DESC, tie by path ASC.
      expect(store.getCoChangeNeighbors("b.ts", 10)).toEqual(["c.ts", "d.ts", "a.ts"]);
      // From a.ts (only on the file_a side of one pair) → b.ts.
      expect(store.getCoChangeNeighbors("a.ts", 10)).toEqual(["b.ts"]);
      // From c.ts (only on the file_b side) → b.ts. Never returns itself.
      expect(store.getCoChangeNeighbors("c.ts", 10)).toEqual(["b.ts"]);
      // Limit is respected.
      expect(store.getCoChangeNeighbors("b.ts", 1)).toEqual(["c.ts"]);
    } finally {
      store.close();
    }
  });
});
