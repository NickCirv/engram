/**
 * Claude Code settings.json installer — pure data transforms for adding
 * and removing engram's hook entries without disturbing other hooks.
 *
 * Design:
 *   - Pure functions. No I/O, no process state. Callers handle reading
 *     and writing the settings file.
 *   - Idempotent. Running installEngramHooks twice leaves the settings
 *     in the same state after the first run.
 *   - Non-destructive. Any existing hooks (user's own, other plugins)
 *     are preserved verbatim. Only entries whose command contains
 *     "engram intercept" are added or removed.
 *   - Conservative. When in doubt, skip. A malformed hooks array is
 *     replaced with a fresh array; any non-object entries are dropped
 *     silently rather than throwing.
 */

/**
 * The four hook events engram installs into. Exposed as a readonly
 * constant so callers can introspect the install surface.
 */
export const ENGRAM_HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "SessionStart",
  "UserPromptSubmit",
  "PreCompact",
  "CwdChanged",
] as const;

export type EngramHookEvent = (typeof ENGRAM_HOOK_EVENTS)[number];

/**
 * Regex that matches the tool names handled by engram's PreToolUse
 * dispatcher. Passed as the `matcher` field so Claude Code only fires
 * the hook for these tools (avoiding Glob/WebFetch/etc. noise).
 */
export const ENGRAM_PRETOOL_MATCHER = "Read|Edit|Write|Bash";

/**
 * Default command that each hook entry invokes. Assumes `engram` is
 * in PATH (installed via `npm install -g engramx`).
 */
export const DEFAULT_ENGRAM_COMMAND = "engram intercept";

/**
 * Default per-invocation timeout in seconds. Kept short (5s) because
 * the Sentinel handlers should complete in well under 500ms each;
 * anything slower is a bug and the hook should fall through rather
 * than delaying Claude Code.
 */
export const DEFAULT_HOOK_TIMEOUT_SEC = 5;

/** A single hook command (inside a hook entry's `hooks` array). */
export interface HookCommand {
  readonly type: "command";
  readonly command: string;
  readonly timeout?: number;
}

/** A hook entry as it appears in Claude Code settings. */
export interface HookEntry {
  readonly matcher?: string;
  readonly hooks: readonly HookCommand[];
}

/** StatusLine config as it appears in Claude Code settings. */
export interface StatusLineConfig {
  readonly type: "command";
  readonly command: string;
}

/**
 * Default statusLine command. Uses `engram hud-label` which outputs
 * a JSON `{"label":"..."}` line showing saved tokens and activity.
 */
export const DEFAULT_STATUSLINE_COMMAND = "engram hud-label";

/** The shape of a Claude Code settings.json file, narrowed to hooks. */
export interface ClaudeCodeSettings {
  hooks?: {
    [event: string]: HookEntry[] | undefined;
  };
  statusLine?: StatusLineConfig;
  [key: string]: unknown;
}

/**
 * Build the four hook entries that engram installs (one per event).
 * Returned as an object keyed by event name so callers can introspect
 * which entries to add without re-inventing the shape.
 */
export function buildEngramHookEntries(
  command: string = DEFAULT_ENGRAM_COMMAND,
  timeout: number = DEFAULT_HOOK_TIMEOUT_SEC
): Record<EngramHookEvent, HookEntry> {
  const baseCmd: HookCommand = {
    type: "command",
    command,
    timeout,
  };
  return {
    PreToolUse: {
      matcher: ENGRAM_PRETOOL_MATCHER,
      hooks: [baseCmd],
    },
    PostToolUse: {
      // Match all tools — PostToolUse is an observer for any completion.
      matcher: ".*",
      hooks: [baseCmd],
    },
    SessionStart: {
      // No matcher — SessionStart has no tool name.
      hooks: [baseCmd],
    },
    UserPromptSubmit: {
      // No matcher — UserPromptSubmit has no tool name.
      hooks: [baseCmd],
    },
    PreCompact: {
      // No matcher — PreCompact has no tool name.
      hooks: [baseCmd],
    },
    CwdChanged: {
      // No matcher — CwdChanged has no tool name.
      hooks: [baseCmd],
    },
  };
}

