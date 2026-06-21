import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildStopSummary,
  handleStop,
} from "../../src/intercept/handlers/stop.js";
import type { HookLogEntry } from "../../src/intelligence/hook-log.js";

const readDeny = (reason?: string): HookLogEntry =>
  ({ event: "PreToolUse", tool: "Read", decision: "deny", reason }) as HookLogEntry;

describe("buildStopSummary (pure)", () => {
  it("returns null when there is no engram activity", () => {
    expect(buildStopSummary([])).toBeNull();
    expect(
      buildStopSummary([{ event: "PreToolUse", tool: "Bash", decision: "allow" } as HookLogEntry])
    ).toBeNull();
  });

  it("summarises reads + tokens with the honest 'not a bill saving' caveat", () => {
    const line = buildStopSummary([readDeny(), readDeny(), readDeny()]);
    expect(line).not.toBeNull();
    expect(line).toContain("3 file-reads answered from the graph");
    expect(line).toContain("tokens kept out of context");
    expect(line).toContain("not a bill saving");
  });

  it("uses singular grammar for a single read", () => {
    const line = buildStopSummary([readDeny()]);
    expect(line).toContain("1 file-read answered");
    expect(line).not.toContain("1 file-reads");
  });

  it("includes a mistake-warning count only when present", () => {
    const withMistake = buildStopSummary([readDeny(), readDeny("past mistake/landmine for auth.ts")]);
    expect(withMistake).toContain("past-mistake warning");
    const without = buildStopSummary([readDeny()]);
    expect(without).not.toContain("past-mistake warning");
  });
});

describe("handleStop (debounce + safety)", () => {
  let dir: string;

  const seedProject = (entries: HookLogEntry[]) => {
    mkdirSync(join(dir, ".engram"), { recursive: true });
    writeFileSync(join(dir, ".engram", "graph.db"), ""); // marks project root
    writeFileSync(
      join(dir, ".engram", "hook-log.jsonl"),
      entries.map((e) => JSON.stringify(e)).join("\n") + "\n"
    );
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "engram-stop-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("shows the summary once, then passes through for the same session", async () => {
    seedProject([readDeny(), readDeny()]);
    const first = await handleStop({ hook_event_name: "Stop", cwd: dir, session_id: "s1" });
    expect(first).not.toBeNull();
    expect((first as { systemMessage: string }).systemMessage).toContain("engram so far");
    expect(existsSync(join(dir, ".engram", ".summary-shown"))).toBe(true);

    const second = await handleStop({ hook_event_name: "Stop", cwd: dir, session_id: "s1" });
    expect(second).toBeNull(); // debounced
  });

  it("shows again for a new session", async () => {
    seedProject([readDeny()]);
    await handleStop({ hook_event_name: "Stop", cwd: dir, session_id: "s1" });
    const next = await handleStop({ hook_event_name: "Stop", cwd: dir, session_id: "s2" });
    expect(next).not.toBeNull();
    expect(readFileSync(join(dir, ".engram", ".summary-shown"), "utf-8").trim()).toBe("s2");
  });

  it("passes through with no session_id (cannot debounce → stay silent)", async () => {
    seedProject([readDeny()]);
    const r = await handleStop({ hook_event_name: "Stop", cwd: dir });
    expect(r).toBeNull();
  });

  it("passes through when there is no activity (and writes no marker)", async () => {
    seedProject([]);
    const r = await handleStop({ hook_event_name: "Stop", cwd: dir, session_id: "s1" });
    expect(r).toBeNull();
    expect(existsSync(join(dir, ".engram", ".summary-shown"))).toBe(false);
  });

  it("passes through on an invalid cwd", async () => {
    const r = await handleStop({ hook_event_name: "Stop", cwd: "/nonexistent/xyz", session_id: "s1" });
    expect(r).toBeNull();
  });
});

describe("buildStopSummary — Phase C displacement", () => {
  it("renders the displaced part when redundancy was eliminated", () => {
    const line = buildStopSummary([
      { event: "PreToolUse", tool: "Read", decision: "deny", displaced: 1500 } as HookLogEntry,
    ]);
    expect(line).toContain("redundant tokens displaced across providers");
    expect(line).toContain("structural — not a bill saving"); // honesty tag intact
  });

  it("displacement alone (no Read-denies) still surfaces a summary (not null)", () => {
    const line = buildStopSummary([
      { event: "PostToolUse", tool: "Read", displaced: 300 } as HookLogEntry,
    ]);
    expect(line).not.toBeNull();
    expect(line).toContain("displaced");
  });

  it("no activity incl. zero displaced → null", () => {
    expect(buildStopSummary([{ event: "SessionStart" } as HookLogEntry])).toBeNull();
  });
});
