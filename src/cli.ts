#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  copyFileSync,
  renameSync,
} from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { homedir } from "node:os";
import {
  init,
  query,
  path,
  godNodes,
  stats,
  benchmark,
  learn,
  mistakes,
} from "./core.js";
import { install as installHooks, uninstall as uninstallHooks, status as hooksStatus } from "./hooks.js";
import { autogen } from "./autogen.js";
import { dispatchHook } from "./intercept/dispatch.js";
import { watchProject } from "./watcher.js";
import { startDashboard } from "./dashboard.js";
import { handleCursorBeforeReadFile } from "./intercept/cursor-adapter.js";
import {
  installEngramHooks,
  uninstallEngramHooks,
  formatInstallDiff,
  type ClaudeCodeSettings,
} from "./intercept/installer.js";
import { summarizeHookLog, formatStatsSummary } from "./intercept/stats.js";
import { readHookLog } from "./intelligence/hook-log.js";
import { findProjectRoot } from "./intercept/context.js";
import {
  buildEngramSection,
  writeEngramSectionToMemoryMd,
} from "./intercept/memory-md.js";
import { basename } from "node:path";

// Read version from package.json at build time via import.
// Using createRequire to avoid ESM JSON import assertions.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require("../package.json");

const program = new Command();

program
  .name("engram")
  .description(
    "Context as infra for AI coding tools — hook-based Read/Edit interception + structural graph summaries"
  )
  .version(PKG_VERSION);

program
  .command("init")
  .description("Scan codebase and build knowledge graph (zero LLM cost)")
  .argument("[path]", "Project directory", ".")
  .option(
    "--with-skills [dir]",
    "Also index Claude Code skills from ~/.claude/skills/ or a given path"
  )
  .action(async (projectPath: string, opts: { withSkills?: string | boolean }) => {
    console.log(chalk.dim("🔍 Scanning codebase..."));
    const result = await init(projectPath, {
      withSkills: opts.withSkills,
    });
    console.log(
      chalk.green("🌳 AST extraction complete") +
        chalk.dim(` (${result.timeMs}ms, 0 tokens used)`)
    );
    console.log(
      `   ${chalk.bold(String(result.nodes))} nodes, ${chalk.bold(String(result.edges))} edges from ${chalk.bold(String(result.fileCount))} files (${result.totalLines.toLocaleString()} lines)`
    );
    if (result.skillCount && result.skillCount > 0) {
      console.log(
        chalk.cyan(`   ${chalk.bold(String(result.skillCount))} skills indexed`)
      );
    }

    const bench = await benchmark(projectPath);
    if (bench.naiveFullCorpus > 0 && bench.reductionVsRelevant > 1) {
      console.log(
        chalk.cyan(`\n📊 Token savings: ${chalk.bold(bench.reductionVsRelevant + "x")} fewer tokens vs relevant files (${bench.reductionVsFull}x vs full corpus)`)
      );
      console.log(
        chalk.dim(`   Full corpus: ~${bench.naiveFullCorpus.toLocaleString()} tokens | Graph query: ~${bench.avgQueryTokens.toLocaleString()} tokens`)
      );
    }

    console.log(chalk.green("\n✅ Ready. Your AI now has persistent memory."));
    console.log(chalk.dim("   Graph stored in .engram/graph.db"));

    // Check if Sentinel hooks are already installed — if not, nudge the user.
    const resolvedProject = pathResolve(projectPath);
    const localSettings = join(resolvedProject, ".claude", "settings.local.json");
    const projectSettings = join(resolvedProject, ".claude", "settings.json");
    const hasHooks =
      (existsSync(localSettings) &&
        readFileSync(localSettings, "utf-8").includes("engram intercept")) ||
      (existsSync(projectSettings) &&
        readFileSync(projectSettings, "utf-8").includes("engram intercept"));

    if (!hasHooks) {
      console.log(
        chalk.yellow("\n💡 Next step: ") +
          chalk.white("engram install-hook") +
          chalk.dim(
            " — enables automatic Read interception (82% token savings)"
          )
      );
      console.log(
        chalk.dim(
          "   Also recommended: " +
            chalk.white("engram hooks install") +
            " — auto-rebuild graph on git commit"
        )
      );
    }
  });

