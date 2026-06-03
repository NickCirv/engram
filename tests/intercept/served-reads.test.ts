/**
 * Same-session read dedup tests (ADR-0003) — the served-reads store + the
 * handleRead integration.
 *
 * Module branches:
 *   - first read records → false
 *   - second unchanged read → true (dedup)
 *   - changed file → false (re-records)
 *   - tiny file (< 400 bytes) → false (never dedup)
 *   - empty/invalid session → false
 *   - clearServedReads resets → false  (the PreCompact eviction boundary)
 *
 * Handler branches:
 *   - 2nd read of an unchanged in-graph file → dedup pointer
 *   - 2nd read of an unchanged not-in-graph (passthrough) file → dedup pointer
 *   - ENGRAM_READ_DEDUP=0 → never dedups
 *   - partial read (offset/limit) → never dedups (full-read-only guard)
 *   - after PreCompact → re-read re-serves (no dedup)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { init } from "../../src/core.js";
import {
  dedupOrRecord,
  clearServedReads,
} from "../../src/intercept/served-reads.js";
import { handleRead } from "../../src/intercept/handlers/read.js";
import { handlePreCompact } from "../../src/intercept/handlers/pre-compact.js";
import { handleSessionStart } from "../../src/intercept/handlers/session-start.js";
import { PASSTHROUGH } from "../../src/intercept/safety.js";
import { _resetCacheForTests } from "../../src/intercept/context.js";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SESSION = "test-session-abc";

// A large, rich source file (~3 KB) so engram's structural summary is
// genuinely SMALLER than the raw file — the first read is then intercepted with
// a packet (deny), exercising the dedup-of-a-served-packet path. Verbose
// function bodies inflate the file without inflating the structural summary.
const BIG_SOURCE = `// A realistic, sizeable module. Long bodies → big file, small summary.
export class TokenService {
  private cache = new Map<string, number>();
  private readonly salt: number;
  constructor(salt = 1469598103) { this.salt = salt | 0; }
  hash(s: string): number {
    let h = this.salt;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
      h ^= h >>> 13;
    }
    return h >>> 0;
  }
  issue(userId: string): string {
    const h = this.hash(userId);
    this.cache.set(userId, h);
    return "tok_" + h.toString(36) + "_" + userId.length.toString(36);
  }
  validate(token: string): boolean {
    if (typeof token !== "string") return false;
    if (!token.startsWith("tok_")) return false;
    const parts = token.split("_");
    if (parts.length !== 3) return false;
    return parts[1].length > 0 && parts[2].length > 0;
  }
  rotate(oldToken: string, userId: string): string {
    if (!this.validate(oldToken)) throw new Error("invalid token supplied");
    this.cache.delete(userId);
    return this.issue(userId);
  }
  peek(userId: string): number | undefined { return this.cache.get(userId); }
  clear(): void { this.cache.clear(); }
}
export class SessionRegistry {
  private active = new Map<string, number>();
  open(id: string, now: number): void { this.active.set(id, now); }
  close(id: string): boolean { return this.active.delete(id); }
  isOpen(id: string): boolean { return this.active.has(id); }
  count(): number { return this.active.size; }
  prune(before: number): number {
    let removed = 0;
    for (const [id, ts] of this.active) {
      if (ts < before) { this.active.delete(id); removed++; }
    }
    return removed;
  }
}
export function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\\s+/g, " ");
}
export function keyFor(name: string): string {
  const n = normalize(name);
  return n.length > 0 ? n : "anonymous";
}
export function verify(t: string): boolean {
  return typeof t === "string" && t.length > 4 && t.startsWith("tok_");
}
export function summarize(tokens: string[]): { valid: number; invalid: number } {
  let valid = 0;
  let invalid = 0;
  for (const t of tokens) { if (verify(t)) valid++; else invalid++; }
  return { valid, invalid };
}
`;

/** Reason text of a handler result, or "" for a passthrough (null) — so
 *  assertions work whether the underlying read denies or passes through. */
function reasonOf(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const out = (result as Record<string, unknown>).hookSpecificOutput as
    | Record<string, unknown>
    | undefined;
  const reason = out?.permissionDecisionReason;
  return typeof reason === "string" ? reason : "";
}

