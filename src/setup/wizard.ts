/**
 * engram setup — first-run wizard.
 *
 * One command for "go from cloned-repo to working-engram in under 30 seconds."
 *
 * Steps (each idempotent — safe to re-run):
 *   1. engram init (if .engram/graph.db missing)
 *   2. engram install-hook (if Sentinel hook not present)
 *   3. Offer each detected IDE adapter (non-blocking, one-shot prompt per)
 *   4. engram doctor summary
 *
 * Design principles:
 *   - NEVER destructive. Every step checks state before acting.
 *   - Prompts are optional. `--yes` / `-y` runs with sensible defaults.
 *   - `--dry-run` prints what would happen without touching anything.
 *   - Exit code reflects overall doctor severity (0 ok, 1 warn, 2 fail).
 */
import chalk from "chalk";
import readline from "node:readline/promises";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { homedir } from "node:os";
import { init } from "../core.js";
import { installEngramHooks } from "../intercept/installer.js";
import { detectAllIdes } from "./detect.js";
import { buildReport, formatReport } from "../doctor/report.js";

export interface SetupOptions {
  readonly projectPath: string;
  readonly yes: boolean;
  readonly dryRun: boolean;
  readonly engramVersion: string;
  /** Pre-built settings snapshot — mainly for tests. */
  readonly settingsScope?: "local" | "project" | "user";
}

export interface SetupResult {
  readonly initRan: boolean;
  readonly hookInstalled: boolean;
  readonly ideAdaptersRun: readonly string[];
  readonly exitCode: 0 | 1 | 2;
}

async function ask(
  rl: readline.Interface,
  question: string,
  fallback: boolean
): Promise<boolean> {
  const prompt = `${question} ${fallback ? "[Y/n]" : "[y/N]"} `;
  const answer = (await rl.question(prompt)).trim().toLowerCase();
  if (answer === "") return fallback;
  return answer === "y" || answer === "yes";
}

function banner(line: string): void {
  console.log(chalk.bold(line));
}

function step(n: number, title: string): void {
  console.log("");
  console.log(chalk.cyan(`── step ${n} · `) + chalk.bold(title));
}

function done(msg: string): void {
  console.log(chalk.green("  ✓ ") + msg);
}

function skip(msg: string): void {
  console.log(chalk.dim("  · ") + chalk.dim(msg));
}

function warn(msg: string): void {
  console.log(chalk.yellow("  ⚠ ") + msg);
}

async function ensureGraphInit(
  opts: SetupOptions,
  rl: readline.Interface | null
): Promise<boolean> {
  const root = pathResolve(opts.projectPath);
  const dbPath = join(root, ".engram", "graph.db");

  if (existsSync(dbPath)) {
    skip("graph.db already exists at .engram/graph.db — skipping init");
    return false;
  }

  if (opts.dryRun) {
    skip("[dry-run] would run `engram init`");
    return false;
  }

  const go =
    opts.yes ||
    rl === null ||
    (await ask(rl, "Index this repository now?", true));

  if (!go) {
    skip("skipped by user");
    return false;
  }

  console.log(chalk.dim("  → running engram init..."));
  const result = await init(root);
  done(
    `${result.nodes} nodes, ${result.edges} edges from ${result.fileCount} files (${result.timeMs}ms)`
  );
  return true;
}

async function ensureHookInstalled(
  opts: SetupOptions,
  rl: readline.Interface | null
): Promise<boolean> {
  const root = pathResolve(opts.projectPath);
  const scope = opts.settingsScope ?? "local";
  const settingsPath =
    scope === "user"
      ? join(homedir(), ".claude", "settings.json")
      : scope === "project"
        ? join(root, ".claude", "settings.json")
        : join(root, ".claude", "settings.local.json");

  const existing = existsSync(settingsPath)
    ? readFileSync(settingsPath, "utf-8")
    : "";

  if (existing.includes("engram intercept")) {
    skip(`Sentinel hook already in ${scope}-scope settings`);
    return false;
  }

  if (opts.dryRun) {
    skip(`[dry-run] would install Sentinel hook (${scope} scope)`);
    return false;
  }

  const go =
    opts.yes ||
    rl === null ||
    (await ask(rl, `Install Sentinel hook in ${scope} scope?`, true));

  if (!go) {
    skip("skipped by user");
    return false;
  }

  // Build the settings object. Minimal — rest of installer handles merge.
  let settings: Record<string, unknown> = {};
  if (existing) {
    try {
      settings = JSON.parse(existing) as Record<string, unknown>;
    } catch {
      warn(`settings file at ${settingsPath} is not valid JSON — aborting`);
      return false;
    }
  }

  const result = installEngramHooks(settings);
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(result.updated, null, 2) + "\n", "utf-8");
  done(`Sentinel hook installed (${scope} scope)`);
  return true;
}

