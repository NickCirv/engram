import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { logAudit, readAudit, MESH_AUDIT_MAX_BYTES } from "../../src/mesh/index.js";

function fresh(): string {
  return mkdtempSync(join(tmpdir(), "engram-mesh-audit-"));
}

describe("mesh.audit", () => {
  it("logs an entry and reads it back", () => {
    const dir = fresh();
    logAudit({ ts: "", action: "send", peer: "abc", envelopeId: "01HXX", type: "peer.hello", bytes: 200 }, dir);
    const entries = readAudit(dir);
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe("send");
    expect(entries[0].peer).toBe("abc");
    expect(entries[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("appends multiple entries", () => {
    const dir = fresh();
    logAudit({ ts: "", action: "send" }, dir);
    logAudit({ ts: "", action: "receive" }, dir);
    logAudit({ ts: "", action: "reject", reason: "bad-sig" }, dir);
    const entries = readAudit(dir);
    expect(entries.length).toBe(3);
    expect(entries.map((e) => e.action)).toEqual(["send", "receive", "reject"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("preserves an explicit ts when provided", () => {
    const dir = fresh();
    const ts = "2026-05-02T10:00:00.000Z";
    logAudit({ ts, action: "send" }, dir);
    expect(readAudit(dir)[0].ts).toBe(ts);
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns [] on missing log", () => {
    const dir = fresh();
    expect(readAudit(dir)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("skips malformed JSONL lines", () => {
    const dir = fresh();
    writeFileSync(join(dir, "audit.jsonl"), 'not-json\n{"action":"send","ts":"2026-05-02T10:00:00.000Z"}\n');
    const entries = readAudit(dir);
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe("send");
    rmSync(dir, { recursive: true, force: true });
  });

  it("never throws when the directory does not exist", () => {
    expect(() => logAudit({ ts: "", action: "send" }, "/totally/fake/path")).not.toThrow();
  });

  it("size cap is 10MB", () => {
    expect(MESH_AUDIT_MAX_BYTES).toBe(10 * 1024 * 1024);
  });
});