/**
 * Check whether a hook entry is engram-owned (based on command string
 * inspection). Used to detect existing installs and target uninstalls.
 */
export function isEngramHookEntry(entry: unknown): entry is HookEntry {
  if (entry === null || typeof entry !== "object") return false;
  const e = entry as Partial<HookEntry>;
  if (!Array.isArray(e.hooks)) return false;
  for (const h of e.hooks) {
    if (h === null || typeof h !== "object") continue;
    const cmd = (h as HookCommand).command;
    if (typeof cmd === "string" && cmd.includes("engram intercept")) {
      return true;
    }
  }
  return false;
}

/**
 * Result of an install operation. `updated` is a new settings object
 * suitable for writing back to disk. `added` lists the events where
 * a new engram entry was inserted, and `alreadyPresent` lists events
 * where the install was idempotent.
 */
export interface InstallResult {
  readonly updated: ClaudeCodeSettings;
  readonly added: readonly EngramHookEvent[];
  readonly alreadyPresent: readonly EngramHookEvent[];
  /** Whether a statusLine entry was added for `engram hud-label`. */
  readonly statusLineAdded: boolean;
}

/**
 * Install engram hook entries into a settings object. Preserves all
 * non-engram hooks. Idempotent — running twice has no effect after the
 * first run.
 *
 * Input is not mutated; a new object is returned.
 */
export function installEngramHooks(
  settings: ClaudeCodeSettings,
  command: string = DEFAULT_ENGRAM_COMMAND
): InstallResult {
  const entries = buildEngramHookEntries(command);
  const added: EngramHookEvent[] = [];
  const alreadyPresent: EngramHookEvent[] = [];

  // Deep clone the hooks key to avoid mutating the caller's object.
  const hooksClone: ClaudeCodeSettings["hooks"] = {};
  const existingHooks = settings.hooks ?? {};
  for (const [key, value] of Object.entries(existingHooks)) {
    if (Array.isArray(value)) {
      hooksClone[key] = value.map((entry) => ({ ...entry }));
    }
  }

  for (const event of ENGRAM_HOOK_EVENTS) {
    const eventArr = hooksClone[event] ?? [];
    const hasEngram = eventArr.some((e) => isEngramHookEntry(e));
    if (hasEngram) {
      alreadyPresent.push(event);
      hooksClone[event] = eventArr;
      continue;
    }
    hooksClone[event] = [...eventArr, entries[event]];
    added.push(event);
  }

  // StatusLine: set `engram hud-label` only if no statusLine is configured.
  // This gives users a visible HUD out of the box without overwriting any
  // existing statusLine (e.g., claude-hud plugin or a custom command).
  const hasStatusLine =
    settings.statusLine &&
    typeof settings.statusLine === "object" &&
    typeof settings.statusLine.command === "string" &&
    settings.statusLine.command.length > 0;

  const statusLineAdded = !hasStatusLine;
  const statusLine: StatusLineConfig | undefined = hasStatusLine
    ? settings.statusLine
    : { type: "command", command: DEFAULT_STATUSLINE_COMMAND };

  return {
    updated: { ...settings, hooks: hooksClone, statusLine },
    added,
    alreadyPresent,
    statusLineAdded,
  };
}

/**
 * Result of an uninstall operation. `removed` lists events where an
 * engram entry was removed. Empty arrays and empty `hooks` object are
 * cleaned up so the settings file stays tidy.
 */
export interface UninstallResult {
  readonly updated: ClaudeCodeSettings;
  readonly removed: readonly EngramHookEvent[];
  /** Whether an engram-owned statusLine was removed. */
  readonly statusLineRemoved: boolean;
}