program
  .command("watch")
  .description("Watch project for file changes and re-index incrementally")
  .argument("[path]", "Project directory", ".")
  .action(async (projectPath: string) => {
    const resolvedPath = pathResolve(projectPath);
    console.log(
      chalk.dim("👁  Watching ") +
        chalk.white(resolvedPath) +
        chalk.dim(" for changes...")
    );

    const controller = watchProject(resolvedPath, {
      onReindex: (filePath, nodeCount) => {
        console.log(
          chalk.green("  ↻ ") +
            chalk.white(filePath) +
            chalk.dim(` (${nodeCount} nodes)`)
        );
      },
      onError: (err) => {
        console.error(chalk.red("  ✗ ") + err.message);
      },
      onReady: () => {
        console.log(chalk.green("  ✓ Watcher active.") + chalk.dim(" Press Ctrl+C to stop."));
      },
    });

    // Keep process alive until Ctrl+C
    process.on("SIGINT", () => {
      controller.abort();
      console.log(chalk.dim("\n  Watcher stopped."));
      process.exit(0);
    });

    // Prevent the process from exiting
    await new Promise(() => {});
  });

program
  .command("dashboard")
  .alias("hud")
  .description("Live terminal dashboard showing hook activity and token savings")
  .argument("[path]", "Project directory", ".")
  .action(async (projectPath: string) => {
    const resolvedPath = pathResolve(projectPath);
    const dbPath = join(resolvedPath, ".engram", "graph.db");
    if (!existsSync(dbPath)) {
      console.error(
        chalk.red("No engram graph found at ") + chalk.white(resolvedPath)
      );
      console.error(chalk.dim("Run 'engram init' first."));
      process.exit(1);
    }

    const controller = startDashboard(resolvedPath);

    process.on("SIGINT", () => {
      controller.abort();
      console.log(chalk.dim("\n  Dashboard closed."));
      process.exit(0);
    });

    // Keep process alive
    await new Promise(() => {});
  });

program
  .command("hud-label")
  .description("Output JSON label for Claude HUD --extra-cmd (fast, <20ms)")
  .argument("[path]", "Project directory", ".")
  .action(async (projectPath: string) => {
    // Walk up from the given path (or cwd) to find the nearest .engram/.
    // This way the label works regardless of which directory the
    // Claude Code session started in — it finds the project root
    // the same way the Sentinel hooks do.
    let resolvedPath = pathResolve(projectPath);
    let found = false;
    for (let depth = 0; depth < 20; depth++) {
      if (existsSync(join(resolvedPath, ".engram", "graph.db"))) {
        found = true;
        break;
      }
      const parent = dirname(resolvedPath);
      if (parent === resolvedPath) break;
      resolvedPath = parent;
    }

    if (!found) {
      console.log('{"label":""}');
      return;
    }

    const logPath = join(resolvedPath, ".engram", "hook-log.jsonl");

    if (!existsSync(logPath)) {
      console.log('{"label":"⚡engram ░░░░░░░░░░ ready"}');
      return;
    }

    try {
      const entries = readHookLog(resolvedPath);
      const summary = summarizeHookLog(entries);

      if (summary.totalInvocations === 0) {
        console.log('{"label":"⚡engram ░░░░░░░░░░ listening..."}');
        return;
      }

      const totalPreTool =
        (summary.byDecision["deny"] ?? 0) +
        (summary.byDecision["allow"] ?? 0) +
        (summary.byDecision["passthrough"] ?? 0);
      const denied = summary.readDenyCount;
      const hitRate = totalPreTool > 0 ? Math.round((denied / totalPreTool) * 100) : 0;
      const tokens = summary.estimatedTokensSaved;

      // Format tokens
      let formatted: string;
      if (tokens >= 1_000_000) formatted = (tokens / 1_000_000).toFixed(1) + "M";
      else if (tokens >= 1_000) formatted = (tokens / 1_000).toFixed(1) + "K";
      else formatted = String(tokens);

      // Build bar (10 chars)
      const barWidth = 10;
      let filled = Math.round((hitRate / 100) * barWidth);
      if (filled > barWidth) filled = barWidth;
      if (denied > 0 && filled === 0) filled = 1;
      const bar = "▰".repeat(filled) + "▱".repeat(barWidth - filled);

      console.log(JSON.stringify({ label: `⚡engram ${formatted} saved ${bar} ${hitRate}%` }));
    } catch {
      console.log('{"label":"⚡engram"}');
    }
  });

