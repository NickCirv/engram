/**
 * Stats tests — pure summary computation over HookLogEntry arrays.
 * No I/O, no state.
 */
import { describe, it, expect } from "vitest";
import {
  summarizeHookLog,
  formatStatsSummary,
  ESTIMATED_TOKENS_PER_READ_DENY,
} from "../../src/intercept/stats.js";
import type { HookLogEntry } from "../../src/intelligence/hook-log.js";

describe("summarizeHookLog", () => {
  it("handles empty input", () => {
    const summary = summarizeHookLog([]);
    expect(summary.totalInvocations).toBe(0);
    expect(summary.byEvent).toEqual({});
    expect(summary.byTool).toEqual({});
    expect(summary.readDenyCount).toBe(0);
    expect(summary.estimatedTokensSaved).toBe(0);
    expect(summary.firstEntry).toBe(null);
    expect(summary.lastEntry).toBe(null);
  });

  it("counts by event", () => {
    const entries: HookLogEntry[] = [
      { event: "PreToolUse", tool: "Read", decision: "deny" },
      { event: "PreToolUse", tool: "Read", decision: "passthrough" },
      { event: "PostToolUse", tool: "Edit" },
      { event: "SessionStart" },
    ];
    const summary = summarizeHookLog(entries);
    expect(summary.totalInvocations).toBe(4);
    expect(summary.byEvent.PreToolUse).toBe(2);
    expect(summary.byEvent.PostToolUse).toBe(1);
    expect(summary.byEvent.SessionStart).toBe(1);
  });

  it("counts by tool", () => {
    const entries: HookLogEntry[] = [
      { event: "PreToolUse", tool: "Read", decision: "deny" },
      { event: "PreToolUse", tool: "Read", decision: "allow" },
      { event: "PreToolUse", tool: "Edit", decision: "allow" },
    ];
    const summary = summarizeHookLog(entries);
    expect(summary.byTool.Read).toBe(2);
    expect(summary.byTool.Edit).toBe(1);
  });

  it("counts by decision", () => {
    const entries: HookLogEntry[] = [
      { event: "PreToolUse", tool: "Read", decision: "deny" },
      { event: "PreToolUse", tool: "Read", decision: "deny" },
      { event: "PreToolUse", tool: "Read", decision: "passthrough" },
      { event: "PreToolUse", tool: "Edit", decision: "allow" },
    ];
    const summary = summarizeHookLog(entries);
    expect(summary.byDecision.deny).toBe(2);
    expect(summary.byDecision.passthrough).toBe(1);
    expect(summary.byDecision.allow).toBe(1);
  });

  it("counts Read denies specifically for token savings", () => {
    const entries: HookLogEntry[] = [
      { event: "PreToolUse", tool: "Read", decision: "deny" },
      { event: "PreToolUse", tool: "Read", decision: "deny" },
      { event: "PreToolUse", tool: "Read", decision: "deny" },
      { event: "PreToolUse", tool: "Edit", decision: "deny" }, // not a Read
    ];
    const summary = summarizeHookLog(entries);
    expect(summary.readDenyCount).toBe(3);
    expect(summary.estimatedTokensSaved).toBe(
      3 * ESTIMATED_TOKENS_PER_READ_DENY
    );
  });

  it("tolerates entries with missing fields", () => {
    const entries: HookLogEntry[] = [
      { event: "PreToolUse" }, // no tool, no decision
      {} as HookLogEntry, // completely empty
      { event: "PostToolUse", tool: "Read" },
    ];
    const summary = summarizeHookLog(entries);
    expect(summary.totalInvocations).toBe(3);
    // "unknown" bucket for missing event/tool.
    expect(summary.byEvent.unknown).toBe(1);
    expect(summary.byTool.unknown).toBe(2);
  });

  it("computes first/last entry timestamps from the ts field", () => {
    const entries: HookLogEntry[] = [
      {
        event: "PreToolUse",
        ...{ ts: "2026-04-11T10:00:00Z" },
      } as HookLogEntry & { ts: string },
      {
        event: "PreToolUse",
        ...{ ts: "2026-04-11T12:30:00Z" },
      } as HookLogEntry & { ts: string },
      {
        event: "PreToolUse",
        ...{ ts: "2026-04-11T11:15:00Z" },
      } as HookLogEntry & { ts: string },
    ];
    const summary = summarizeHookLog(entries);
    expect(summary.firstEntry).toBe("2026-04-11T10:00:00Z");
    expect(summary.lastEntry).toBe("2026-04-11T12:30:00Z");
  });

  it("returned maps are frozen (no accidental mutation)", () => {
    const summary = summarizeHookLog([
      { event: "PreToolUse", tool: "Read", decision: "deny" },
    ]);
    expect(Object.isFrozen(summary.byEvent)).toBe(true);
    expect(Object.isFrozen(summary.byTool)).toBe(true);
    expect(Object.isFrozen(summary.byDecision)).toBe(true);
  });
});

describe("formatStatsSummary", () => {
  it("prints an empty-state message when log is empty", () => {
    const summary = summarizeHookLog([]);
    const text = formatStatsSummary(summary);
    expect(text).toContain("no log entries yet");
  });

  it("includes total invocation count", () => {
    const summary = summarizeHookLog([
      { event: "PreToolUse", tool: "Read", decision: "deny" },
      { event: "PostToolUse", tool: "Read" },
    ]);
    const text = formatStatsSummary(summary);
    expect(text).toContain("2 invocations");
  });

  it("includes by-event breakdown", () => {
    const summary = summarizeHookLog([
      { event: "PreToolUse", tool: "Read", decision: "deny" },
      { event: "PostToolUse", tool: "Read" },
      { event: "PreToolUse", tool: "Edit", decision: "allow" },
    ]);
    const text = formatStatsSummary(summary);
    expect(text).toContain("By event:");
    expect(text).toContain("PreToolUse");
    expect(text).toContain("PostToolUse");
  });

  it("includes token savings estimate when Read denies exist", () => {
    const summary = summarizeHookLog([
      { event: "PreToolUse", tool: "Read", decision: "deny" },
      { event: "PreToolUse", tool: "Read", decision: "deny" },
    ]);
    const text = formatStatsSummary(summary);
    expect(text).toContain("tokens saved");
    expect(text).toContain("2,400"); // 2 × 1200
  });

  it("shows zero savings message when no Read denies", () => {
    const summary = summarizeHookLog([
      { event: "PostToolUse", tool: "Edit" },
    ]);
    const text = formatStatsSummary(summary);
    expect(text).toContain("0");
    expect(text).toContain("no PreToolUse:Read denies");
  });
});
