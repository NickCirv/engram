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
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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
 *
 * Pure file-existence check — mirrors the socket candidates used by
 * `src/providers/lsp-connection.ts::candidateSockets()`. No network,
 * no actual socket connect.
 *
 * Also honors `.engram/lsp-available` as an explicit opt-in marker
 * for environments where the socket layout differs from the defaults
 * (e.g. custom editors, user scripts).
 *
 * Fixes issue #11 partial: the previous implementation relied on only
 * two socket paths (`tsserver.sock` + `typescript-language-server.sock`)
 * AND a `lsp-available` flag file that no code path actually writes,
 * so `checkLsp` reported false even in working LSP environments.
 */
function checkLsp(projectRoot: string): boolean {
  // Explicit user opt-in via marker file (preserved for compat).
  if (existsSync(join(projectRoot, ".engram", "lsp-available"))) return true;

  // Socket candidates — must match lsp-connection.ts::candidateSockets().
  // Keep this list in sync with that file; see issue #11.
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const tmp = tmpdir();
  const candidates = [
    join(tmp, `tsserver-${uid}.sock`),
    join(tmp, "lsp-server.sock"),
    join(tmp, "typescript-language-server.sock"),
    join(tmp, `pyright-${uid}.sock`),
    join(tmp, "rust-analyzer.sock"),
    // Legacy name kept for back-compat with older tsserver installs.
    join(tmp, "tsserver.sock"),
  ];
  return candidates.some((c) => existsSync(c));
}

/**
 * Check AST (tree-sitter) availability by looking for bundled grammar
 * WASM files. In v2.0+ these ship at `dist/grammars/*.wasm` from the
 * engram install itself, regardless of the user's project layout.
 *
 * Fixes issue #11: when esbuild/tsup flattens the bundle, chunks land
 * at `engramx/dist/chunk-*.js` so `here = engramx/dist`. The previous
 * candidates (`../grammars` and `../../dist/grammars`) resolve outside
 * the package and miss the actual grammar dir. Adding `join(here,
 * "grammars")` as the first candidate handles this case without
 * breaking the dev-time layout (where `here = src/intercept` and the
 * third candidate still resolves).
 *
 * Candidate search order:
 *   1. `here/grammars/`          — flattened bundle (engramx/dist/chunk-*.js)
 *   2. `here/../grammars/`       — nested bundle (dist/intercept/)
 *   3. `here/../../dist/grammars/` — dev-time (src/intercept/)
 *   4. `projectRoot/node_modules/web-tree-sitter` — local npm install
 */
function checkAst(projectRoot: string): boolean {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      join(here, "grammars"),                       // flattened bundle
      join(here, "..", "grammars"),                 // nested bundle
      join(here, "..", "..", "dist", "grammars"),   // dev-time
    ];
    for (const dir of candidates) {
      if (existsSync(dir)) return true;
    }
  } catch {
    // fallthrough
  }

  // Fallback: node_modules in the user's project
  if (existsSync(join(projectRoot, "node_modules", "web-tree-sitter"))) return true;

  return false;
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
  // Claude Code hooks (settings.local.json or settings.json)
  for (const f of ["settings.local.json", "settings.json"]) {
    const claudeSettings = join(projectRoot, ".claude", f);
    if (existsSync(claudeSettings)) {
      try {
        const cfg = readFileSync(claudeSettings, "utf-8");
        if (cfg.includes("engram")) {
          count += 1;
          break; // count Claude Code once, not twice
        }
      } catch {
        // Ignore
      }
    }
  }
  // Windsurf rules
  if (existsSync(join(projectRoot, ".windsurfrules"))) count += 1;
  // Aider context file
  if (existsSync(join(projectRoot, ".aider-context.md"))) count += 1;
  // CCS index
  if (existsSync(join(projectRoot, ".context", "index.md"))) count += 1;
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