program
  .command("query")
  .description("Query the knowledge graph")
  .argument("<question>", "Natural language question or keywords")
  .option("--dfs", "Use DFS traversal", false)
  .option("-d, --depth <n>", "Traversal depth", "3")
  .option("-b, --budget <n>", "Token budget", "2000")
  .option("-p, --project <path>", "Project directory", ".")
  .action(async (question: string, opts: { dfs: boolean; depth: string; budget: string; project: string }) => {
    const result = await query(opts.project, question, {
      mode: opts.dfs ? "dfs" : "bfs",
      depth: Number(opts.depth),
      tokenBudget: Number(opts.budget),
    });
    if (result.nodesFound === 0) {
      console.log(chalk.yellow("No matching nodes found."));
      return;
    }
    console.log(chalk.dim(`Found ${result.nodesFound} nodes (~${result.estimatedTokens} tokens)\n`));
    console.log(result.text);
  });

program
  .command("path")
  .description("Find shortest path between two concepts")
  .argument("<source>", "Source concept")
  .argument("<target>", "Target concept")
  .option("-p, --project <path>", "Project directory", ".")
  .action(async (source: string, target: string, opts: { project: string }) => {
    const result = await path(opts.project, source, target);
    console.log(result.text);
  });

program
  .command("gods")
  .description("Show most connected entities (god nodes)")
  .option("-n, --top <n>", "Number of nodes", "10")
  .option("-p, --project <path>", "Project directory", ".")
  .action(async (opts: { top: string; project: string }) => {
    const gods = await godNodes(opts.project, Number(opts.top));
    if (gods.length === 0) {
      console.log(chalk.yellow("No nodes found. Run `engram init` first."));
      return;
    }
    console.log(chalk.bold("God nodes (most connected):\n"));
    for (let i = 0; i < gods.length; i++) {
      const g = gods[i];
      console.log(
        `  ${chalk.dim(String(i + 1) + ".")} ${chalk.bold(g.label)} ${chalk.dim(`[${g.kind}]`)} — ${g.degree} edges ${chalk.dim(g.sourceFile)}`
      );
    }
  });

program
  .command("stats")
  .description("Show knowledge graph statistics and token savings")
  .option("-p, --project <path>", "Project directory", ".")
  .action(async (opts: { project: string }) => {
    const s = await stats(opts.project);
    const bench = await benchmark(opts.project);

    console.log(chalk.bold("\n📊 engram stats\n"));
    console.log(`  Nodes:       ${chalk.bold(String(s.nodes))}`);
    console.log(`  Edges:       ${chalk.bold(String(s.edges))}`);
    console.log(
      `  Confidence:  ${chalk.green(s.extractedPct + "% EXTRACTED")} · ${chalk.yellow(s.inferredPct + "% INFERRED")} · ${chalk.red(s.ambiguousPct + "% AMBIGUOUS")}`
    );

    if (s.lastMined > 0) {
      const ago = Math.round((Date.now() - s.lastMined) / 60000);
      console.log(`  Last mined:  ${ago < 60 ? ago + "m ago" : Math.round(ago / 60) + "h ago"}`);
    }

    if (bench.naiveFullCorpus > 0) {
      console.log(`\n  ${chalk.cyan("Token savings:")}`);
      console.log(`    Full corpus:   ~${bench.naiveFullCorpus.toLocaleString()} tokens`);
      console.log(`    Avg query:     ~${bench.avgQueryTokens.toLocaleString()} tokens`);
      console.log(`    vs relevant:   ${chalk.bold.cyan(bench.reductionVsRelevant + "x")} fewer tokens`);
      console.log(`    vs full:       ${chalk.bold.cyan(bench.reductionVsFull + "x")} fewer tokens`);
    }
    console.log();
  });

program
  .command("learn")
  .description("Teach engram a decision, pattern, or lesson")
  .argument("<text>", "What to remember (e.g., 'We chose JWT over sessions for horizontal scaling')")
  .option("-p, --project <path>", "Project directory", ".")
  .action(async (text: string, opts: { project: string }) => {
    const result = await learn(opts.project, text);
    if (result.nodesAdded > 0) {
      console.log(chalk.green(`🧠 Learned ${result.nodesAdded} new insight(s).`));
    } else {
      console.log(chalk.yellow("No patterns extracted. Try a more specific statement."));
    }
  });

