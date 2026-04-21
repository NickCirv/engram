/**
 * engram doctor — component health report.
 *
 * Wraps `src/intercept/component-status.ts` probes plus a few
 * extra checks (graph DB presence, node version, engram version,
 * hook installation) into a human-readable report.
 *
 * Fast-path: all probes are file-existence only (<5ms per). No
 * network calls. Safe to run on every SessionStart or in CI.
 */
import chalk from "chalk";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform, release } from "node:os";
import {
  refreshComponentStatus,
  type ComponentHealth,
} from "../intercept/component-status.js";
import { cachePath, isNewer } from "../update/check.js";

/** Severity buckets. */
export type Severity = "ok" | "warn" | "fail";

export interface DoctorCheck {
  readonly name: string;
  readonly severity: Severity;
  readonly detail: string;
  /** Suggested fix when severity is warn/fail. */
  readonly remediation?: string;
}

export interface DoctorReport {
  readonly projectRoot: string;
  readonly engramVersion: string;
  readonly nodeVersion: string;
  readonly os: string;
  readonly checks: readonly DoctorCheck[];
  readonly overallSeverity: Severity;
  readonly generatedAt: number;
}

/** Check graph.db presence — the foundational "did you run init?" probe. */
function checkGraphDb(projectRoot: string): DoctorCheck {
  const path = join(projectRoot, ".engram", "graph.db");
  if (!existsSync(path)) {
    return {
      name: "graph",
      severity: "fail",
      detail: "No graph at .engram/graph.db",
      remediation: "Run `engram init` (or `engram setup` for the wizard).",
    };
  }
  try {
    const size = statSync(path).size;
    const sizeMb = (size / 1024 / 1024).toFixed(2);
    return {
      name: "graph",
      severity: "ok",
      detail: `.engram/graph.db present (${sizeMb} MB)`,
    };
  } catch {
    return {
      name: "graph",
      severity: "warn",
      detail: "graph.db exists but stat() failed",
      remediation: "Check file permissions on .engram/graph.db",
    };
  }
}

/** Check whether the Sentinel hook is wired into Claude Code settings. */
function checkHook(projectRoot: string): DoctorCheck {
  const candidates = [
    join(projectRoot, ".claude", "settings.local.json"),
    join(projectRoot, ".claude", "settings.json"),
    join(homedir(), ".claude", "settings.json"),
  ];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const content = readFileSync(path, "utf-8");
      if (content.includes("engram intercept")) {
        return {
          name: "hook",
          severity: "ok",
          detail: `Sentinel hook active (via ${path.replace(homedir(), "~")})`,
        };
      }
    } catch {
      /* ignore */
    }
  }

  return {
    name: "hook",
    severity: "warn",
    detail: "Sentinel hook not found in any .claude/settings*.json",
    remediation:
      "Run `engram install-hook` to enable automatic Read interception.",
  };
}

/** Map a ComponentHealth to a DoctorCheck with remediation. */
function componentToCheck(c: ComponentHealth): DoctorCheck {
  if (c.available) {
    return {
      name: c.name,
      severity: "ok",
      detail: `${c.name.toUpperCase()} provider reachable`,
    };
  }
  const remediationByName: Record<string, string> = {
    http: "Run `engram server --http` to start the local API.",
    lsp:
      "LSP is best-effort — install a language server (typescript-language-server, pyright, rust-analyzer).",
    ast:
      "Tree-sitter grammars missing. Reinstall engram: `engram update` or `npm install -g engramx@latest`.",
  };
  return {
    name: c.name,
    severity: c.name === "ast" ? "fail" : "warn",
    detail: `${c.name.toUpperCase()} provider unavailable`,
    remediation: remediationByName[c.name],
  };
}