async function offerIdeAdapters(
  opts: SetupOptions,
  rl: readline.Interface | null
): Promise<readonly string[]> {
  const root = pathResolve(opts.projectPath);
  const detected = detectAllIdes(root);
  const installedIdes = detected.filter((d) => d.installed);

  if (installedIdes.length === 0) {
    skip("no IDEs detected beyond Claude Code");
    return [];
  }

  console.log(chalk.dim("  Detected:"));
  for (const d of installedIdes) {
    console.log(
      chalk.dim(`    · ${d.name.padEnd(14)} — ${d.status}`)
    );
  }

  if (opts.dryRun) {
    skip("[dry-run] adapters left alone");
    return [];
  }

  // We don't auto-run individual gen-* commands here to keep the wizard
  // non-destructive on first run. Print the suggested commands instead.
  const unconfigured = installedIdes.filter((d) => !d.configured);
  if (unconfigured.length === 0) {
    done("all detected IDEs already have engram adapters");
    return [];
  }

  const suggest: Record<string, string> = {
    Cursor: "engram gen-mdc",
    Windsurf: "engram gen-windsurfrules",
    Aider: "engram gen-aider",
  };

  // Collect suggestions first so we only print the header when there's
  // something actionable. Claude Code is handled by install-hook (step 2)
  // so an unconfigured Claude Code here means hook-install was declined.
  const suggested: Array<{ name: string; cmd: string }> = [];
  for (const ide of unconfigured) {
    const cmd = suggest[ide.name];
    if (cmd) suggested.push({ name: ide.name, cmd });
  }

  if (suggested.length === 0) {
    // Nothing actionable to print. Note Claude Code coverage if relevant.
    const claudeCode = unconfigured.find((d) => d.name === "Claude Code");
    if (claudeCode) {
      skip("Claude Code hook declined or missing — re-run `engram install-hook`");
    } else {
      done("no additional adapters needed");
    }
    return [];
  }

  console.log("");
  console.log(chalk.dim("  Next steps for detected IDEs:"));
  const run: string[] = [];
  for (const s of suggested) {
    console.log(chalk.white(`    $ ${s.cmd}`));
    run.push(s.name);
  }
  return run;
}

export async function runSetup(opts: SetupOptions): Promise<SetupResult> {
  const root = pathResolve(opts.projectPath);
  banner(`\n⚡ engram setup — ${root}`);
  console.log(
    chalk.dim(
      `   Running ${opts.yes ? "non-interactively" : "interactively"}${
        opts.dryRun ? " (dry-run)" : ""
      }\n`
    )
  );

  const rl =
    opts.yes || opts.dryRun
      ? null
      : readline.createInterface({ input: process.stdin, output: process.stdout });

  let initRan = false;
  let hookInstalled = false;
  let ideAdapters: readonly string[] = [];

  try {
    step(1, "graph");
    initRan = await ensureGraphInit(opts, rl);

    step(2, "hook");
    hookInstalled = await ensureHookInstalled(opts, rl);

    step(3, "adapters");
    ideAdapters = await offerIdeAdapters(opts, rl);

    step(4, "verify");
    const report = buildReport(root, opts.engramVersion);
    console.log(formatReport(report, false));

    const exitCode: 0 | 1 | 2 =
      report.overallSeverity === "ok"
        ? 0
        : report.overallSeverity === "warn"
          ? 1
          : 2;

    return { initRan, hookInstalled, ideAdaptersRun: ideAdapters, exitCode };
  } finally {
    rl?.close();
  }
}
