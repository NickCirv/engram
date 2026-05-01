/**
 * v3.3 Cost Lens — unit tests for aggregator + formatter + digest.
 *
 * Tests use a tmp dir with a synthetic .engram/hook-log.jsonl so they
 * are hermetic and don't depend on a real engram-indexed project.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readEvents,
  summarize,
  summarizeProjects,
  formatOneLine,
  formatTable,
  formatMarkdownDigest,
  writeWeeklyDigest,
  isoWeekLabel,
  DEFAULT_COST_CONFIG,
} from "../src/cost/index.js";

function makeProject(events: object[]): string {
  const root = mkdtempSync(join(tmpdir(), "engram-cost-"));
  mkdirSync(join(root, ".engram"), { recursive: true });
  const lines = events.map((e) => JSON.stringify(e)).join("\n");
  writeFileSync(join(root, ".engram", "hook-log.jsonl"), lines + "\n");
  return root;
}

describe("cost.aggregator", () => {
  it("returns empty array on missing log", () => {
    const root = mkdtempSync(join(tmpdir(), "engram-cost-empty-"));
    expect(readEvents(root)).toEqual([]);
  });

  it("parses well-formed events", () => {
    const root = makeProject([
      {
        ts: "2026-05-01T10:00:00Z",
        event: "PreToolUse",
        tool: "Read",
        wouldHaveRead: 1000,
        injected: 100,
        tokensSaved: 900,
      },
    ]);
    const events = readEvents(root);
    expect(events.length).toBe(1);
    expect(events[0].tokensSaved).toBe(900);
  });

  it("skips malformed lines without throwing", () => {
    const root = mkdtempSync(join(tmpdir(), "engram-cost-bad-"));
    mkdirSync(join(root, ".engram"), { recursive: true });
    writeFileSync(
      join(root, ".engram", "hook-log.jsonl"),
      'not-json\n{"event":"PreToolUse","ts":"2026-01-01T00:00:00Z"}\n',
    );
    const events = readEvents(root);
    expect(events.length).toBe(1);
  });

  it("rejects negative or non-finite numbers", () => {
    const root = makeProject([
      { ts: "2026-05-01T10:00:00Z", event: "x", tokensSaved: -10 },
      { ts: "2026-05-01T10:00:01Z", event: "x", tokensSaved: "abc" },
    ]);
    const events = readEvents(root);
    expect(events.every((e) => e.tokensSaved === undefined)).toBe(true);
  });
});

describe("cost.summarize", () => {
  it("computes totals and reduction ratio", () => {
    const events = [
      { ts: "2026-05-01T10:00:00Z", event: "x", tokensSaved: 900, wouldHaveRead: 1000, injected: 100 },
      { ts: "2026-05-01T11:00:00Z", event: "x", tokensSaved: 1800, wouldHaveRead: 2000, injected: 200 },
    ].map((e) => ({ ...e }));
    const summary = summarize(events as never);
    expect(summary.tokensSaved).toBe(2700);
    expect(summary.tokensInjected).toBe(300);
    expect(summary.tokensWouldHave).toBe(3000);
    expect(summary.reductionRatio).toBeCloseTo(0.9, 2);
    expect(summary.events).toBe(2);
  });

  it("handles zero events without NaN", () => {
    const s = summarize([]);
    expect(s.reductionRatio).toBe(0);
    expect(s.approxUsdSaved).toBe(0);
  });

  it("computes USD using configured rate", () => {
    const events = [
      { ts: "2026-05-01T10:00:00Z", event: "x", tokensSaved: 1_000_000 },
    ];
    const s = summarize(events as never, { ...DEFAULT_COST_CONFIG, inputUsdPerMillion: 5 });
    expect(s.approxUsdSaved).toBeCloseTo(5.0, 5);
  });
});

describe("cost.summarizeProjects", () => {
  it("aggregates per project independently", () => {
    const a = makeProject([
      { ts: "2026-05-01T10:00:00Z", event: "x", tokensSaved: 100 },
    ]);
    const b = makeProject([
      { ts: "2026-05-01T10:00:00Z", event: "x", tokensSaved: 200 },
    ]);
    const rows = summarizeProjects([a, b]);
    expect(rows[0].summary.tokensSaved).toBe(100);
    expect(rows[1].summary.tokensSaved).toBe(200);
  });
});

describe("cost.formatter", () => {
  it("formats one-liner with all 4 fields", () => {
    const s = summarize([
      { ts: "2026-05-01T10:00:00Z", event: "x", tokensSaved: 1500, wouldHaveRead: 2000, injected: 500 },
    ] as never);
    const line = formatOneLine(s);
    expect(line).toContain("1.5K tokens saved");
    expect(line).toContain("75.0% reduction");
    expect(line).toContain("1 events");
  });

  it("renders empty table message", () => {
    expect(formatTable([])).toContain("(no projects");
  });

  it("renders Markdown digest with header + table", () => {
    const md = formatMarkdownDigest(
      [
        {
          projectRoot: "/tmp/foo",
          summary: summarize([
            { ts: "2026-05-01T10:00:00Z", event: "x", tokensSaved: 1000 },
          ] as never),
        },
      ],
      summarize([
        { ts: "2026-05-01T10:00:00Z", event: "x", tokensSaved: 1000 },
      ] as never),
      "2026-W18",
    );
    expect(md).toContain("# Engram Cost Digest — 2026-W18");
    expect(md).toContain("| Project |");
  });
});

describe("cost.aggregator + instrument round-trip", () => {
  it("aggregator picks up wouldHaveRead/injected/tokensSaved emitted via composeCostFields", () => {
    // Simulates what dispatch.ts produces when Read is intercepted on a 40KB file
    // with a 1200-char engram summary: wouldHaveRead=10K tokens, injected=300, saved=9700.
    const root = makeProject([
      {
        ts: "2026-05-01T10:00:00Z",
        event: "PreToolUse",
        tool: "Read",
        path: "/tmp/big.txt",
        decision: "deny",
        wouldHaveRead: 10000,
        injected: 300,
        tokensSaved: 9700,
      },
      {
        ts: "2026-05-01T10:00:01Z",
        event: "PreToolUse",
        tool: "Edit",
        path: "/tmp/foo.ts",
        decision: "allow",
        injected: 200, // augmentation only — no wouldHaveRead/tokensSaved
      },
    ]);
    const events = readEvents(root);
    const summary = summarize(events);
    expect(summary.tokensSaved).toBe(9700);
    expect(summary.tokensInjected).toBe(500);
    expect(summary.tokensWouldHave).toBe(10000);
    expect(summary.reductionRatio).toBeCloseTo(0.97, 2);
    expect(summary.events).toBe(2);
  });
});

describe("cost.digest", () => {
  it("isoWeekLabel produces YYYY-Www", () => {
    expect(isoWeekLabel(new Date("2026-05-01T00:00:00Z"))).toMatch(/^2026-W\d{2}$/);
  });

  it("writeWeeklyDigest writes a file", () => {
    const proj = makeProject([
      { ts: "2026-05-01T10:00:00Z", event: "x", tokensSaved: 500 },
    ]);
    const outDir = mkdtempSync(join(tmpdir(), "engram-cost-out-"));
    const result = writeWeeklyDigest([proj], DEFAULT_COST_CONFIG, outDir);
    const md = readFileSync(result.path, "utf8");
    expect(md).toContain("Engram Cost Digest");
    expect(md).toContain("500");
  });
});