program
  .command("mistakes")
  .description("List known mistakes extracted from past sessions")
  .option("-p, --project <path>", "Project directory", ".")
  .option("-l, --limit <n>", "Max entries to display", "20")
  .option("--since <days>", "Only mistakes from the last N days")
  .action(
    async (opts: { project: string; limit: string; since?: string }) => {
      const result = await mistakes(opts.project, {
        limit: Number(opts.limit),
        sinceDays: opts.since ? Number(opts.since) : undefined,
      });
      if (result.length === 0) {
        console.log(chalk.yellow("No mistakes recorded."));
        return;
      }
      console.log(
        chalk.bold(`\n⚠️  ${result.length} mistake(s) recorded:\n`)
      );
      for (const m of result) {
        const ago = Math.max(
          1,
          Math.round((Date.now() - m.lastVerified) / 86400000)
        );
        console.log(
          `  ${chalk.dim(`[${m.sourceFile}, ${ago}d ago]`)} ${m.label}`
        );
      }
      console.log();
    }
  );

program
  .command("bench")
  .description("Run token reduction benchmark")
  .option("-p, --project <path>", "Project directory", ".")
  .action(async (opts: { project: string }) => {
    const result = await benchmark(opts.project);
    console.log(chalk.bold("\n⚡ engram token reduction benchmark\n"));
    console.log(`  Full corpus:     ~${result.naiveFullCorpus.toLocaleString()} tokens`);
    console.log(`  Avg graph query: ~${result.avgQueryTokens.toLocaleString()} tokens`);
    console.log(`  vs relevant:     ${chalk.bold.green(result.reductionVsRelevant + "x")} fewer tokens`);
    console.log(`  vs full corpus:  ${chalk.bold.green(result.reductionVsFull + "x")} fewer tokens\n`);
    for (const pq of result.perQuestion) {
      console.log(`  ${chalk.dim(`[${pq.reductionRelevant}x relevant / ${pq.reductionFull}x full]`)} ${pq.question}`);
    }
    console.log();
  });

// ── hooks ───────────────────────────────────────────────────────────────────
const hooks = program.command("hooks").description("Manage git hooks");

hooks
  .command("install")
  .description("Install post-commit and post-checkout hooks")
  .argument("[path]", "Project directory", ".")
  .action((p: string) => console.log(installHooks(p)));

hooks
  .command("uninstall")
  .description("Remove engram git hooks")
  .argument("[path]", "Project directory", ".")
  .action((p: string) => console.log(uninstallHooks(p)));

hooks
  .command("status")
  .description("Check if hooks are installed")
  .argument("[path]", "Project directory", ".")
  .action((p: string) => console.log(hooksStatus(p)));

// ── autogen ─────────────────────────────────────────────────────────────────
program
  .command("gen")
  .description("Generate CLAUDE.md / .cursorrules section from graph")
  .option("-p, --project <path>", "Project directory", ".")
  .option("-t, --target <type>", "Target file: claude, cursor, agents")
  .option(
    "--task <name>",
    "Task-aware view: general (default), bug-fix, feature, refactor"
  )
  .action(
    async (opts: { project: string; target?: string; task?: string }) => {
      const target = opts.target as "claude" | "cursor" | "agents" | undefined;
      const result = await autogen(opts.project, target, opts.task);
      console.log(
        chalk.green(
          `✅ Updated ${result.file} (${result.nodesIncluded} nodes, view: ${result.view})`
        )
      );
    }
  );

// ── Sentinel hook commands (v0.3.0) ─────────────────────────────────────────

/**
 * Resolve the Claude Code settings file path for a given scope.
 *   - local   → <project>/.claude/settings.local.json (gitignored)
 *   - project → <project>/.claude/settings.json (committed)
 *   - user    → ~/.claude/settings.json (global)
 */
function resolveSettingsPath(
  scope: string,
  projectPath: string
): string | null {
  const absProject = pathResolve(projectPath);
  switch (scope) {
    case "local":
      return join(absProject, ".claude", "settings.local.json");
    case "project":
      return join(absProject, ".claude", "settings.json");
    case "user":
      return join(homedir(), ".claude", "settings.json");
    default:
      return null;
  }
}

/**
 * engram intercept — the entry point Claude Code calls for every hook
 * invocation. Reads JSON from stdin, dispatches through the handler
 * registry, writes a JSON response to stdout.
 *
 * Contract: ALWAYS exits 0. Any failure resolves to "no stdout output",
 * which Claude Code interprets as passthrough.
 */
