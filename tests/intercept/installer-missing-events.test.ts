/**
 * missingHookEvents (#90) — surfaces ENGRAM_HOOK_EVENTS the running version
 * supports but the user's settings.json hasn't registered, so an upgrade that
 * adds a new event (v4.3's SubagentStart) doesn't silently miss the new feature.
 */
import { describe, it, expect } from "vitest";
import { missingHookEvents, ENGRAM_HOOK_EVENTS } from "../../src/intercept/installer.js";

const wired = (events: readonly string[]) => ({
  hooks: Object.fromEntries(
    events.map((e) => [e, [{ hooks: [{ type: "command", command: "engram intercept" }] }]])
  ),
});

describe("missingHookEvents", () => {
  it("reports every event missing when none are registered", () => {
    expect(missingHookEvents({}).slice().sort()).toEqual([...ENGRAM_HOOK_EVENTS].sort());
    expect(missingHookEvents({ hooks: {} }).length).toBe(ENGRAM_HOOK_EVENTS.length);
  });

  it("reports the gap when only some events are registered (the v4.2 → v4.3 case)", () => {
    const missing = missingHookEvents(wired(["PreToolUse", "PostToolUse"]));
    expect(missing).toContain("SubagentStart");
    expect(missing).not.toContain("PreToolUse");
    expect(missing.length).toBe(ENGRAM_HOOK_EVENTS.length - 2);
  });

  it("reports zero missing when every event is wired", () => {
    expect(missingHookEvents(wired([...ENGRAM_HOOK_EVENTS]))).toEqual([]);
  });

  it("only counts the engram entry — a foreign hook on an event still counts as missing", () => {
    const settings = {
      hooks: { SubagentStart: [{ hooks: [{ type: "command", command: "other-tool" }] }] },
    };
    expect(missingHookEvents(settings)).toContain("SubagentStart");
  });

  it("never throws on a malformed, hand-edited settings.json (BUG-4)", () => {
    // The doctor wraps this in try/catch, but a throw there silently drops the
    // missing-event warning — so the function itself must tolerate junk.
    expect(() => missingHookEvents({ hooks: { PreToolUse: [null] } as never })).not.toThrow();
    expect(missingHookEvents({ hooks: { PreToolUse: [null] } as never })).toContain("PreToolUse");
    expect(() => missingHookEvents(null as never)).not.toThrow();
    expect(missingHookEvents(null as never).length).toBe(ENGRAM_HOOK_EVENTS.length);
    expect(() => missingHookEvents({ hooks: { PreToolUse: "nope" } as never })).not.toThrow();
  });
});
