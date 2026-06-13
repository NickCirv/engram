/**
 * `engram measure --session` (Token-loop C, replay) tests.
 *
 * These cover the load-bearing honesty: session SEGMENTATION (by id vs the
 * 30-min time-gap fallback) and the per-session P-MODEL re-accounting from a
 * recorded hook-log. The P-model numbers are hand-computed in the comments so a
 * reader can verify the math, not just trust the assertion.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readReplayEvents,
  segmentSessions,
  replaySession,
  pBase,
  engramAt,
  reductionAt,
  breakEvenP,
  sessionReductionAt,
  type ReplayEvent,
} from "../../src/commands/measure-session.js";

// A minute and 31 minutes, in ms, off a fixed base epoch.
const T0 = Date.parse("2026-06-14T10:00:00.000Z");
const MIN = 60 * 1000;
const at = (mins: number): string => new Date(T0 + mins * MIN).toISOString();

function ev(partial: Partial<ReplayEvent> & { tsMin: number }): Record<string, unknown> {
  const { tsMin, ...rest } = partial;
  return { ts: at(tsMin), event: "PreToolUse", ...rest };
}

function writeLog(lines: Array<Record<string, unknown> | string>): string {
  const dir = mkdtempSync(join(tmpdir(), "engram-replay-"));
  const body = lines
    .map((l) => (typeof l === "string" ? l : JSON.stringify(l)))
    .join("\n");
  const p = join(dir, "hook-log.jsonl");
  writeFileSync(p, body + "\n");
  return p;
}

describe("readReplayEvents", () => {
  it("parses fields and sorts chronologically; skips malformed lines", () => {
    const p = writeLog([
      ev({ tsMin: 2, tool: "Read", path: "a.ts", decision: "deny", wouldHaveRead: 100, injected: 20, sessionId: "s1" }),
      "{ this is not json",
      ev({ tsMin: 0, tool: "Grep", decision: "passthrough", wouldHaveRead: 50, sessionId: "s1" }),
    ]);
    const events = readReplayEvents(p);
    expect(events).toHaveLength(2); // malformed skipped
    expect(events[0].tool).toBe("Grep"); // sorted: tsMin 0 before tsMin 2
    expect(events[1].tool).toBe("Read");
    expect(events[1].wouldHaveRead).toBe(100);
    rmSync(join(p, ".."), { recursive: true, force: true });
  });

  it("returns [] for a missing file (never throws)", () => {
    expect(readReplayEvents("/no/such/path/hook-log.jsonl")).toEqual([]);
  });

  it("resolves a project root to its .engram/ logs", () => {
    const dir = mkdtempSync(join(tmpdir(), "engram-proj-"));
    mkdirSync(join(dir, ".engram"), { recursive: true });
    writeFileSync(
      join(dir, ".engram", "hook-log.jsonl"),
      JSON.stringify(ev({ tsMin: 0, tool: "Read", path: "x.ts", decision: "deny", wouldHaveRead: 80, injected: 10 })) + "\n"
    );
    const events = readReplayEvents(dir);
    expect(events).toHaveLength(1);
    expect(events[0].path).toBe("x.ts");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("segmentSessions", () => {
  it("groups by sessionId when every event has one", () => {
    const events = readReplayEvents(
      writeLog([
        ev({ tsMin: 0, tool: "Read", path: "a", decision: "deny", wouldHaveRead: 10, sessionId: "s1" }),
        ev({ tsMin: 1, tool: "Read", path: "b", decision: "deny", wouldHaveRead: 10, sessionId: "s2" }),
        ev({ tsMin: 2, tool: "Read", path: "c", decision: "deny", wouldHaveRead: 10, sessionId: "s1" }),
      ])
    );
    const { sessions, mode } = segmentSessions(events);
    expect(mode).toBe("session-id");
    expect(sessions).toHaveLength(2);
    expect(sessions.find((s) => s.length === 2)).toBeDefined(); // s1 has 2 events
  });

  it("falls back to the 30-min time-gap heuristic when no id is present", () => {
    const events = readReplayEvents(
      writeLog([
        ev({ tsMin: 0, tool: "Read", path: "a", decision: "deny", wouldHaveRead: 10 }),
        ev({ tsMin: 5, tool: "Read", path: "b", decision: "deny", wouldHaveRead: 10 }),
        // 31-min gap → new session
        ev({ tsMin: 36, tool: "Read", path: "c", decision: "deny", wouldHaveRead: 10 }),
      ])
    );
    const { sessions, mode } = segmentSessions(events);
    expect(mode).toBe("time-gap");
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toHaveLength(2);
    expect(sessions[1]).toHaveLength(1);
  });

  it("reports mixed mode when some events have ids and some do not", () => {
    const events = readReplayEvents(
      writeLog([
        ev({ tsMin: 0, tool: "Read", path: "a", decision: "deny", wouldHaveRead: 10, sessionId: "s1" }),
        ev({ tsMin: 1, tool: "Read", path: "b", decision: "deny", wouldHaveRead: 10 }),
      ])
    );
    const { mode } = segmentSessions(events);
    expect(mode).toBe("mixed");
  });

  it("returns no sessions for an empty log", () => {
    expect(segmentSessions([]).sessions).toEqual([]);
  });
});

describe("replaySession + P-model (hand-computed)", () => {
  /**
   * Fixture session:
   *   1. Grep deny      baseline 400, packet 50   → intercepted
   *   2. Read deny      baseline 200, packet 40   → intercepted   (path p1, first)
   *   3. Read passthrough baseline 120            → passthrough    (path p2, first)
   *   4. Read deny      baseline 200, packet 40   → RE-READ of p1  → dedup bucket
   *
   * Buckets:
   *   interceptedBaseline = 400 + 200 = 600
   *   interceptedPacket   =  50 +  40 =  90
   *   passthroughBaseline = 120
   *   dedupBaseline       = 200   dedupEngram = 40   (intercepted re-read → packet)
   *
   * pBase = 120 + 600 = 720
   * engramAt(0)   = 120 + 90 + 0*600   = 210  → reduction = (720-210)/720 = 70.833%
   * engramAt(0.5) = 120 + 90 + 0.5*600 = 510  → reduction = (720-510)/720 = 29.166%
   * engramAt(1)   = 120 + 90 + 600      = 810 → reduction = (720-810)/720 = -12.5%
   * breakEvenP    = (600-90)/600 = 0.85
   * whole-session base = 720 + 200 = 920
   *   sessionReductionAt(0) = (920 - (210+40))/920 = 670/920 = 72.826%
   */
  const events: ReplayEvent[] = [
    { ts: 1, tool: "Grep", decision: "deny", wouldHaveRead: 400, injected: 50 },
    { ts: 2, tool: "Read", path: "p1", decision: "deny", wouldHaveRead: 200, injected: 40 },
    { ts: 3, tool: "Read", path: "p2", decision: "passthrough", wouldHaveRead: 120 },
    { ts: 4, tool: "Read", path: "p1", decision: "deny", wouldHaveRead: 200, injected: 40 },
  ];
  const b = replaySession(events);

  it("buckets first-occurrence vs re-read correctly", () => {
    expect(b.interceptedBaseline).toBe(600);
    expect(b.interceptedPacket).toBe(90);
    expect(b.passthroughBaseline).toBe(120);
    expect(b.dedupBaseline).toBe(200);
    expect(b.dedupEngram).toBe(40);
  });

  it("computes the P-curve to the hand-computed values", () => {
    expect(pBase(b)).toBe(720);
    expect(engramAt(b, 0)).toBe(210);
    expect(reductionAt(b, 0)).toBeCloseTo(70.833, 2);
    expect(reductionAt(b, 0.5)).toBeCloseTo(29.166, 2);
    expect(reductionAt(b, 1)).toBeCloseTo(-12.5, 2);
  });

  it("computes break-even P and the same-epoch whole-session ceiling", () => {
    expect(breakEvenP(b)).toBeCloseTo(0.85, 4);
    expect(sessionReductionAt(b, 0)).toBeCloseTo(72.826, 2);
  });
});