program
  .command("intercept")
  .description(
    "Hook entry point. Reads JSON from stdin, writes response JSON to stdout. Called by Claude Code."
  )
  .action(async () => {
    // Read stdin with a hard cap. If nothing arrives within a few
    // seconds, bail with passthrough rather than hanging. This watchdog
    // is the ONE place we intentionally keep `process.exit` — a stuck
    // stdin handle means the event loop can't drain naturally anyway,
    // and a fast crash beats a hang from Claude Code's perspective.
    const stdinTimeout = setTimeout(() => {
      process.exit(0);
    }, 3000);
    stdinTimeout.unref();

    let input = "";
    let stdinFailed = false;
    try {
      for await (const chunk of process.stdin) {
        input += chunk;
        // Safety cap — absurdly large inputs get rejected.
        if (input.length > 1_000_000) break;
      }
    } catch {
      stdinFailed = true;
    }
    clearTimeout(stdinTimeout);

    if (stdinFailed || !input.trim()) {
      process.exitCode = 0;
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(input);
    } catch {
      process.exitCode = 0;
      return;
    }

    try {
      const result = await dispatchHook(payload);
      if (result && typeof result === "object") {
        process.stdout.write(JSON.stringify(result));
      }
    } catch {
      // Never block Claude Code on engram bugs.
    }
    // Do NOT call process.exit — on Node 25 + Windows, force-exit while
    // sql.js's WASM init leaves an async handle in UV_HANDLE_CLOSING
    // state triggers a libuv assertion in src/win/async.c:76. Setting
    // exitCode and returning lets the event loop drain naturally (stdin
    // is already consumed; no other handles keep the loop alive).
    process.exitCode = 0;
  });

/**
 * engram cursor-intercept — the entry point Cursor 1.7+ calls for
 * `beforeReadFile` hook invocations. Same stdin→stdout JSON contract as
 * `intercept`, but wraps the Cursor adapter so the response shape
 * matches Cursor's `{ permission, user_message }` protocol.
 *
 * EXPERIMENTAL — scaffolded in v0.3.1, full Cursor integration lands
 * in v0.3.2. Safe to use today, but the Cursor port sprint will pin
 * the wire format and add integration tests against Cursor itself.
 *
 * Contract: ALWAYS exits 0 and ALWAYS writes a Cursor response. On
 * any failure we write `{"permission":"allow"}` so Cursor proceeds
 * normally (fail-open, matching Cursor's default).
 */
program
  .command("cursor-intercept")
  .description(
    "Cursor beforeReadFile hook entry point (experimental). Reads JSON from stdin, writes Cursor-shaped response JSON to stdout."
  )
  .action(async () => {
    const ALLOW_JSON = '{"permission":"allow"}';

    const stdinTimeout = setTimeout(() => {
      process.stdout.write(ALLOW_JSON);
      process.exit(0);
    }, 3000);

    let input = "";
    try {
      for await (const chunk of process.stdin) {
        input += chunk;
        if (input.length > 1_000_000) break;
      }
    } catch {
      clearTimeout(stdinTimeout);
      process.stdout.write(ALLOW_JSON);
      process.exit(0);
    }
    clearTimeout(stdinTimeout);

    if (!input.trim()) {
      process.stdout.write(ALLOW_JSON);
      process.exit(0);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(input);
    } catch {
      process.stdout.write(ALLOW_JSON);
      process.exit(0);
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await handleCursorBeforeReadFile(payload as any);
      process.stdout.write(JSON.stringify(result));
    } catch {
      process.stdout.write(ALLOW_JSON);
    }

    process.exit(0);
  });

/**
 * engram install-hook — write engram's PreToolUse / PostToolUse /
 * SessionStart / UserPromptSubmit entries into a Claude Code settings
 * file, preserving any existing non-engram hooks. Atomic write with
 * timestamped backup.
 */