/**
 * Remove engram hook entries from a settings object. Preserves all
 * non-engram hooks. Cleans up empty event arrays (so `hooks.PreToolUse
 * = []` becomes `hooks.PreToolUse` deleted).
 *
 * Input is not mutated; a new object is returned.
 */
export function uninstallEngramHooks(
  settings: ClaudeCodeSettings
): UninstallResult {
  const removed: EngramHookEvent[] = [];
  const existingHooks = settings.hooks ?? {};
  const hooksClone: ClaudeCodeSettings["hooks"] = {};

  for (const [event, arr] of Object.entries(existingHooks)) {
    if (!Array.isArray(arr)) continue;
    const filtered = arr.filter((entry) => !isEngramHookEntry(entry));
    if (filtered.length !== arr.length && isKnownEngramEvent(event)) {
      removed.push(event);
    }
    if (filtered.length > 0) {
      hooksClone[event] = filtered;
    }
    // Else: drop the key entirely so empty arrays don't linger.
  }

  // Build final settings. If the hooks key is now empty, remove it entirely.
  const updatedSettings: ClaudeCodeSettings = { ...settings };
  if (Object.keys(hooksClone).length === 0) {
    delete updatedSettings.hooks;
  } else {
    updatedSettings.hooks = hooksClone;
  }

  // Remove statusLine only if it's engram-owned (contains "engram hud-label").
  const statusLineRemoved =
    typeof updatedSettings.statusLine?.command === "string" &&
    updatedSettings.statusLine.command.includes("engram hud-label");
  if (statusLineRemoved) {
    delete updatedSettings.statusLine;
  }

  return { updated: updatedSettings, removed, statusLineRemoved };
}

/**
 * Type guard for ENGRAM_HOOK_EVENTS so the uninstall bookkeeping is
 * typed correctly.
 */
function isKnownEngramEvent(event: string): event is EngramHookEvent {
  return (ENGRAM_HOOK_EVENTS as readonly string[]).includes(event);
}

/**
 * Produce a human-readable diff between two settings objects focusing
 * on what engram added or removed. Used by `install-hook --dry-run` to
 * preview changes before writing.
 */
export function formatInstallDiff(
  before: ClaudeCodeSettings,
  after: ClaudeCodeSettings
): string {
  const lines: string[] = [];
  const beforeHooks = before.hooks ?? {};
  const afterHooks = after.hooks ?? {};
  for (const event of ENGRAM_HOOK_EVENTS) {
    const beforeArr = beforeHooks[event] ?? [];
    const afterArr = afterHooks[event] ?? [];
    if (beforeArr.length === afterArr.length) continue;
    lines.push(`+ ${event}: ${beforeArr.length} → ${afterArr.length} entries`);
    // Show only engram's added entry, not the whole array.
    const added = afterArr.filter((entry) => isEngramHookEntry(entry));
    const beforeHasEngram = beforeArr.some((entry) => isEngramHookEntry(entry));
    if (!beforeHasEngram && added.length > 0) {
      for (const entry of added) {
        const matcher = entry.matcher ? ` matcher=${JSON.stringify(entry.matcher)}` : "";
        const cmds = entry.hooks.map((h) => h.command).join(", ");
        lines.push(`    + {${matcher} command="${cmds}"}`);
      }
    }
  }
  // Report statusLine changes.
  const hadStatusLine = before.statusLine?.command;
  const hasStatusLineNow = after.statusLine?.command;
  if (!hadStatusLine && hasStatusLineNow?.includes("engram hud-label")) {
    lines.push(`+ statusLine: engram hud-label (HUD enabled)`);
  } else if (hadStatusLine?.includes("engram hud-label") && !hasStatusLineNow) {
    lines.push(`- statusLine: engram hud-label (HUD removed)`);
  }

  return lines.length > 0 ? lines.join("\n") : "(no changes)";
}
