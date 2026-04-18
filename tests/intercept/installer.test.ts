/**
 * Installer tests — pure function coverage for the settings.json
 * install/uninstall logic. No I/O.
 *
 * Critical invariants:
 *   - Idempotent (running install twice leaves settings unchanged after
 *     the first run)
 *   - Non-destructive (existing non-engram hooks are preserved)
 *   - Surgical uninstall (removes only entries whose command contains
 *     "engram intercept")
 */
import { describe, it, expect } from "vitest";
import {
  installEngramHooks,
  uninstallEngramHooks,
  buildEngramHookEntries,
  buildReindexHookEntry,
  isEngramHookEntry,
  formatInstallDiff,
  ENGRAM_HOOK_EVENTS,
  ENGRAM_PRETOOL_MATCHER,
  ENGRAM_REINDEX_HOOK_MATCHER,
  DEFAULT_ENGRAM_COMMAND,
  DEFAULT_ENGRAM_REINDEX_HOOK_COMMAND,
  DEFAULT_STATUSLINE_COMMAND,
  type ClaudeCodeSettings,
  type HookEntry,
} from "../../src/intercept/installer.js";

describe("buildEngramHookEntries", () => {
  it("produces one entry per supported event", () => {
    const entries = buildEngramHookEntries();
    expect(Object.keys(entries).sort()).toEqual(
      [...ENGRAM_HOOK_EVENTS].sort()
    );
  });

  it("uses the default command when none provided", () => {
    const entries = buildEngramHookEntries();
    for (const event of ENGRAM_HOOK_EVENTS) {
      expect(entries[event].hooks[0].command).toBe(DEFAULT_ENGRAM_COMMAND);
    }
  });

  it("respects a custom command argument", () => {
    const entries = buildEngramHookEntries("/custom/engram intercept");
    expect(entries.PreToolUse.hooks[0].command).toBe(
      "/custom/engram intercept"
    );
  });

  it("PreToolUse entry has regex matcher for Read|Edit|Write|Bash", () => {
    const entries = buildEngramHookEntries();
    expect(entries.PreToolUse.matcher).toBe(ENGRAM_PRETOOL_MATCHER);
  });

  it("SessionStart and UserPromptSubmit have no matcher", () => {
    const entries = buildEngramHookEntries();
    expect(entries.SessionStart.matcher).toBeUndefined();
    expect(entries.UserPromptSubmit.matcher).toBeUndefined();
  });

  it("all entries have type=command and a timeout", () => {
    const entries = buildEngramHookEntries();
    for (const event of ENGRAM_HOOK_EVENTS) {
      const cmd = entries[event].hooks[0];
      expect(cmd.type).toBe("command");
      expect(cmd.timeout).toBeGreaterThan(0);
    }
  });
});

describe("buildReindexHookEntry (#8 auto-reindex)", () => {
  it("builds a PostToolUse entry with matcher 'Edit|Write|MultiEdit' and command 'engram reindex-hook'", () => {
    const entry = buildReindexHookEntry();
    expect(entry.matcher).toBe(ENGRAM_REINDEX_HOOK_MATCHER);
    expect(entry.matcher).toBe("Edit|Write|MultiEdit");
    expect(entry.hooks.length).toBe(1);
    expect(entry.hooks[0].type).toBe("command");
    expect(entry.hooks[0].command).toBe(DEFAULT_ENGRAM_REINDEX_HOOK_COMMAND);
    expect(entry.hooks[0].command).toBe("engram reindex-hook");
    expect(entry.hooks[0].timeout).toBeGreaterThan(0);
  });

  it("is recognized by isEngramHookEntry (so uninstall removes it)", () => {
    expect(isEngramHookEntry(buildReindexHookEntry())).toBe(true);
  });
});

