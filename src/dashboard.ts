/**
 * Live CLI dashboard — real-time view of engram's hook activity.
 *
 * Reads `.engram/hook-log.jsonl` and renders a terminal HUD that updates
 * every second. Shows:
 *   - Total reads intercepted vs passed through
 *   - Estimated tokens saved (cumulative + this session)
 *   - Hit rate percentage with visual bar
 *   - Top intercepted files
 *   - Recent activity feed
 *   - Landmine warnings triggered
 *
 * Uses ANSI escape codes + chalk for styling. No external TUI deps.
 * Designed to run alongside a Claude Code session in a split terminal.
 */
import chalk from "chalk";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { readHookLog } from "./intelligence/hook-log.js";
import {
  summarizeHookLog,
  ESTIMATED_TOKENS_PER_READ_DENY,
} from "./intercept/stats.js";
import type { HookLogEntry } from "./intelligence/hook-log.js";

const AMBER = chalk.hex("#d97706");
const DIM = chalk.dim;
const GREEN = chalk.green;
const RED = chalk.red;
const BOLD = chalk.bold;
const WHITE = chalk.white;

/** Render a horizontal bar chart (0-100%). */
function bar(pct: number, width: number = 20): string {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return AMBER("█".repeat(filled)) + DIM("░".repeat(empty));
}

/** Format number with thousands separator. */
function fmt(n: number): string {
  return n.toLocaleString();
}

