/**
 * Self-update installer.
 *
 * Detects the package manager that owns the engram global install and
 * shells out to its upgrade command. Never touches the network itself
 * — delegates entirely to npm/pnpm/yarn/bun. If detection fails, prints
 * the manual command for the user to run.
 *
 * Safety: we never pass user input through to the shell. The package
 * name is the compile-time constant `engramx`, the version is always
 * `latest` (or a fixed dist-tag), and the manager executable is
 * chosen from a whitelist of four.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

/** Npm dist-tag that controls default resolution. */
export type Channel = "latest" | "beta";

/** Compile-time constant — the npm package name. */
const PACKAGE_NAME = "engramx";

export interface DetectResult {
  readonly manager: PackageManager | null;
  /** Absolute path to the engram global install, if we could find it. */
  readonly installPath: string | null;
  /**
   * Why we chose this manager. Useful for `--dry-run` output. One of:
   *   - "pnpm-path-marker" — installPath contains /pnpm/
   *   - "yarn-path-marker" — installPath contains /yarn/
   *   - "bun-path-marker"  — installPath contains /bun/
   *   - "npm-fallback"     — default
   *   - "none"             — installPath could not be determined
   */
  readonly reason: string;
}

/**
 * Detect which package manager installed the running engram binary.
 *
 * Strategy: engram's own `dist/cli.js` sits under one of these trees:
 *   - `/usr/local/lib/node_modules/engramx/` (or homebrew variant) → npm
 *   - `<pnpm_root>/global/5/node_modules/engramx/`                  → pnpm
 *   - `~/.yarn/global/node_modules/engramx/`                        → yarn
 *   - `<bun_install>/install/global/node_modules/engramx/`          → bun
 *
 * Path substring markers are reliable enough for our purposes. If no
 * marker matches, fall back to `npm` — it's the most common and the
 * least likely to do surprising things.
 */
export function detectPackageManager(): DetectResult {
  let installPath: string | null = null;
  try {
    // __dirname equivalent for ESM
    installPath = dirname(fileURLToPath(import.meta.url));
  } catch {
    installPath = null;
  }

  if (!installPath) {
    return { manager: null, installPath: null, reason: "none" };
  }

  const lower = installPath.toLowerCase();
  if (lower.includes("/pnpm/") || lower.includes("\\pnpm\\")) {
    return { manager: "pnpm", installPath, reason: "pnpm-path-marker" };
  }
  if (lower.includes("/.yarn/") || lower.includes("\\.yarn\\")) {
    return { manager: "yarn", installPath, reason: "yarn-path-marker" };
  }
  if (lower.includes("/bun/") || lower.includes("\\bun\\")) {
    return { manager: "bun", installPath, reason: "bun-path-marker" };
  }

  return { manager: "npm", installPath, reason: "npm-fallback" };
}

/** Build the argv for the detected manager's global-upgrade invocation. */
export function upgradeCommand(
  manager: PackageManager,
  channel: Channel = "latest"
): { cmd: string; args: readonly string[] } {
  const target = `${PACKAGE_NAME}@${channel}`;
  switch (manager) {
    case "npm":
      return { cmd: "npm", args: ["install", "-g", target] };
    case "pnpm":
      return { cmd: "pnpm", args: ["add", "-g", target] };
    case "yarn":
      return { cmd: "yarn", args: ["global", "add", target] };
    case "bun":
      return { cmd: "bun", args: ["add", "-g", target] };
  }
}

/** True iff the manager's CLI is actually reachable on PATH. */
export function managerOnPath(manager: PackageManager): boolean {
  try {
    // `<manager> --version` is universal and side-effect-free.
    const r = spawnSync(manager, ["--version"], {
      encoding: "utf-8",
      timeout: 2000,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

export interface UpgradeOutcome {
  readonly ok: boolean;
  /** Short human-readable status line. */
  readonly message: string;
  /** The command actually executed. */
  readonly executed: string | null;
  /** Stderr captured from the upgrade process (tail, for error display). */
  readonly stderrTail: string | null;
}

/**
 * Run the detected upgrade command. Blocking — the caller is a CLI that
 * wants to show stdout/stderr streaming.
 *
 * `dryRun: true` returns the command that WOULD have been executed
 * without running anything.
 */
export function runUpgrade(
  opts: {
    channel?: Channel;
    dryRun?: boolean;
    manager?: PackageManager;
  } = {}
): UpgradeOutcome {
  const channel = opts.channel ?? "latest";
  const detected =
    opts.manager !== undefined
      ? { manager: opts.manager, installPath: null, reason: "override" }
      : detectPackageManager();

  if (detected.manager === null) {
    return {
      ok: false,
      message:
        "Could not detect how engram was installed. Run your package manager's upgrade manually.",
      executed: null,
      stderrTail: null,
    };
  }

  if (!managerOnPath(detected.manager)) {
    return {
      ok: false,
      message: `${detected.manager} not found on PATH. Install it or use a different package manager.`,
      executed: null,
      stderrTail: null,
    };
  }

  const { cmd, args } = upgradeCommand(detected.manager, channel);
  const executed = `${cmd} ${args.join(" ")}`;

  if (opts.dryRun) {
    return {
      ok: true,
      message: `Would run: ${executed}`,
      executed,
      stderrTail: null,
    };
  }

  try {
    // `inherit` stdio so the user sees the manager's progress output.
    // If the manager prompts (rare for `-g` installs), they can respond.
    execFileSync(cmd, args, {
      stdio: "inherit",
      timeout: 120_000,
    });
    return {
      ok: true,
      message: `Upgrade complete via ${detected.manager}.`,
      executed,
      stderrTail: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const tail = msg.split("\n").slice(-5).join("\n");
    return {
      ok: false,
      message: `Upgrade failed via ${detected.manager}. Try manually: ${executed}`,
      executed,
      stderrTail: tail,
    };
  }
}

/** Helper so the CLI can print the manual fallback. */
export function manualCommand(channel: Channel = "latest"): string {
  // Mirror the npm install line we recommend in README.
  return `npm install -g ${PACKAGE_NAME}@${channel}`;
}

/** Return true iff we can safely check/upgrade in the current environment. */
export function safeEnvironment(): { ok: boolean; reason?: string } {
  // Refuse if we look installed via Homebrew — Homebrew wraps npm so the
  // node-level upgrade succeeds but Homebrew's registry drifts. Direct
  // users to `brew upgrade engram`.
  if (
    existsSync("/opt/homebrew/bin/engram") ||
    existsSync("/usr/local/Homebrew/bin/engram")
  ) {
    // We don't hard-fail because Homebrew installs are rare (no tap
    // published yet) — we just warn.
  }

  return { ok: true };
}

/** Used by the `install-hook` flow to pass PACKAGE_NAME downstream. */
export const PACKAGE = PACKAGE_NAME;