describe("isEngramHookEntry", () => {
  it("detects entries whose command contains 'engram intercept'", () => {
    const entry: HookEntry = {
      matcher: "Read",
      hooks: [{ type: "command", command: "engram intercept" }],
    };
    expect(isEngramHookEntry(entry)).toBe(true);
  });

  it("detects entries with full path to engram", () => {
    const entry: HookEntry = {
      matcher: "Read",
      hooks: [
        { type: "command", command: "/usr/local/bin/engram intercept --foo" },
      ],
    };
    expect(isEngramHookEntry(entry)).toBe(true);
  });

  it("detects the optional auto-reindex entry ('engram reindex-hook') so uninstall cleans it up (#8)", () => {
    const entry: HookEntry = {
      matcher: "Edit|Write|MultiEdit",
      hooks: [{ type: "command", command: "engram reindex-hook" }],
    };
    expect(isEngramHookEntry(entry)).toBe(true);
  });

  it("does NOT match other hooks", () => {
    const entry: HookEntry = {
      matcher: "Bash",
      hooks: [
        { type: "command", command: "node ~/.claude/hooks/pre-commit-scan.js" },
      ],
    };
    expect(isEngramHookEntry(entry)).toBe(false);
  });

  it("returns false for non-object inputs", () => {
    expect(isEngramHookEntry(null)).toBe(false);
    expect(isEngramHookEntry("string")).toBe(false);
    expect(isEngramHookEntry(42)).toBe(false);
  });

  it("returns false when hooks field is missing or not an array", () => {
    expect(isEngramHookEntry({ matcher: "Read" })).toBe(false);
    expect(isEngramHookEntry({ hooks: "not-an-array" })).toBe(false);
  });
});

describe("installEngramHooks", () => {
  it("adds entries for all 4 events on an empty settings object", () => {
    const result = installEngramHooks({});
    expect(result.added.length).toBe(ENGRAM_HOOK_EVENTS.length);
    expect(result.alreadyPresent.length).toBe(0);
    expect(result.updated.hooks).toBeDefined();
    for (const event of ENGRAM_HOOK_EVENTS) {
      const arr = result.updated.hooks![event]!;
      expect(arr.length).toBe(1);
      expect(isEngramHookEntry(arr[0])).toBe(true);
    }
  });

  it("is idempotent — second install produces no changes", () => {
    const first = installEngramHooks({});
    const second = installEngramHooks(first.updated);
    expect(second.added.length).toBe(0);
    expect(second.alreadyPresent.length).toBe(ENGRAM_HOOK_EVENTS.length);
    // Deep equality on the final settings object.
    expect(JSON.stringify(second.updated)).toBe(JSON.stringify(first.updated));
  });

  it("preserves existing non-engram PreToolUse hooks", () => {
    const existing: ClaudeCodeSettings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              {
                type: "command",
                command: "node ~/.claude/hooks/pre-commit-scan.js",
              },
            ],
          },
        ],
      },
    };
    const result = installEngramHooks(existing);
    const arr = result.updated.hooks!.PreToolUse!;
    expect(arr.length).toBe(2); // original + engram
    // First entry should be the original Bash hook.
    expect(arr[0].matcher).toBe("Bash");
    expect(arr[0].hooks[0].command).toContain("pre-commit-scan");
    // Second entry should be engram's.
    expect(arr[1].matcher).toBe(ENGRAM_PRETOOL_MATCHER);
    expect(isEngramHookEntry(arr[1])).toBe(true);
  });

  it("does not mutate the input settings object", () => {
    const existing: ClaudeCodeSettings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "other-hook" }],
          },
        ],
      },
    };
    const snapshot = JSON.stringify(existing);
    installEngramHooks(existing);
    expect(JSON.stringify(existing)).toBe(snapshot);
  });

  it("preserves unrelated top-level keys", () => {
    const existing: ClaudeCodeSettings = {
      hooks: {},
      enabledPlugins: ["foo", "bar"],
      permissions: { foo: true },
    };
    const result = installEngramHooks(existing);
    expect(result.updated.enabledPlugins).toEqual(["foo", "bar"]);
    expect(result.updated.permissions).toEqual({ foo: true });
  });

  describe("autoReindex option (#8)", () => {
    it("adds a second PostToolUse entry (Edit|Write|MultiEdit → engram reindex-hook) when enabled", () => {
      const result = installEngramHooks({}, DEFAULT_ENGRAM_COMMAND, {
        autoReindex: true,
      });
      const postTool = result.updated.hooks!.PostToolUse!;
      expect(postTool.length).toBe(2);
      // Original observer entry.
      expect(postTool[0].hooks[0].command).toBe("engram intercept");
      // New reindex-hook entry.
      expect(postTool[1].matcher).toBe("Edit|Write|MultiEdit");
      expect(postTool[1].hooks[0].command).toBe("engram reindex-hook");
      expect(result.autoReindexAdded).toBe(true);
    });

    it("does NOT add the reindex-hook entry by default (off for existing users)", () => {
      const result = installEngramHooks({});
      const postTool = result.updated.hooks!.PostToolUse!;
      expect(postTool.length).toBe(1);
      expect(postTool[0].hooks[0].command).toBe("engram intercept");
      expect(result.autoReindexAdded).toBe(false);
    });

    it("is idempotent — second install with autoReindex=true leaves settings unchanged", () => {
      const first = installEngramHooks({}, DEFAULT_ENGRAM_COMMAND, {
        autoReindex: true,
      });
      const second = installEngramHooks(first.updated, DEFAULT_ENGRAM_COMMAND, {
        autoReindex: true,
      });
      expect(second.autoReindexAdded).toBe(false);
      expect(JSON.stringify(second.updated)).toBe(JSON.stringify(first.updated));
    });

    it("adds reindex-hook onto an existing PostToolUse that already has the intercept entry", () => {
      const base = installEngramHooks({}).updated; // intercept-only
      const result = installEngramHooks(base, DEFAULT_ENGRAM_COMMAND, {
        autoReindex: true,
      });
      const postTool = result.updated.hooks!.PostToolUse!;
      expect(postTool.length).toBe(2);
      expect(postTool.some((e) => e.hooks[0].command === "engram reindex-hook")).toBe(
        true
      );
      expect(result.autoReindexAdded).toBe(true);
    });

    it("uninstall strips the reindex-hook entry too", () => {
      const installed = installEngramHooks({}, DEFAULT_ENGRAM_COMMAND, {
        autoReindex: true,
      }).updated;
      const result = uninstallEngramHooks(installed);
      // PostToolUse must be gone entirely — no engram-owned entries remain.
      expect(result.updated.hooks?.PostToolUse).toBeUndefined();
      expect(result.removed).toContain("PostToolUse");
    });

    it("uninstall preserves non-engram PostToolUse hooks when auto-reindex was installed", () => {
      const withOther: ClaudeCodeSettings = {
        hooks: {
          PostToolUse: [
            {
              matcher: "Bash",
              hooks: [{ type: "command", command: "other-post-hook" }],
            },
          ],
        },
      };
      const installed = installEngramHooks(withOther, DEFAULT_ENGRAM_COMMAND, {
        autoReindex: true,
      }).updated;
      const result = uninstallEngramHooks(installed);
      const postTool = result.updated.hooks?.PostToolUse;
      expect(postTool).toBeDefined();
      expect(postTool!.length).toBe(1);
      expect(postTool![0].hooks[0].command).toBe("other-post-hook");
    });
  });

  it("detects partial installs (some events present, others not)", () => {
    // Simulate a broken state where only PreToolUse has engram's entry.
    const partial: ClaudeCodeSettings = {
      hooks: {
        PreToolUse: [
          {
            matcher: ENGRAM_PRETOOL_MATCHER,
            hooks: [{ type: "command", command: "engram intercept" }],
          },
        ],
      },
    };
    const result = installEngramHooks(partial);
    expect(result.alreadyPresent).toContain("PreToolUse");
    expect(result.added).toContain("SessionStart");
    expect(result.added).toContain("UserPromptSubmit");
    expect(result.added).toContain("PostToolUse");
  });
});

