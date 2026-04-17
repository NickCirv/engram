import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readConfig, writeConfig, type EngramConfig } from "../../src/tuner/config.js";
import { analyzeTuning, applyTuning } from "../../src/tuner/index.js";

// ── helpers ────────────────────────────────────────────────────────

function makeTmpProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "engram-tuner-test-"));
  mkdirSync(join(dir, ".engram"), { recursive: true });
  return dir;
}

function writeHookLog(projectRoot: string, lines: object[]): void {
  const content = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  writeFileSync(join(projectRoot, ".engram", "hook-log.jsonl"), content, "utf-8");
}

// ── readConfig ────────────────────────────────────────────────────

describe("readConfig", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpProject();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns defaults when config file is absent", () => {
    const cfg = readConfig(dir);
    expect(cfg.confidenceThreshold).toBe(0.7);
    expect(cfg.totalTokenBudget).toBe(600);
    expect(cfg.providers).toEqual({});
  });

  it("merges partial config over defaults", () => {
    writeFileSync(
      join(dir, ".engram", "config.json"),
      JSON.stringify({ totalTokenBudget: 900 }),
      "utf-8"
    );
    const cfg = readConfig(dir);
    expect(cfg.totalTokenBudget).toBe(900);
    expect(cfg.confidenceThreshold).toBe(0.7); // default preserved
  });

  it("returns defaults on malformed JSON", () => {
    writeFileSync(join(dir, ".engram", "config.json"), "{bad json}", "utf-8");
    const cfg = readConfig(dir);
    expect(cfg.confidenceThreshold).toBe(0.7);
  });
});

// ── writeConfig ───────────────────────────────────────────────────

describe("writeConfig", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpProject();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a valid JSON file", () => {
    const cfg: EngramConfig = {
      confidenceThreshold: 0.85,
      totalTokenBudget: 800,
      providers: { "context7": { enabled: false } },
    };
    writeConfig(dir, cfg);
    const path = join(dir, ".engram", "config.json");
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    expect(parsed.confidenceThreshold).toBe(0.85);
    expect(parsed.totalTokenBudget).toBe(800);
    expect(parsed.providers.context7.enabled).toBe(false);
  });

  it("round-trips: write then read returns same values", () => {
    const cfg: EngramConfig = {
      confidenceThreshold: 0.9,
      totalTokenBudget: 1200,
      providers: { "mempalace": { tokenBudget: 300, timeoutMs: 2000 } },
    };
    writeConfig(dir, cfg);
    const back = readConfig(dir);
    expect(back.confidenceThreshold).toBe(0.9);
    expect(back.totalTokenBudget).toBe(1200);
    expect(back.providers.mempalace?.tokenBudget).toBe(300);
    expect(back.providers.mempalace?.timeoutMs).toBe(2000);
  });
});

// ── analyzeTuning ─────────────────────────────────────────────────

describe("analyzeTuning", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpProject();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns no changes for empty hook-log", () => {
    const proposal = analyzeTuning(dir);
    expect(proposal.changes).toHaveLength(0);
    expect(proposal.entriesAnalyzed).toBe(0);
    expect(proposal.daysSpanned).toBe(0);
  });

  it("proposes threshold increase when median confidence is high", () => {
    const now = new Date();
    const entries = Array.from({ length: 15 }, (_, i) => ({
      ts: new Date(now.getTime() - i * 60000).toISOString(),
      event: "PreToolUse",
      decision: "deny",
      confidence: 0.92,
      provider: "engram:structure",
    }));
    writeHookLog(dir, entries);

    const proposal = analyzeTuning(dir);
    expect(proposal.entriesAnalyzed).toBe(15);

    const thresholdChange = proposal.changes.find(
      (c) => c.field === "confidenceThreshold"
    );
    expect(thresholdChange).toBeDefined();
    expect(thresholdChange!.current).toBe(0.7);
    expect((thresholdChange!.proposed as number)).toBeGreaterThan(0.7);
  });

  it("does NOT propose threshold change when too few samples", () => {
    const entries = Array.from({ length: 5 }, () => ({
      ts: new Date().toISOString(),
      event: "PreToolUse",
      decision: "deny",
      confidence: 0.95,
    }));
    writeHookLog(dir, entries);

    const proposal = analyzeTuning(dir);
    const thresholdChange = proposal.changes.find(
      (c) => c.field === "confidenceThreshold"
    );
    expect(thresholdChange).toBeUndefined();
  });
});

// ── applyTuning ───────────────────────────────────────────────────

describe("applyTuning", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpProject();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes confidenceThreshold change to config", () => {
    const proposal = {
      changes: [
        {
          field: "confidenceThreshold",
          current: 0.7 as number | boolean,
          proposed: 0.85 as number | boolean,
          reason: "test",
        },
      ],
      entriesAnalyzed: 20,
      daysSpanned: 3,
    };
    applyTuning(dir, proposal);
    const cfg = readConfig(dir);
    expect(cfg.confidenceThreshold).toBe(0.85);
  });

  it("writes provider override changes to config", () => {
    const proposal = {
      changes: [
        {
          field: "providers.context7.enabled",
          current: true as number | boolean,
          proposed: false as number | boolean,
          reason: "never contributed",
        },
      ],
      entriesAnalyzed: 30,
      daysSpanned: 7,
    };
    applyTuning(dir, proposal);
    const cfg = readConfig(dir);
    expect(cfg.providers.context7?.enabled).toBe(false);
  });
});