describe("served-reads module", () => {
  let root: string;
  let bigFile: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "engram-served-mod-"));
    mkdirSync(join(root, ".engram"), { recursive: true });
    bigFile = join(root, "big.ts");
    writeFileSync(bigFile, BIG_SOURCE);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("records the first read and returns false", () => {
    expect(dedupOrRecord(root, SESSION, bigFile)).toBe(false);
  });

  it("dedups an unchanged second read", () => {
    expect(dedupOrRecord(root, SESSION, bigFile)).toBe(false);
    expect(dedupOrRecord(root, SESSION, bigFile)).toBe(true);
  });

  it("re-records (no dedup) when the file changed", () => {
    expect(dedupOrRecord(root, SESSION, bigFile)).toBe(false);
    // change size → not byte-identical
    writeFileSync(bigFile, BIG_SOURCE + "\nexport const extra = 1;\n");
    expect(dedupOrRecord(root, SESSION, bigFile)).toBe(false);
  });

  it("never dedups a tiny file (< 400 bytes)", () => {
    const tiny = join(root, "tiny.ts");
    writeFileSync(tiny, "export const x = 1;\n");
    expect(dedupOrRecord(root, SESSION, tiny)).toBe(false);
    expect(dedupOrRecord(root, SESSION, tiny)).toBe(false);
  });

  it("never dedups with an empty/invalid session id", () => {
    expect(dedupOrRecord(root, "", bigFile)).toBe(false);
    expect(dedupOrRecord(root, "!!!", bigFile)).toBe(false); // sanitises to empty
    expect(dedupOrRecord(root, "!!!", bigFile)).toBe(false);
  });

  it("clearServedReads resets the session (PreCompact boundary)", () => {
    expect(dedupOrRecord(root, SESSION, bigFile)).toBe(false);
    expect(dedupOrRecord(root, SESSION, bigFile)).toBe(true);
    clearServedReads(root, SESSION);
    // after a reset, the next read re-serves (re-records), no dedup
    expect(dedupOrRecord(root, SESSION, bigFile)).toBe(false);
  });

  it("keys sessions independently", () => {
    expect(dedupOrRecord(root, SESSION, bigFile)).toBe(false);
    expect(dedupOrRecord(root, "other-session", bigFile)).toBe(false);
  });

  it("does not dedup a TTL-expired record (recall-safety backstop)", () => {
    expect(dedupOrRecord(root, SESSION, bigFile)).toBe(false); // record
    // age the record well past the 30-min TTL
    const store = join(root, ".engram", `served-reads-${SESSION}.json`);
    const map = JSON.parse(readFileSync(store, "utf-8")) as Record<
      string,
      { mtimeMs: number; size: number; at: number }
    >;
    for (const k of Object.keys(map)) map[k].at = Date.now() - 31 * 60 * 1000;
    writeFileSync(store, JSON.stringify(map));
    expect(dedupOrRecord(root, SESSION, bigFile)).toBe(false); // expired → re-serve
  });

  it("caps the served set and evicts the oldest entries", () => {
    const store = join(root, ".engram", `served-reads-${SESSION}.json`);
    const map: Record<string, { mtimeMs: number; size: number; at: number }> = {};
    for (let i = 0; i < 256; i++) map[`f${i}.ts`] = { mtimeMs: 1, size: 500, at: i };
    writeFileSync(store, JSON.stringify(map));
    expect(dedupOrRecord(root, SESSION, bigFile)).toBe(false); // record → triggers cap
    const after = JSON.parse(readFileSync(store, "utf-8")) as Record<
      string,
      unknown
    >;
    expect(Object.keys(after).length).toBeLessThanOrEqual(256);
    expect(after["big.ts"]).toBeDefined(); // the new entry is kept
    expect(after["f0.ts"]).toBeUndefined(); // the oldest (at:0) is evicted
  });
});

describe("handleRead — dedup integration", () => {
  let root: string;
  let bigFile: string;

  beforeEach(async () => {
    _resetCacheForTests();
    root = mkdtempSync(join(tmpdir(), "engram-served-h-"));
    mkdirSync(join(root, "src"), { recursive: true });
    bigFile = join(root, "src", "token.ts");
    writeFileSync(bigFile, BIG_SOURCE);
    await init(root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function read(file: string, extra: Record<string, unknown> = {}) {
    return handleRead({
      tool_name: "Read",
      cwd: root,
      session_id: SESSION,
      tool_input: { file_path: file, ...extra },
    } as never);
  }

  it("dedups the 2nd read of an unchanged in-graph file", async () => {
    // First read: a real packet (deny) or passthrough — never a dedup pointer.
    expect(reasonOf(await read(bigFile))).not.toContain("already read");
    // Second read of the unchanged file → dedup pointer.
    const secondReason = reasonOf(await read(bigFile));
    expect(secondReason).toContain("already read");
    expect(secondReason).toContain("src/token.ts");
  });

  it("dedups the 2nd read of an unchanged not-in-graph (passthrough) file", async () => {
    // written AFTER init → not in the graph → first read passes through
    const ghost = join(root, "src", "ghost.ts");
    writeFileSync(ghost, BIG_SOURCE); // > 400 bytes
    expect(await read(ghost)).toBe(PASSTHROUGH);
    expect(reasonOf(await read(ghost))).toContain("already read");
  });

  it("does not dedup when ENGRAM_READ_DEDUP=0", async () => {
    const prev = process.env.ENGRAM_READ_DEDUP;
    process.env.ENGRAM_READ_DEDUP = "0";
    try {
      await read(bigFile);
      expect(reasonOf(await read(bigFile))).not.toContain("already read");
    } finally {
      if (prev === undefined) delete process.env.ENGRAM_READ_DEDUP;
      else process.env.ENGRAM_READ_DEDUP = prev;
    }
  });

  it("never dedups a partial read (offset/limit) of an already-read file", async () => {
    await read(bigFile); // records
    // a partial re-read wants specific lines — must pass through, never dedup
    expect(await read(bigFile, { offset: 5 })).toBe(PASSTHROUGH);
  });

  it("re-serves (no dedup) after a PreCompact reset", async () => {
    await read(bigFile);
    expect(reasonOf(await read(bigFile))).toContain("already read");

    await handlePreCompact({
      hook_event_name: "PreCompact",
      cwd: root,
      session_id: SESSION,
    } as never);

    // after the reset, the next read re-serves the real content, not a pointer
    expect(reasonOf(await read(bigFile))).not.toContain("already read");
  });

  it("re-serves (no dedup) after a cleared/fresh SessionStart", async () => {
    // closes the /clear + session-reuse hole PreCompact alone doesn't cover
    await read(bigFile);
    expect(reasonOf(await read(bigFile))).toContain("already read");

    await handleSessionStart({
      hook_event_name: "SessionStart",
      source: "clear",
      cwd: root,
      session_id: SESSION,
    } as never);

    expect(reasonOf(await read(bigFile))).not.toContain("already read");
  });
});
