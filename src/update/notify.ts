/**
 * Passive update notifier — prints a one-line "new version available"
 * hint on any `engram *` invocation if the cached check says there's
 * something newer.
 *
 * Throttled at the cache level (see ./check.ts) — this module just
 * decides whether to print and how. The decision is pure (no network
 * call), so it's safe to invoke unconditionally on every CLI entry.
 *
 * Prints AT MOST ONCE per invocation. Never prints in:
 *   - CI (`$CI` set)
 *   - Opt-out (`ENGRAM_NO_UPDATE_CHECK=1`)
 *   - `--json` / `--quiet` modes (caller-responsibility to gate)
 *   - Hook intercept (`engram intercept` — stdout is reserved for JSON)
 *   - When no cached check exists yet (silent until first background check)
 */
import chalk from "chalk";
import { cachePath, isNewer, optedOut } from "./check.js";
import { existsSync, readFileSync } from "node:fs";

let printedThisProcess = false;

/**
 * Print the passive update hint if conditions are met. Safe to call many
 * times per process — only one line is ever emitted.
 *
 * Returns the hint string if one was printed, or null otherwise. Tests
 * use the return value; production callers can ignore it.
 */
export function maybePrintUpdateHint(currentVersion: string): string | null {
  if (printedThisProcess) return null;
  if (optedOut()) return null;

  const path = cachePath();
  if (!existsSync(path)) return null;

  let latest: string | null = null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as {
      latest?: unknown;
    };
    if (typeof parsed?.latest === "string") latest = parsed.latest;
  } catch {
    return null;
  }

  if (!latest) return null;
  if (!isNewer(latest, currentVersion)) return null;

  const hint =
    chalk.dim("💡 ") +
    chalk.yellow(`engram v${latest}`) +
    chalk.dim(" is available — run ") +
    chalk.white("engram update") +
    chalk.dim(` (you're on v${currentVersion})`);

  // Write to stderr so we never contaminate stdout (stdout may be piped
  // to jq, or captured by the `intercept` subcommand as protocol data).
  process.stderr.write(hint + "\n");
  printedThisProcess = true;
  return hint;
}

/** Used by tests to reset the once-per-process gate. */
export function _resetPrintedFlag(): void {
  printedThisProcess = false;
}