/** Get top N files by interception count. */
function topFiles(
  entries: readonly HookLogEntry[],
  n: number
): Array<{ path: string; count: number }> {
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (e.event === "PreToolUse" && e.decision === "deny" && e.path) {
      counts.set(e.path, (counts.get(e.path) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([path, count]) => ({ path, count }));
}

/** Get recent activity (last N entries). */
function recentActivity(
  entries: readonly HookLogEntry[],
  n: number
): readonly HookLogEntry[] {
  return entries.slice(-n);
}

/** Format a single activity line. */
function formatActivity(entry: HookLogEntry): string {
  const tool = entry.tool ?? "?";
  const decision = entry.decision ?? "?";
  const path = entry.path
    ? entry.path.length > 40
      ? "..." + entry.path.slice(-37)
      : entry.path
    : "";

  const icon =
    decision === "deny"
      ? GREEN("✓")
      : decision === "allow"
        ? DIM("→")
        : DIM("·");

  const decLabel =
    decision === "deny"
      ? GREEN("intercepted")
      : decision === "allow"
        ? DIM("allowed")
        : DIM("passthrough");

  return `  ${icon} ${WHITE(tool.padEnd(6))} ${decLabel.padEnd(22)} ${DIM(path)}`;
}

/** Clear terminal and move cursor to top. */
function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}

/** Render the full dashboard. */
function render(projectRoot: string, entries: readonly HookLogEntry[]): void {
  const summary = summarizeHookLog(entries);
  const projectName = basename(resolve(projectRoot));

  // Compute metrics
  const totalReads =
    (summary.byDecision["deny"] ?? 0) +
    (summary.byDecision["allow"] ?? 0) +
    (summary.byDecision["passthrough"] ?? 0);
  const intercepted = summary.readDenyCount;
  const hitRate = totalReads > 0 ? (intercepted / totalReads) * 100 : 0;
  const tokensSaved = summary.estimatedTokensSaved;
  const landmines = entries.filter(
    (e) => e.event === "PreToolUse" && e.tool === "Edit" && e.decision === "allow" && e.injection
  ).length;

  clearScreen();

  // Header
  console.log(
    AMBER("  ╔══════════════════════════════════════════════════════╗")
  );
  console.log(
    AMBER("  ║") +
      WHITE(
        `  engram dashboard — ${projectName}`.padEnd(54)
      ) +
      AMBER("║")
  );
  console.log(
    AMBER("  ╚══════════════════════════════════════════════════════╝")
  );
  console.log();

  // Main metrics row
  console.log(
    `  ${AMBER("TOKENS SAVED")}    ${GREEN(BOLD(fmt(tokensSaved)))} ${DIM(`(~${fmt(intercepted)} reads × ${fmt(ESTIMATED_TOKENS_PER_READ_DENY)} tokens)`)}`
  );
  console.log();

  // Hit rate bar
  console.log(
    `  ${AMBER("HIT RATE")}        ${bar(hitRate)} ${WHITE(BOLD(hitRate.toFixed(1) + "%"))} ${DIM(`(${intercepted}/${totalReads} tool calls)`)}`
  );
  console.log();

  // Decision breakdown
  const denied = summary.byDecision["deny"] ?? 0;
  const allowed = summary.byDecision["allow"] ?? 0;
  const passthrough = summary.byDecision["passthrough"] ?? 0;
  console.log(
    `  ${AMBER("DECISIONS")}       ${GREEN("■")} intercepted ${GREEN(BOLD(String(denied)))}    ${DIM("■")} allowed ${DIM(String(allowed))}    ${DIM("■")} passthrough ${DIM(String(passthrough))}`
  );
  if (landmines > 0) {
    console.log(
      `                  ${RED("▲")} landmine warnings ${RED(BOLD(String(landmines)))}`
    );
  }
  console.log();

  // Hook events
  const events = summary.byEvent;
  const eventLine = Object.entries(events)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${DIM(k)} ${WHITE(String(v))}`)
    .join("  ");
  console.log(`  ${AMBER("EVENTS")}          ${eventLine}`);
  console.log();

  // Top intercepted files
  const top = topFiles(entries, 5);
  if (top.length > 0) {
    console.log(`  ${AMBER("TOP FILES")}       ${DIM("(most intercepted)")}`);
    for (const f of top) {
      const barLen = Math.min(
        Math.round((f.count / (top[0]?.count ?? 1)) * 15),
        15
      );
      console.log(
        `                  ${AMBER("█".repeat(barLen))} ${WHITE(String(f.count).padStart(3))}  ${DIM(f.path)}`
      );
    }
    console.log();
  }

  // Recent activity
  const recent = recentActivity(entries, 8);
  if (recent.length > 0) {
    console.log(`  ${AMBER("RECENT")}          ${DIM("(last 8 events)")}`);
    for (const e of recent) {
      console.log(formatActivity(e));
    }
    console.log();
  }

  // Footer
  console.log(
    DIM(
      `  Total invocations: ${summary.totalInvocations}` +
        (summary.firstEntry ? `  |  Since: ${summary.firstEntry}` : "") +
        `  |  Press Ctrl+C to exit`
    )
  );
}

export interface DashboardOptions {
  /** Refresh interval in ms. Default 1000. */
  readonly interval?: number;
}

/**
 * Start the live dashboard. Returns an AbortController to stop it.
 * Watches the hook log file for changes and re-renders on each tick.
 */
export function startDashboard(
  projectRoot: string,
  options: DashboardOptions = {}
): AbortController {
  const root = resolve(projectRoot);
  const interval = options.interval ?? 1000;
  const controller = new AbortController();

  let lastSize = 0;
  let cachedEntries: HookLogEntry[] = [];

  const tick = () => {
    if (controller.signal.aborted) return;

    try {
      // Re-read log only if file size changed (avoid unnecessary parsing).
      const logPath = join(root, ".engram", "hook-log.jsonl");
      if (existsSync(logPath)) {
        const currentSize = statSync(logPath).size;
        if (currentSize !== lastSize) {
          cachedEntries = readHookLog(root);
          lastSize = currentSize;
        }
      }
      render(root, cachedEntries);
    } catch {
      // Rendering errors should not crash the dashboard.
    }
  };

  // Initial render
  tick();

  // Periodic refresh
  const timer = setInterval(tick, interval);
  timer.unref();

  controller.signal.addEventListener("abort", () => {
    clearInterval(timer);
  });

  return controller;
}