/** Check engram CLI version against the last cached registry check. */
function checkVersion(engramVersion: string): DoctorCheck {
  try {
    const path = cachePath();
    if (!existsSync(path)) {
      return {
        name: "version",
        severity: "ok",
        detail: `engram v${engramVersion} (no update check cached yet)`,
      };
    }
    const cached = JSON.parse(readFileSync(path, "utf-8")) as {
      latest?: string;
    };
    if (
      typeof cached?.latest === "string" &&
      cached.latest !== engramVersion &&
      isNewer(cached.latest, engramVersion)
    ) {
      return {
        name: "version",
        severity: "warn",
        detail: `engram v${engramVersion} — v${cached.latest} is available`,
        remediation: "Run `engram update` to upgrade.",
      };
    }
    return {
      name: "version",
      severity: "ok",
      detail: `engram v${engramVersion} (latest)`,
    };
  } catch {
    return {
      name: "version",
      severity: "ok",
      detail: `engram v${engramVersion}`,
    };
  }
}

/** Count IDE adapters (surfaced from component-status). */
function checkIdes(ideCount: number): DoctorCheck {
  if (ideCount === 0) {
    return {
      name: "ides",
      severity: "warn",
      detail: "No IDE adapters detected",
      remediation:
        "Run `engram gen-mdc` (Cursor), `gen-windsurfrules` (Windsurf), or `gen-aider` (Aider) to add IDE adapters.",
    };
  }
  return {
    name: "ides",
    severity: "ok",
    detail: `${ideCount} IDE adapter${ideCount > 1 ? "s" : ""} configured`,
  };
}

/** Compute overall severity from a set of checks — worst wins. */
function aggregate(checks: readonly DoctorCheck[]): Severity {
  if (checks.some((c) => c.severity === "fail")) return "fail";
  if (checks.some((c) => c.severity === "warn")) return "warn";
  return "ok";
}

/** Build a DoctorReport for the given project. Never throws. */
export function buildReport(
  projectRoot: string,
  engramVersion: string
): DoctorReport {
  const components = refreshComponentStatus(projectRoot);
  const checks: DoctorCheck[] = [
    checkVersion(engramVersion),
    checkGraphDb(projectRoot),
    checkHook(projectRoot),
    ...components.components.map(componentToCheck),
    checkIdes(components.ideCount),
  ];

  return {
    projectRoot,
    engramVersion,
    nodeVersion: process.version,
    os: `${platform()} ${release()}`,
    checks,
    overallSeverity: aggregate(checks),
    generatedAt: Date.now(),
  };
}

/** Pretty icon for a severity. */
function icon(sev: Severity): string {
  switch (sev) {
    case "ok":
      return chalk.green("✓");
    case "warn":
      return chalk.yellow("⚠");
    case "fail":
      return chalk.red("✗");
  }
}

/** Format a report for human display. Respects --verbose for remediation. */
export function formatReport(report: DoctorReport, verbose: boolean): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(chalk.bold(`🩺 engram doctor — ${report.projectRoot}`));
  lines.push(
    chalk.dim(
      `   engram v${report.engramVersion} · Node ${report.nodeVersion} · ${report.os}`
    )
  );
  lines.push("");

  for (const c of report.checks) {
    lines.push(`  ${icon(c.severity)} ${chalk.bold(c.name.padEnd(8))} ${c.detail}`);
    if (verbose && c.remediation && c.severity !== "ok") {
      lines.push(`      ${chalk.dim("→ " + c.remediation)}`);
    }
  }

  lines.push("");
  switch (report.overallSeverity) {
    case "ok":
      lines.push(chalk.green("  All systems green."));
      break;
    case "warn":
      lines.push(
        chalk.yellow(
          "  Working, with warnings. Run `engram doctor --verbose` for remediation."
        )
      );
      break;
    case "fail":
      lines.push(
        chalk.red(
          "  Critical components missing. Run `engram doctor --verbose` for fixes."
        )
      );
      break;
  }
  lines.push("");

  return lines.join("\n");
}

/** Build a redacted JSON export for bug reports (--export flag). */
export function exportReport(report: DoctorReport): string {
  return JSON.stringify(
    {
      engramVersion: report.engramVersion,
      nodeVersion: report.nodeVersion,
      os: report.os,
      overallSeverity: report.overallSeverity,
      checks: report.checks.map((c) => ({
        name: c.name,
        severity: c.severity,
        detail: c.detail,
      })),
      generatedAt: new Date(report.generatedAt).toISOString(),
      // NOTE: projectRoot intentionally omitted — can contain usernames.
    },
    null,
    2
  );
}
