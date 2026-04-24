#!/usr/bin/env node
/**
 * preuninstall — cleans up engramx's hook entries in the user's
 * Claude Code settings BEFORE the binary is removed by npm.
 *
 * Why this file exists: without it, `npm uninstall -g engramx` leaves
 * stale hook entries in ~/.claude/settings.json pointing at a binary
 * that no longer exists. Claude Code then fires those hooks on every
 * tool call, exec fails with ENOENT, and user-visible behavior is
 * "Claude Code stopped executing anything." Reported by @freenow82 in
 * 3.0.0's post-launch window — see CHANGELOG v3.0.1.
 *
 * Contract (critical):
 *   - NEVER fail the uninstall. We always exit 0. If cleanup hits any
 *     problem, we print a one-line hint and move on. The user's goal is
 *     to uninstall; we will not be the thing that blocks them.
 *   - Self-contained: this script must work even if `engram` is not on
 *     PATH at script time (npm's script env usually has it, but we're
 *     defensive — edge cases exist).
 *   - Scoped conservatively: only touch ~/.claude/settings.json (the
 *     USER scope, which is what a global install writes to). Do not
 *     walk arbitrary project directories.
 *   - Back up before edit. Atomic rename on write.
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const SETTINGS_PATH = join(homedir(), ".claude", "settings.json");

// ── safe helpers ────────────────────────────────────────────────────

function parseJsonSafe(text) {
  try {
    return text.trim() ? JSON.parse(text) : {};
  } catch {
    return null;
  }
}

/**
 * A hook entry is "engram-owned" if its command references the engram
 * binary or any engram-related shell. We match conservatively: the
 * substring "engram" (case-insensitive) anywhere in the command string.
 * This is aggressive but safe on uninstall — if a user has a hook
 * unrelated to engramx that happens to contain the word "engram", they
 * wrote that themselves and can re-add it. On uninstall, err toward
 * cleaning more rather than leaving orphans.
 */
function isEngramHook(entry) {
  if (!entry || typeof entry !== "object") return false;
  const cmd = typeof entry.command === "string" ? entry.command : "";
  return /engram/i.test(cmd);
}

/**
 * Walk the entire hooks structure. `hooks` may be:
 *   hooks[event] = [{ matcher, hooks: [{ command, ... }, ...] }, ...]
 * We rebuild each inner `hooks` array without engram entries, drop
 * matchers whose inner array is now empty, drop event keys whose list
 * is now empty.
 */
function stripEngramHooks(settings) {
  const changes = { hooksRemoved: 0, eventsAffected: new Set() };
  if (!settings || typeof settings !== "object") return { settings, changes };
  const { hooks } = settings;
  if (!hooks || typeof hooks !== "object") return { settings, changes };

  for (const event of Object.keys(hooks)) {
    const list = Array.isArray(hooks[event]) ? hooks[event] : null;
    if (!list) continue;
    const kept = [];
    for (const matcher of list) {
      if (!matcher || typeof matcher !== "object") {
        kept.push(matcher);
        continue;
      }
      const innerHooks = Array.isArray(matcher.hooks) ? matcher.hooks : null;
      if (!innerHooks) {
        kept.push(matcher);
        continue;
      }
      const innerKept = innerHooks.filter((h) => {
        if (isEngramHook(h)) {
          changes.hooksRemoved++;
          changes.eventsAffected.add(event);
          return false;
        }
        return true;
      });
      if (innerKept.length > 0) {
        kept.push({ ...matcher, hooks: innerKept });
      } else {
        // entire matcher was engram-only — drop it
        changes.eventsAffected.add(event);
      }
    }
    if (kept.length > 0) {
      hooks[event] = kept;
    } else {
      delete hooks[event];
    }
  }

  // If hooks is now empty, drop the key entirely
  if (hooks && Object.keys(hooks).length === 0) {
    delete settings.hooks;
  }

  // Also drop engram statusLine (HUD)
  if (
    settings.statusLine &&
    typeof settings.statusLine === "object" &&
    typeof settings.statusLine.command === "string" &&
    /engram/i.test(settings.statusLine.command)
  ) {
    delete settings.statusLine;
    changes.eventsAffected.add("statusLine");
  }

  return { settings, changes };
}

// ── main ────────────────────────────────────────────────────────────

function main() {
  // If no settings file, nothing to clean. Silent exit.
  if (!existsSync(SETTINGS_PATH)) {
    return;
  }

  let raw;
  try {
    raw = readFileSync(SETTINGS_PATH, "utf-8");
  } catch {
    return; // unreadable — leave alone, user will handle
  }

  const parsed = parseJsonSafe(raw);
  if (parsed === null) {
    console.log(
      "[engramx preuninstall] skipped: could not parse " +
        SETTINGS_PATH +
        " (settings unchanged)."
    );
    return;
  }

  const { settings, changes } = stripEngramHooks(parsed);
  if (changes.hooksRemoved === 0 && changes.eventsAffected.size === 0) {
    return; // nothing to do
  }

  // Back up before any write.
  const backupPath = `${SETTINGS_PATH}.engramx-preuninstall-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}.bak`;
  try {
    copyFileSync(SETTINGS_PATH, backupPath);
  } catch {
    // if we can't back up, don't write — safety first
    console.log(
      "[engramx preuninstall] skipped: could not write backup next to " +
        SETTINGS_PATH +
        " (settings unchanged)."
    );
    return;
  }

  // Atomic write via rename.
  try {
    const tmp = `${SETTINGS_PATH}.engramx-preuninstall-tmp`;
    writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n");
    renameSync(tmp, SETTINGS_PATH);
  } catch (err) {
    console.log(
      "[engramx preuninstall] skipped: " + String(err) + " (settings unchanged)."
    );
    return;
  }

  console.log(
    `[engramx] cleaned up ${changes.hooksRemoved} hook entr${changes.hooksRemoved === 1 ? "y" : "ies"} from ${SETTINGS_PATH}`
  );
  console.log(`[engramx] backup saved: ${backupPath}`);
  console.log(
    "[engramx] if anything looks off, restore with: cp " +
      backupPath +
      " " +
      SETTINGS_PATH
  );
}

try {
  main();
} catch (err) {
  // HARD REQUIREMENT: never fail uninstall. Swallow anything.
  console.log("[engramx preuninstall] error (ignored): " + String(err));
}
process.exit(0);
