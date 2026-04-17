/**
 * Component status checker — fast health probes for HUD display.
 *
 * Each check MUST complete in <5ms (use cached files, not live connections).
 * Results are cached in `.engram/component-status.json` and refreshed by
 * `engram server --http` on startup or via explicit `refreshComponentStatus()`.
 *
 * The HUD label uses these to show: HTTP ✓ | LSP ✓ | AST ✓ | N IDEs
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";

/** Status of an individual component. */
export interface ComponentHealth {
  readonly name: string;
  readonly available: boolean;
  readonly checkedAt: number; // Unix ms
}

/** Full status of all components. */
export interface ComponentStatusReport {
  readonly components: readonly ComponentHealth[];
  readonly ideCount: number;
  readonly generatedAt: number;
}

/** Cache file path inside the project's .engram directory. */
function statusPath(projectRoot: string): string {
  return join(projectRoot, ".engram", "component-status.json");
}

/** Read cached status. Returns null if no cache or expired (>30s). */
export function readCachedStatus(
  projectRoot: string
): ComponentStatusReport | null {
  const path = statusPath(projectRoot);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as ComponentStatusReport;
    // Expire after 30 seconds — HUD calls this every ~5s
    if (Date.now() - raw.generatedAt > 30_000) return null;
    return raw;
  } catch {
    return null;
  }
}

/**
 * Check HTTP server availability by looking for the PID/lock file
 * that `engram server --http` writes on startup. No network call.
 */
function checkHttp(projectRoot: string): boolean {
  // Future: engram server --http writes .engram/http-server.pid
  return existsSync(join(projectRoot, ".engram", "http-server.pid"));
}

/**
 * Check LSP availability.
 * Checks two signals (no network call — file existence only):
 *   1. `.engram/lsp-available` flag file written by the lsp provider when
 *      it successfully connects to a socket.
 *   2. Common tsserver / typescript-language-server socket paths in /tmp
 *      as a fallback for environments where the flag file hasn't been
 *      written yet (e.g. first session).
 */
function checkLsp(projectRoot: string): boolean {
  // Primary: flag file written by lsp provider on successful connection
  if (existsSync(join(projectRoot, ".engram", "lsp-available"))) return true;

  // Fallback: well-known socket paths (use tmpdir() for cross-platform)
  const tmp = tmpdir();
  const candidates = [
    join(tmp, "tsserver.sock"),
    join(tmp, "typescript-language-server.sock"),
  ];
  return candidates.some((c) => existsSync(c));
}

/**
 * Check AST (tree-sitter) availability by looking for grammar files.
 * These are bundled at install time.
 */
function checkAst(projectRoot: string): boolean {
  // Future: grammars/ directory with WASM files
  const grammarsDir = join(projectRoot, "node_modules", "web-tree-sitter");
  return existsSync(grammarsDir);
}

/**
 * Count active IDE adapter configurations.
 * Check for: .cursor/rules/engram-context.mdc, .continue config, zed config
 */
function countIdeAdapters(projectRoot: string): number {
  let count = 0;
  // Cursor MDC
  if (existsSync(join(projectRoot, ".cursor", "rules", "engram-context.mdc"))) {
    count += 1;
  }
  // Continue.dev — check if engram is in continue config
  const continueConfig = join(homedir(), ".continue", "config.json");
  if (existsSync(continueConfig)) {
    try {
      const cfg = readFileSync(continueConfig, "utf-8");
      if (cfg.includes("engram")) count += 1;
    } catch {
      // Ignore read errors
    }
  }
  // Zed context server
  const zedSettings = join(homedir(), ".config", "zed", "settings.json");
  if (existsSync(zedSettings)) {
    try {
      const cfg = readFileSync(zedSettings, "utf-8");
      if (cfg.includes("engram")) count += 1;
    } catch {
      // Ignore read errors
    }
  }
  // Claude Code hooks (always counted if .engram exists)
  const claudeSettings = join(projectRoot, ".claude", "settings.local.json");
  if (existsSync(claudeSettings)) {
    try {
      const cfg = readFileSync(claudeSettings, "utf-8");
      if (cfg.includes("engram")) count += 1;
    } catch {
      // Ignore
    }
  }
  return count;
}

/**
 * Run all component health checks and cache the result.
 * Each individual check is <5ms (file existence only, no I/O).
 */
export function refreshComponentStatus(
  projectRoot: string
): ComponentStatusReport {
  const now = Date.now();
  const components: ComponentHealth[] = [
    { name: "http", available: checkHttp(projectRoot), checkedAt: now },
    { name: "lsp", available: checkLsp(projectRoot), checkedAt: now },
    { name: "ast", available: checkAst(projectRoot), checkedAt: now },
  ];
  const ideCount = countIdeAdapters(projectRoot);

  const report: ComponentStatusReport = {
    components,
    ideCount,
    generatedAt: now,
  };

  // Write cache (best-effort — don't fail HUD on write error)
  try {
    writeFileSync(statusPath(projectRoot), JSON.stringify(report), "utf-8");
  } catch {
    // Ignore write errors
  }

  return report;
}

/**
 * Get component status — cached if fresh, otherwise refresh.
 * Total time: <5ms from cache, <15ms on refresh.
 */
export function getComponentStatus(
  projectRoot: string
): ComponentStatusReport {
  const cached = readCachedStatus(projectRoot);
  if (cached) return cached;
  return refreshComponentStatus(projectRoot);
}

/**
 * Format component status for HUD display.
 * Returns a string like: "HTTP ✓ | LSP ✗ | AST ✓ | 2 IDEs"
 */
export function formatHudStatus(report: ComponentStatusReport): string {
  const parts: string[] = [];

  for (const c of report.components) {
    const icon = c.available ? "✓" : "✗";
    parts.push(`${c.name.toUpperCase()} ${icon}`);
  }

  if (report.ideCount > 0) {
    parts.push(`${report.ideCount} IDE${report.ideCount > 1 ? "s" : ""}`);
  }

  return parts.join(" | ");
}