describe("uninstallEngramHooks", () => {
  it("removes all engram entries, preserves everything else", () => {
    const settings = installEngramHooks({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "other-bash-hook" }],
          },
        ],
      },
    }).updated;

    const result = uninstallEngramHooks(settings);
    expect(result.removed.length).toBeGreaterThan(0);

    // PreToolUse should still have the Bash hook.
    const preTool = result.updated.hooks?.PreToolUse;
    expect(preTool).toBeDefined();
    expect(preTool!.length).toBe(1);
    expect(preTool![0].matcher).toBe("Bash");

    // SessionStart, UserPromptSubmit, PostToolUse should be gone
    // entirely (no non-engram entries to preserve).
    expect(result.updated.hooks?.SessionStart).toBeUndefined();
    expect(result.updated.hooks?.UserPromptSubmit).toBeUndefined();
    expect(result.updated.hooks?.PostToolUse).toBeUndefined();
  });

  it("drops the 'hooks' key entirely when all events become empty", () => {
    const settings = installEngramHooks({}).updated;
    const result = uninstallEngramHooks(settings);
    expect(result.updated.hooks).toBeUndefined();
  });

  it("is a no-op when no engram entries exist", () => {
    const existing: ClaudeCodeSettings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "other-hook" }],
          },
        ],
      },
    };
    const result = uninstallEngramHooks(existing);
    expect(result.removed.length).toBe(0);
    // Structure should be preserved.
    expect(result.updated.hooks?.PreToolUse).toBeDefined();
    expect(result.updated.hooks!.PreToolUse!.length).toBe(1);
  });

  it("handles empty settings object", () => {
    const result = uninstallEngramHooks({});
    expect(result.removed.length).toBe(0);
    expect(result.updated.hooks).toBeUndefined();
  });

  it("does not mutate the input", () => {
    const settings = installEngramHooks({}).updated;
    const snapshot = JSON.stringify(settings);
    uninstallEngramHooks(settings);
    expect(JSON.stringify(settings)).toBe(snapshot);
  });
});