program
  .command("install-hook")
  .description("Install engram hook entries into Claude Code settings")
  .option("--scope <scope>", "local | project | user", "local")
  .option("--dry-run", "Show diff without writing", false)
  .option("-p, --project <path>", "Project directory", ".")
  .action(
    async (opts: {
      scope: string;
      dryRun: boolean;
      project: string;
    }) => {
      const settingsPath = resolveSettingsPath(opts.scope, opts.project);
      if (!settingsPath) {
        console.error(
          chalk.red(
            `Unknown scope: ${opts.scope} (expected: local | project | user)`
          )
        );
        process.exit(1);
      }

      // Read existing settings (or default to empty object).
      let existing: ClaudeCodeSettings = {};
      if (existsSync(settingsPath)) {
        try {
          const raw = readFileSync(settingsPath, "utf-8");
          existing = raw.trim() ? (JSON.parse(raw) as ClaudeCodeSettings) : {};
        } catch (err) {
          console.error(
            chalk.red(
              `Failed to parse ${settingsPath}: ${(err as Error).message}`
            )
          );
          console.error(
            chalk.dim(
              "Fix the JSON syntax and re-run install-hook, or remove the file and start fresh."
            )
          );
          process.exit(1);
        }
      }

      const result = installEngramHooks(existing);

      console.log(
        chalk.bold(`\n📌 engram install-hook (scope: ${opts.scope})`)
      );
      console.log(chalk.dim(`   Target: ${settingsPath}`));

      if (result.added.length === 0) {
        console.log(
          chalk.yellow(
            `\n   All engram hooks already installed (${result.alreadyPresent.join(", ")}).`
          )
        );
        console.log(
          chalk.dim(
            "   Run 'engram uninstall-hook' first if you want to reinstall."
          )
        );
        return;
      }

      console.log(chalk.cyan("\n   Changes:"));
      console.log(
        formatInstallDiff(existing, result.updated)
          .split("\n")
          .map((l) => "     " + l)
          .join("\n")
      );

      if (opts.dryRun) {
        console.log(chalk.dim("\n   (dry-run — no changes written)"));
        return;
      }

      // Atomic write with backup.
      try {
        mkdirSync(dirname(settingsPath), { recursive: true });
        if (existsSync(settingsPath)) {
          const backupPath = `${settingsPath}.engram-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
          copyFileSync(settingsPath, backupPath);
          console.log(chalk.dim(`   Backup: ${backupPath}`));
        }
        const tmpPath = settingsPath + ".engram-tmp";
        writeFileSync(
          tmpPath,
          JSON.stringify(result.updated, null, 2) + "\n"
        );
        renameSync(tmpPath, settingsPath);
      } catch (err) {
        console.error(
          chalk.red(`\n   ❌ Write failed: ${(err as Error).message}`)
        );
        process.exit(1);
      }

      console.log(
        chalk.green(
          `\n   ✅ Installed ${result.added.length} hook event${result.added.length === 1 ? "" : "s"}: ${result.added.join(", ")}`
        )
      );
      if (result.alreadyPresent.length > 0) {
        console.log(
          chalk.dim(
            `   Already present: ${result.alreadyPresent.join(", ")}`
          )
        );
      }
      console.log(
        chalk.dim(
          "\n   Next: open a Claude Code session and engram will start intercepting tool calls."
        )
      );
    }
  );

/**
 * engram uninstall-hook — remove engram's entries from a settings file,
 * preserving everything else. Cleans up empty arrays.
 */
program
  .command("uninstall-hook")
  .description("Remove engram hook entries from Claude Code settings")
  .option("--scope <scope>", "local | project | user", "local")
  .option("-p, --project <path>", "Project directory", ".")
  .action(async (opts: { scope: string; project: string }) => {
    const settingsPath = resolveSettingsPath(opts.scope, opts.project);
    if (!settingsPath) {
      console.error(chalk.red(`Unknown scope: ${opts.scope}`));
      process.exit(1);
    }

    if (!existsSync(settingsPath)) {
      console.log(
        chalk.yellow(`No settings file at ${settingsPath} — nothing to remove.`)
      );
      return;
    }

    let existing: ClaudeCodeSettings;
    try {
      const raw = readFileSync(settingsPath, "utf-8");
      existing = raw.trim() ? (JSON.parse(raw) as ClaudeCodeSettings) : {};
    } catch (err) {
      console.error(
        chalk.red(`Failed to parse ${settingsPath}: ${(err as Error).message}`)
      );
      process.exit(1);
    }

    const result = uninstallEngramHooks(existing);

    if (result.removed.length === 0) {
      console.log(
        chalk.yellow(`\n   No engram hooks found in ${settingsPath}.`)
      );
      return;
    }

    // Atomic write with backup.
    try {
      const backupPath = `${settingsPath}.engram-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
      copyFileSync(settingsPath, backupPath);
      const tmpPath = settingsPath + ".engram-tmp";
      writeFileSync(tmpPath, JSON.stringify(result.updated, null, 2) + "\n");
      renameSync(tmpPath, settingsPath);
      console.log(
        chalk.green(
          `\n   ✅ Removed engram hooks from ${result.removed.length} event${result.removed.length === 1 ? "" : "s"}: ${result.removed.join(", ")}`
        )
      );
      console.log(chalk.dim(`   Backup: ${backupPath}`));
    } catch (err) {
      console.error(
        chalk.red(`\n   ❌ Write failed: ${(err as Error).message}`)
      );
      process.exit(1);
    }
  });

/**
 * engram hook-stats — summarize .engram/hook-log.jsonl for the given
 * project. Prints a human-readable report, or JSON with --json.
 */
program
  .command("hook-stats")
  .description("Summarize hook-log.jsonl for a project")
  .option("-p, --project <path>", "Project directory", ".")
  .option("--json", "Output as JSON", false)
  .action(async (opts: { project: string; json: boolean }) => {
    const absProject = pathResolve(opts.project);
    const projectRoot = findProjectRoot(absProject) ?? absProject;
    const entries = readHookLog(projectRoot);
    const summary = summarizeHookLog(entries);

    if (opts.json) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    console.log(formatStatsSummary(summary));
  });

/**
 * engram hook-preview — show what the Read handler would do for a
 * specific file WITHOUT installing the hook. Useful for debugging
 * coverage before committing to an install.
 */
program
  .command("hook-preview")
  .description("Show what the Read handler would do for a file (dry-run)")
  .argument("<file>", "Target file path")
  .option("-p, --project <path>", "Project directory", ".")
  .action(async (file: string, opts: { project: string }) => {
    const absProject = pathResolve(opts.project);
    const absFile = pathResolve(absProject, file);

    const payload = {
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      cwd: absProject,
      tool_input: { file_path: absFile },
    };

    const result = await dispatchHook(payload);

    console.log(chalk.bold(`\n📋 Hook preview: ${absFile}`));
    console.log(chalk.dim(`   Project: ${absProject}`));
    console.log();

    if (result === null || result === undefined) {
      console.log(
        chalk.yellow("   Decision: PASSTHROUGH (Read would execute normally)")
      );
      console.log(
        chalk.dim(
          "   Possible reasons: file not in graph, confidence below threshold, content unsafe, outside project, stale graph."
        )
      );
      return;
    }

    const wrapped = result as {
      hookSpecificOutput?: {
        permissionDecision?: string;
        permissionDecisionReason?: string;
        additionalContext?: string;
      };
    };
    const decision = wrapped.hookSpecificOutput?.permissionDecision;

    if (decision === "deny") {
      console.log(chalk.green("   Decision: DENY (Read would be replaced)"));
      console.log(chalk.dim("   Summary (would be delivered to Claude):"));
      console.log();
      const reason =
        wrapped.hookSpecificOutput?.permissionDecisionReason ?? "";
      console.log(
        reason
          .split("\n")
          .map((l) => "     " + l)
          .join("\n")
      );
      return;
    }

    if (decision === "allow") {
      console.log(chalk.cyan("   Decision: ALLOW (with additionalContext)"));
      const ctx = wrapped.hookSpecificOutput?.additionalContext ?? "";
      if (ctx) {
        console.log(chalk.dim("   Additional context that would be injected:"));
        console.log(
          ctx
            .split("\n")
            .map((l) => "     " + l)
            .join("\n")
        );
      }
      return;
    }

    console.log(chalk.yellow(`   Decision: ${decision ?? "unknown"}`));
  });

/**
 * engram hook-disable — touch .engram/hook-disabled so every handler
 * exits to passthrough. Use for debugging without a full uninstall.
 */
program
  .command("hook-disable")
  .description("Disable engram hooks via kill switch (does not uninstall)")
  .option("-p, --project <path>", "Project directory", ".")
  .action(async (opts: { project: string }) => {
    const absProject = pathResolve(opts.project);
    const projectRoot = findProjectRoot(absProject);
    if (!projectRoot) {
      console.error(
        chalk.red(`Not an engram project: ${absProject}`)
      );
      console.error(chalk.dim("Run 'engram init' first."));
      process.exit(1);
    }
    const flagPath = join(projectRoot, ".engram", "hook-disabled");
    try {
      writeFileSync(flagPath, new Date().toISOString());
      console.log(
        chalk.green(`✅ engram hooks disabled for ${projectRoot}`)
      );
      console.log(chalk.dim(`   Flag: ${flagPath}`));
      console.log(
        chalk.dim("   Run 'engram hook-enable' to re-enable.")
      );
    } catch (err) {
      console.error(
        chalk.red(`Failed to create flag: ${(err as Error).message}`)
      );
      process.exit(1);
    }
  });

/**
 * engram hook-enable — remove the kill switch flag.
 */
program
  .command("hook-enable")
  .description("Re-enable engram hooks (remove kill switch flag)")
  .option("-p, --project <path>", "Project directory", ".")
  .action(async (opts: { project: string }) => {
    const absProject = pathResolve(opts.project);
    const projectRoot = findProjectRoot(absProject);
    if (!projectRoot) {
      console.error(chalk.red(`Not an engram project: ${absProject}`));
      process.exit(1);
    }
    const flagPath = join(projectRoot, ".engram", "hook-disabled");
    if (!existsSync(flagPath)) {
      console.log(
        chalk.yellow(`engram hooks already enabled for ${projectRoot}`)
      );
      return;
    }
    try {
      unlinkSync(flagPath);
      console.log(
        chalk.green(`✅ engram hooks re-enabled for ${projectRoot}`)
      );
    } catch (err) {
      console.error(
        chalk.red(`Failed to remove flag: ${(err as Error).message}`)
      );
      process.exit(1);
    }
  });

/**
 * engram memory-sync — v0.3.1
 *
 * Write engram's top-k structural facts into MEMORY.md between
 * marker blocks. Complements Anthropic's native Auto-Dream memory
 * system (which owns prose) by contributing structural code graph
 * facts (god nodes, landmines, hot files, current branch).
 */
program
  .command("memory-sync")
  .description(
    "Write engram's structural facts into MEMORY.md (complementary to Anthropic Auto-Dream)"
  )
  .option("-p, --project <path>", "Project directory", ".")
  .option("--dry-run", "Print what would be written without writing", false)
  .action(
    async (opts: { project: string; dryRun: boolean }) => {
      const absProject = pathResolve(opts.project);
      const projectRoot = findProjectRoot(absProject);
      if (!projectRoot) {
        console.error(
          chalk.red(`Not an engram project: ${absProject}`)
        );
        console.error(chalk.dim("Run 'engram init' first."));
        process.exit(1);
      }

      // Gather facts from core APIs
      const [gods, mistakeList, graphStats] = await Promise.all([
        godNodes(projectRoot, 10).catch(() => []),
        mistakes(projectRoot, { limit: 5 }).catch(() => []),
        stats(projectRoot).catch(() => null),
      ]);

      if (!graphStats) {
        console.error(chalk.red("Failed to read graph stats."));
        process.exit(1);
      }

      // Read git branch from .git/HEAD (reuses the logic pattern
      // from the SessionStart handler)
      let branch: string | null = null;
      try {
        const headPath = join(projectRoot, ".git", "HEAD");
        if (existsSync(headPath)) {
          const content = readFileSync(headPath, "utf-8").trim();
          const m = content.match(/^ref:\s+refs\/heads\/(.+)$/);
          if (m) branch = m[1];
        }
      } catch {
        /* branch stays null */
      }

      const section = buildEngramSection({
        projectName: basename(projectRoot),
        branch,
        stats: {
          nodes: graphStats.nodes,
          edges: graphStats.edges,
          extractedPct: graphStats.extractedPct,
        },
        godNodes: gods,
        landmines: mistakeList.map((m) => ({
          label: m.label,
          sourceFile: m.sourceFile,
        })),
        lastMined: graphStats.lastMined,
      });

      console.log(
        chalk.bold(`\n📝 engram memory-sync`)
      );
      console.log(
        chalk.dim(`   Target: ${join(projectRoot, "MEMORY.md")}`)
      );

      if (opts.dryRun) {
        console.log(chalk.cyan("\n   Section to write (dry-run):\n"));
        console.log(
          section
            .split("\n")
            .map((l) => "     " + l)
            .join("\n")
        );
        console.log(chalk.dim("\n   (dry-run — no changes written)"));
        return;
      }

      const ok = writeEngramSectionToMemoryMd(projectRoot, section);
      if (!ok) {
        console.error(
          chalk.red(
            "\n   ❌ Write failed. MEMORY.md may be too large, or the engram section exceeded its size cap."
          )
        );
        process.exit(1);
      }

      console.log(
        chalk.green(
          `\n   ✅ Synced ${gods.length} god nodes${mistakeList.length > 0 ? ` and ${mistakeList.length} landmines` : ""} to MEMORY.md`
        )
      );
      console.log(
        chalk.dim(
          `\n   Next: Anthropic's Auto-Dream will consolidate this alongside its prose entries.\n`
        )
      );
    }
  );

program.parse();