describe("replaySession honesty rails", () => {
  it("EXCLUDES Bash events with no command field (measure, don't infer)", () => {
    const b = replaySession([
      { ts: 1, tool: "Bash", decision: "deny", wouldHaveRead: 500, injected: 60 }, // no command
    ]);
    expect(b.bashGrepSkipped).toBe(1);
    expect(b.interceptedBaseline).toBe(0); // not counted
    expect(pBase(b)).toBe(0);
  });

  it("COUNTS Bash events when the command field is present", () => {
    const b = replaySession([
      { ts: 1, tool: "Bash", decision: "deny", wouldHaveRead: 500, injected: 60, command: "rg handleAuth" },
    ]);
    expect(b.bashGrepCounted).toBe(1);
    expect(b.bashGrepSkipped).toBe(0);
    expect(b.interceptedBaseline).toBe(500);
    expect(b.interceptedPacket).toBe(60);
  });

  it("yields 0% (not NaN) for a session with no modellable activity", () => {
    const b = replaySession([{ ts: 1, tool: "Edit", path: "x" }]);
    expect(pBase(b)).toBe(0);
    expect(reductionAt(b, 0)).toBe(0);
    expect(breakEvenP(b)).toBe(0);
    expect(sessionReductionAt(b, 0)).toBe(0);
  });

  it("ignores an intercepted event that recorded no baseline cost", () => {
    const b = replaySession([
      { ts: 1, tool: "Read", path: "a", decision: "deny", injected: 10 }, // no wouldHaveRead
    ]);
    expect(pBase(b)).toBe(0);
  });
});