describe("formatInstallDiff", () => {
  it("shows each added engram entry with matcher and command", () => {
    const before: ClaudeCodeSettings = {};
    const { updated: after } = installEngramHooks(before);
    const diff = formatInstallDiff(before, after);
    expect(diff).toContain("PreToolUse");
    expect(diff).toContain("engram intercept");
  });

  it("returns '(no changes)' when before == after", () => {
    const settings = installEngramHooks({}).updated;
    const diff = formatInstallDiff(settings, settings);
    expect(diff).toBe("(no changes)");
  });

  it("shows the auto-reindex entry when --auto-reindex is used (#8)", () => {
    const before: ClaudeCodeSettings = {};
    const { updated: after } = installEngramHooks(
      before,
      DEFAULT_ENGRAM_COMMAND,
      { autoReindex: true }
    );
    const diff = formatInstallDiff(before, after);
    expect(diff).toContain("PostToolUse");
    expect(diff).toContain("engram reindex-hook");
    expect(diff).toContain("Edit|Write|MultiEdit");
  });

  it("shows statusLine addition in diff", () => {
    const before: ClaudeCodeSettings = {};
    const { updated: after } = installEngramHooks(before);
    const diff = formatInstallDiff(before, after);
    expect(diff).toContain("statusLine");
    expect(diff).toContain("HUD enabled");
  });
});

describe("statusLine", () => {
  it("adds engram hud-label statusLine on fresh install", () => {
    const result = installEngramHooks({});
    expect(result.statusLineAdded).toBe(true);
    expect(result.updated.statusLine).toEqual({
      type: "command",
      command: DEFAULT_STATUSLINE_COMMAND,
    });
  });

  it("does NOT overwrite existing statusLine", () => {
    const existing: ClaudeCodeSettings = {
      statusLine: {
        type: "command",
        command: "bash -c 'my-custom-hud'",
      },
    };
    const result = installEngramHooks(existing);
    expect(result.statusLineAdded).toBe(false);
    expect(result.updated.statusLine!.command).toBe("bash -c 'my-custom-hud'");
  });

  it("does NOT overwrite statusLine that already includes engram", () => {
    const existing: ClaudeCodeSettings = {
      statusLine: {
        type: "command",
        command: 'bash -c \'bun "$(ls -td ...)" --extra-cmd="engram hud-label"\'',
      },
    };
    const result = installEngramHooks(existing);
    expect(result.statusLineAdded).toBe(false);
    expect(result.updated.statusLine!.command).toContain("extra-cmd");
  });

  it("is idempotent — second install keeps the same statusLine", () => {
    const first = installEngramHooks({});
    const second = installEngramHooks(first.updated);
    expect(second.statusLineAdded).toBe(false);
    expect(second.updated.statusLine).toEqual(first.updated.statusLine);
  });

  it("uninstall removes engram-owned statusLine", () => {
    const installed = installEngramHooks({}).updated;
    const result = uninstallEngramHooks(installed);
    expect(result.statusLineRemoved).toBe(true);
    expect(result.updated.statusLine).toBeUndefined();
  });

  it("uninstall preserves non-engram statusLine", () => {
    const settings: ClaudeCodeSettings = {
      ...installEngramHooks({}).updated,
      statusLine: {
        type: "command",
        command: "bash -c 'my-custom-hud'",
      },
    };
    const result = uninstallEngramHooks(settings);
    expect(result.statusLineRemoved).toBe(false);
    expect(result.updated.statusLine!.command).toBe("bash -c 'my-custom-hud'");
  });
});
