import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildReport, formatReport, exportReport } from "../../src/doctor/report.js";

describe("doctor/report.ts", () => {
  const fx = join(tmpdir(), "engram-doctor-test-" + Date.now());

  beforeAll(() => {
    mkdirSync(fx, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(fx)) rmSync(fx, { recursive: true, force: true });
  });

  it("produces a report with checks for uninitialized project", () => {
    const report = buildReport(fx, "2.0.2");
    expect(report.projectRoot).toBe(fx);
    expect(report.engramVersion).toBe("2.0.2");
    expect(report.checks.length).toBeGreaterThan(3);
    const graphCheck = report.checks.find((c) => c.name === "graph");
    expect(graphCheck).toBeDefined();
    expect(graphCheck!.severity).toBe("fail");
  });

  it("aggregates overall severity to fail when any check fails", () => {
    const report = buildReport(fx, "2.0.2");
    expect(report.overallSeverity).toBe("fail");
  });

  it("formatReport produces human-readable output", () => {
    const report = buildReport(fx, "2.0.2");
    const text = formatReport(report, false);
    expect(text).toContain("engram doctor");
    expect(text).toContain("2.0.2");
    expect(text).toContain("graph");
  });

  it("formatReport --verbose includes remediation hints for non-ok", () => {
    const report = buildReport(fx, "2.0.2");
    const text = formatReport(report, true);
    // At least one remediation should show (graph is fail with remediation)
    expect(text).toContain("engram init");
  });

  it("exportReport produces valid redacted JSON", () => {
    const report = buildReport(fx, "2.0.2");
    const json = exportReport(report);
    const parsed = JSON.parse(json);
    expect(parsed.engramVersion).toBe("2.0.2");
    expect(Array.isArray(parsed.checks)).toBe(true);
    // projectRoot must be redacted
    expect(parsed.projectRoot).toBeUndefined();
    // All checks have name, severity, detail
    for (const c of parsed.checks) {
      expect(typeof c.name).toBe("string");
      expect(["ok", "warn", "fail"]).toContain(c.severity);
      expect(typeof c.detail).toBe("string");
    }
  });

  it("detects graph.db when present", () => {
    mkdirSync(join(fx, ".engram"), { recursive: true });
    writeFileSync(join(fx, ".engram", "graph.db"), "fake-db", "utf-8");
    const report = buildReport(fx, "2.0.2");
    const graphCheck = report.checks.find((c) => c.name === "graph");
    expect(graphCheck!.severity).toBe("ok");
    rmSync(join(fx, ".engram"), { recursive: true, force: true });
  });
});
