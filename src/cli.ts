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
import { fileURLToPath } from "node:url";
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
import { formatThousands } from "./graph/render-utils.js";
import { autogen } from "./autogen.js";
import { dispatchHook } from "./intercept/dispatch.js";
import {
  watchProject,
  syncFile,
  formatReindexLine,
  runReindexHook,
} from "./watcher.js";
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
import { getComponentStatus, formatHudStatus } from "./intercept/component-status.js";
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
  .option("--from-ccs", "Import .context/index.md (CCS) into graph after init")
  .option(
    "--incremental",
    "Skip unchanged files (mtime-based). Dramatically faster on re-index of large repos."
  )
  .option(
    "--with-hook",
    "Also install the Sentinel hook into Claude Code settings.local.json (idempotent)"
  )
  .action(async (projectPath: string, opts: { withSkills?: string | boolean; fromCcs?: boolean; incremental?: boolean; withHook?: boolean }) => {
    console.log(chalk.dim(opts.incremental ? "🔍 Scanning changed files..." : "🔍 Scanning codebase..."));
    const result = await init(projectPath, {
      withSkills: opts.withSkills,
      incremental: opts.incremental,
    });
    console.log(
      chalk.green("🌳 AST extraction complete") +
        chalk.dim(` (${result.timeMs}ms, 0 tokens used)`)
    );
    console.log(
      `   ${chalk.bold(String(result.nodes))} nodes, ${chalk.bold(String(result.edges))} edges from ${chalk.bold(String(result.fileCount))} files (${formatThousands(result.totalLines)} lines)`
    );
    if (result.incremental && result.skippedFiles && result.skippedFiles > 0) {
      console.log(chalk.dim(`   ${result.skippedFiles} unchanged files skipped (incremental mode)`));
    }
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
        chalk.dim(`   Full corpus: ~${formatThousands(bench.naiveFullCorpus)} tokens | Graph query: ~${formatThousands(bench.avgQueryTokens)} tokens`)
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

    if (opts.withHook) {
      // --with-hook shorthand: run install-hook for local scope after init.
      // Idempotent — skips cleanly if already installed.
      const localSettingsPath = join(
        pathResolve(projectPath),
        ".claude",
        "settings.local.json"
      );
      let settings: ClaudeCodeSettings = {};
      if (existsSync(localSettingsPath)) {
        try {
          const raw = readFileSync(localSettingsPath, "utf-8");
          settings = raw.trim() ? (JSON.parse(raw) as ClaudeCodeSettings) : {};
        } catch {
          console.log(
            chalk.yellow(
              "\n   ⚠ --with-hook: settings.local.json is invalid JSON, skipping hook install."
            )
          );
          settings = {};
        }
      }
      const hookResult = installEngramHooks(settings);
      if (hookResult.added.length > 0 || hookResult.statusLineAdded) {
        try {
          mkdirSync(dirname(localSettingsPath), { recursive: true });
          writeFileSync(
            localSettingsPath,
            JSON.stringify(hookResult.updated, null, 2) + "\n"
          );
          console.log(
            chalk.green(
              `\n   ✅ --with-hook: installed ${hookResult.added.length} hook event${hookResult.added.length === 1 ? "" : "s"} into .claude/settings.local.json`
            )
          );
        } catch (err) {
          console.log(
            chalk.yellow(
              `\n   ⚠ --with-hook: write failed (${(err as Error).message})`
            )
          );
        }
      } else {
        console.log(
          chalk.dim(
            "\n   --with-hook: Sentinel hook already installed, nothing to do."
          )
        );
      }
    }

    if (opts.fromCcs) {
      const { importCcs } = await import("./ccs/importer.js");
      const resolvedProjectPath = pathResolve(projectPath);
      const ccsResult = await importCcs(resolvedProjectPath);
      if (ccsResult.nodesCreated > 0) {
        console.log(
          chalk.cyan(
            `   ${ccsResult.nodesCreated} nodes imported from .context/index.md`
          )
        );
      } else {
        console.log(chalk.dim("   --from-ccs: no .context/index.md found, skipping"));
      }
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
      onDelete: (filePath, prunedCount) => {
        console.log(
          chalk.yellow("  × ") +
            chalk.white(filePath) +
            chalk.dim(` pruned (${prunedCount} nodes)`)
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

/**
 * engram reindex <file> — re-index a single file into the knowledge
 * graph. Primitive for per-edit freshness via Claude Code PostToolUse
 * hooks, editor plugins, or CI ([#8](https://github.com/NickCirv/engram/issues/8)).
 *
 * Shares `syncFile()` with `engram watch`, so semantics match: exists
 * → reindex; missing-but-previously-indexed → prune; unsupported ext or
 * ignored dir → silent skip. Silent skips keep stdout/stderr clean so
 * the command is safe to fire on every edit from a hook.
 */
program
  .command("reindex")
  .description("Re-index a single file into the knowledge graph")
  .argument("<file>", "File path (absolute or relative to --project)")
  .option("-p, --project <path>", "Project directory", ".")
  .option("--verbose", "Print stack traces on error", false)
  .action(
    async (file: string, opts: { project: string; verbose: boolean }) => {
      const root = pathResolve(opts.project);
      if (!existsSync(join(root, ".engram", "graph.db"))) {
        console.error(
          `engram: no graph found at ${root}. Run 'engram init' first.`
        );
        process.exit(1);
      }
      const absFile = pathResolve(root, file);
      try {
        const result = await syncFile(absFile, root);
        const line = formatReindexLine(result, file);
        if (line !== null) console.log(line);
        process.exitCode = 0;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`engram: ${msg}`);
        if (opts.verbose && err instanceof Error && err.stack) {
          console.error(err.stack);
        }
        process.exit(1);
      }
    }
  );

/**
 * engram reindex-hook — PostToolUse hook entry point for the optional
 * auto-reindex wiring ([#8](https://github.com/NickCirv/engram/issues/8)).
 * Reads Claude Code's JSON payload from stdin, extracts
 * `tool_input.file_path`, and delegates to `syncFile` (via
 * `runReindexHook`). ALWAYS exits 0 — never blocks the hook.
 *
 * Shape contract matches `engram intercept`: bounded stdin read with a
 * 3s watchdog, swallows parse errors, and sets `process.exitCode = 0`
 * without calling `process.exit` so sql.js's WASM handle can drain
 * cleanly (see the note on `intercept`).
 */
program
  .command("reindex-hook")
  .description(
    "PostToolUse hook entry point: reads JSON from stdin, reindexes tool_input.file_path (always exits 0)"
  )
  .action(async () => {
    const stdinTimeout = setTimeout(() => {
      process.exit(0);
    }, 3000);
    stdinTimeout.unref();

    let input = "";
    let stdinFailed = false;
    try {
      for await (const chunk of process.stdin) {
        input += chunk;
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
      await runReindexHook(payload);
    } catch {
      // runReindexHook already swallows errors; this is belt-and-braces.
    }

    process.exitCode = 0;
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

      // Append component status if any components are active
      const status = getComponentStatus(resolvedPath);
      const statusSuffix = formatHudStatus(status);
      const label = statusSuffix
        ? `⚡engram ${formatted} saved ${bar} ${hitRate}% | ${statusSuffix}`
        : `⚡engram ${formatted} saved ${bar} ${hitRate}%`;
      console.log(JSON.stringify({ label }));
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
      console.log(`    Full corpus:   ~${formatThousands(bench.naiveFullCorpus)} tokens`);
      console.log(`    Avg query:     ~${formatThousands(bench.avgQueryTokens)} tokens`);
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
    console.log(`  Full corpus:     ~${formatThousands(result.naiveFullCorpus)} tokens`);
    console.log(`  Avg graph query: ~${formatThousands(result.avgQueryTokens)} tokens`);
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
  .description(
    "Generate CLAUDE.md + AGENTS.md (default) or a single file via --target"
  )
  .option("-p, --project <path>", "Project directory", ".")
  .option(
    "-t, --target <type>",
    "Single-file target: claude, cursor, agents. Default: emit both CLAUDE.md and AGENTS.md."
  )
  .option(
    "--task <name>",
    "Task-aware view: general (default), bug-fix, feature, refactor"
  )
  .action(
    async (opts: { project: string; target?: string; task?: string }) => {
      const target = opts.target as "claude" | "cursor" | "agents" | undefined;
      const result = await autogen(opts.project, target, opts.task);
      const fileList = result.files.map((f) => chalk.bold(f)).join(", ");
      console.log(
        chalk.green(
          `✅ Updated ${fileList} (${result.nodesIncluded} nodes, view: ${result.view})`
        )
      );
    }
  );

// ── cursor MDC generator ─────────────────────────────────────────────────────
program
  .command("gen-mdc")
  .description("Generate .cursor/rules/engram-context.mdc from knowledge graph")
  .option("-p, --project <path>", "Project directory", ".")
  .option("--watch", "Regenerate on graph changes")
  .action(async (opts: { project: string; watch?: boolean }) => {
    const { generateCursorMdc } = await import("./generators/cursor-mdc.js");
    const result = await generateCursorMdc(opts.project);
    console.log(
      chalk.green(
        `✅ Generated ${result.filePath} (${result.sections} sections, ${result.nodes} nodes)`
      )
    );
    if (opts.watch) {
      watchProject(pathResolve(opts.project), {
        onReindex: async () => {
          const r = await generateCursorMdc(opts.project);
          console.log(chalk.dim(`  ↻ Regenerated MDC (${r.nodes} nodes)`));
        },
        onDelete: async () => {
          const r = await generateCursorMdc(opts.project);
          console.log(chalk.dim(`  × Regenerated MDC (${r.nodes} nodes)`));
        },
        onError: (err) => console.error(chalk.red(err.message)),
        onReady: () => console.log(chalk.dim("  Watching for changes...")),
      });
      await new Promise(() => {}); // Keep alive
    }
  });

// ── CCS exporter ─────────────────────────────────────────────────────────────
program
  .command("gen-ccs")
  .description("Export knowledge graph as .context/index.md (CCS format)")
  .option("-p, --project <path>", "Project directory", ".")
  .action(async (opts: { project: string }) => {
    const { exportCcs } = await import("./ccs/exporter.js");
    const result = await exportCcs(pathResolve(opts.project));
    console.log(
      chalk.green(
        `✅ Generated ${result.filePath} (${result.sectionsWritten} sections, ${result.nodesExported} nodes)`
      )
    );
  });

// ── aider context generator ──────────────────────────────────────────────────
program
  .command("gen-aider")
  .description("Generate .aider-context.md from knowledge graph")
  .option("-p, --project <path>", "Project directory", ".")
  .option("--watch", "Regenerate on graph changes")
  .action(async (opts: { project: string; watch?: boolean }) => {
    const { generateAiderContext } = await import("./generators/aider-context.js");
    const result = await generateAiderContext(pathResolve(opts.project));
    console.log(
      chalk.green(
        `✅ Generated ${result.filePath} (${result.sections} sections, ${result.nodes} nodes)`
      )
    );
    if (opts.watch) {
      watchProject(pathResolve(opts.project), {
        onReindex: async () => {
          const r = await generateAiderContext(opts.project);
          console.log(chalk.dim(`  ↻ Regenerated .aider-context.md (${r.nodes} nodes)`));
        },
        onDelete: async () => {
          const r = await generateAiderContext(opts.project);
          console.log(chalk.dim(`  × Regenerated .aider-context.md (${r.nodes} nodes)`));
        },
        onError: (err) => console.error(chalk.red(err.message)),
        onReady: () => console.log(chalk.dim("  Watching for changes...")),
      });
      await new Promise(() => {}); // Keep alive
    }
  });

// ── Windsurf (Codeium) rules generator ──────────────────────────────────────
program
  .command("gen-windsurfrules")
  .description("Generate .windsurfrules from knowledge graph (Windsurf IDE)")
  .option("-p, --project <path>", "Project directory", ".")
  .option("--watch", "Regenerate on graph changes")
  .action(async (opts: { project: string; watch?: boolean }) => {
    const { generateWindsurfRules } = await import("./generators/windsurf-rules.js");
    const result = await generateWindsurfRules(pathResolve(opts.project));
    console.log(
      chalk.green(
        `✅ Generated ${result.filePath} (${result.sections} sections, ${result.nodes} nodes)`
      )
    );
    if (opts.watch) {
      watchProject(pathResolve(opts.project), {
        onReindex: async () => {
          const r = await generateWindsurfRules(opts.project);
          console.log(chalk.dim(`  ↻ Regenerated .windsurfrules (${r.nodes} nodes)`));
        },
        onDelete: async () => {
          const r = await generateWindsurfRules(opts.project);
          console.log(chalk.dim(`  × Regenerated .windsurfrules (${r.nodes} nodes)`));
        },
        onError: (err) => console.error(chalk.red(err.message)),
        onReady: () => console.log(chalk.dim("  Watching for changes...")),
      });
      await new Promise(() => {}); // Keep alive
    }
  });

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
  .option(
    "--auto-reindex",
    "Also register a PostToolUse Edit|Write|MultiEdit entry calling 'engram reindex-hook' (keeps graph fresh after every edit, #8)",
    false
  )
  .action(
    async (opts: {
      scope: string;
      dryRun: boolean;
      project: string;
      autoReindex: boolean;
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

      const result = installEngramHooks(existing, undefined, {
        autoReindex: opts.autoReindex,
      });

      console.log(
        chalk.bold(`\n📌 engram install-hook (scope: ${opts.scope})`)
      );
      console.log(chalk.dim(`   Target: ${settingsPath}`));
      if (opts.autoReindex) {
        console.log(
          chalk.dim("   Auto-reindex: enabled (engram reindex-hook)")
        );
      }

      if (
        result.added.length === 0 &&
        !result.statusLineAdded &&
        !result.autoReindexAdded
      ) {
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

      if (result.added.length > 0) {
        console.log(
          chalk.green(
            `\n   ✅ Installed ${result.added.length} hook event${result.added.length === 1 ? "" : "s"}: ${result.added.join(", ")}`
          )
        );
      }
      if (result.statusLineAdded) {
        console.log(
          chalk.green("   ✅ StatusLine: engram hud-label (HUD visible in Claude Code)")
        );
      }
      if (result.autoReindexAdded) {
        console.log(
          chalk.green(
            "   ✅ PostToolUse: engram reindex-hook (matcher: Edit|Write|MultiEdit)"
          )
        );
      }
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

    if (result.removed.length === 0 && !result.statusLineRemoved) {
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
      if (result.removed.length > 0) {
        console.log(
          chalk.green(
            `\n   ✅ Removed engram hooks from ${result.removed.length} event${result.removed.length === 1 ? "" : "s"}: ${result.removed.join(", ")}`
          )
        );
      }
      if (result.statusLineRemoved) {
        console.log(
          chalk.green("   ✅ Removed engram statusLine (HUD)")
        );
      }
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

program
  .command("stress-test")
  .description("Run stress tests: memory, concurrency, large-graph, hook-log replay")
  .option("--reads <n>", "Rapid-reads test: call resolveRichPacket N times", parseInt)
  .option("--providers", "Concurrency test: 50 parallel resolveRichPacket calls")
  .option("--large-graph", "Large-graph test: insert N synthetic nodes and query")
  .option("--nodes <n>", "Node count for --large-graph (default 1000)", parseInt)
  .option("--replay <path>", "Hook-log replay: path to hook-log.jsonl")
  .option("--limit <n>", "Entry limit for --replay (default 500)", parseInt)
  .action(async (opts: {
    reads?: number;
    providers?: boolean;
    largeGraph?: boolean;
    nodes?: number;
    replay?: string;
    limit?: number;
  }) => {
    // Invoke stress-test via subprocess to avoid rootDir constraint
    // (bench/ is outside src/ rootDir)
    const { execFileSync } = await import("node:child_process");
    const args = ["bench/stress-test.ts"];
    if (opts.reads) args.push("--reads", String(opts.reads));
    if (opts.providers) args.push("--providers");
    if (opts.largeGraph) args.push("--large-graph");
    if (opts.nodes) args.push("--nodes", String(opts.nodes));
    if (opts.replay) args.push("--replay", opts.replay);
    if (opts.limit) args.push("--limit", String(opts.limit));
    try {
      execFileSync("npx", ["tsx", ...args], { stdio: "inherit", shell: true, cwd: join(dirname(fileURLToPath(import.meta.url)), "..") });
    } catch {
      process.exit(1);
    }
  });

program
  .command("server")
  .description("Start engram HTTP REST server (binds to 127.0.0.1 only)")
  .option("--http", "Enable HTTP server (default)")
  .option("--port <port>", "HTTP port", "7337")
  .option("-p, --project <path>", "Project directory", ".")
  .action(async (opts: { http?: boolean; port: string; project: string }) => {
    const { startHttpServer } = await import("./server/index.js");
    await startHttpServer(pathResolve(opts.project), parseInt(opts.port, 10));
  });

/**
 * engram ui — starts the HTTP server (if not already running) and opens
 * the web dashboard in the user's default browser.
 */
program
  .command("ui")
  .description("Open the web dashboard (auto-starts HTTP server if needed)")
  .option("--port <port>", "HTTP port", "7337")
  .option("-p, --project <path>", "Project directory", ".")
  .option("--no-open", "Don't launch browser, just print the URL")
  .action(async (opts: { port: string; project: string; open?: boolean }) => {
    const port = parseInt(opts.port, 10);
    const publicUrl = `http://127.0.0.1:${port}/ui`;
    const projectRoot = pathResolve(opts.project);

    // Check if server already running (PID file check)
    const { existsSync, readFileSync } = await import("node:fs");
    const pidPath = join(projectRoot, ".engram", "http-server.pid");
    let alreadyRunning = false;

    if (existsSync(pidPath)) {
      try {
        const pid = parseInt(readFileSync(pidPath, "utf-8"), 10);
        // process.kill(pid, 0) throws if the process doesn't exist
        process.kill(pid, 0);
        alreadyRunning = true;
      } catch {
        // Stale PID — server not actually running
      }
    }

    if (alreadyRunning) {
      console.log(chalk.dim(`engram server already running — opening ${publicUrl}`));
    } else {
      console.log(chalk.dim(`Starting engram server on ${publicUrl}...`));
      // Spawn server as detached background process
      const { spawn } = await import("node:child_process");
      const child = spawn(
        process.argv[0],
        [process.argv[1], "server", "--port", String(port), "-p", projectRoot],
        { detached: true, stdio: "ignore" }
      );
      child.unref();

      // Wait briefly for server to come up
      await new Promise((r) => setTimeout(r, 500));
    }

    // Resolve the server token so we can bootstrap the browser's HttpOnly
    // cookie via the one-shot /ui?token=<t> redirect. The token is the same
    // one the server will accept — env var first, then the persisted file.
    const { getOrCreateToken } = await import("./server/auth.js");
    const { token } = getOrCreateToken();
    const bootUrl = `${publicUrl}?token=${encodeURIComponent(token)}`;

    console.log(chalk.green(`✓ Dashboard: ${publicUrl}`));

    if (opts.open !== false) {
      const { platform } = process;
      const opener =
        platform === "darwin" ? "open" :
        platform === "win32" ? "start" : "xdg-open";
      try {
        const { execFile } = await import("node:child_process");
        execFile(opener, [bootUrl], { shell: platform === "win32" }, () => {
          // fire-and-forget — browser launch is best-effort
        });
      } catch {
        // Couldn't open browser — print the bootstrap URL so the user
        // can copy it into their own browser.
        console.log(chalk.dim(`  Open manually: ${bootUrl}`));
      }
    }
  });

program
  .command("context-server")
  .description("Start Zed-compatible context server (JSON-RPC over stdio)")
  .action(async () => {
    const { execFileSync } = await import("node:child_process");
    try {
      execFileSync("npx", ["tsx", "adapters/zed/index.ts"], {
        stdio: "inherit",
        shell: true,
        cwd: join(dirname(fileURLToPath(import.meta.url)), ".."),
      });
    } catch {
      process.exit(1);
    }
  });

/**
 * engram tune — analyse hook-log.jsonl and propose (or apply) changes
 * to the per-project config (.engram/config.json).
 */
program
  .command("tune")
  .description("Analyze hook-log and propose provider config changes")
  .option("-p, --project <path>", "Project directory", ".")
  .option("--dry-run", "Show proposed changes without applying (default)")
  .option("--apply", "Apply proposed changes to .engram/config.json")
  .action(async (opts: { project: string; dryRun?: boolean; apply?: boolean }) => {
    const { analyzeTuning, applyTuning } = await import("./tuner/index.js");
    const proposal = analyzeTuning(pathResolve(opts.project));

    if (proposal.changes.length === 0) {
      console.log(
        chalk.dim(
          `Analyzed ${proposal.entriesAnalyzed} entries (${proposal.daysSpanned} days) — no changes suggested.`
        )
      );
      return;
    }

    console.log(
      chalk.bold(
        `Analyzing ${proposal.entriesAnalyzed} hook-log entries from last ${proposal.daysSpanned} days...\n`
      )
    );
    console.log(chalk.bold("Proposed changes:"));
    for (const c of proposal.changes) {
      console.log(
        `  ${c.field}: ${chalk.red(String(c.current))} → ${chalk.green(String(c.proposed))} — ${chalk.dim(c.reason)}`
      );
    }

    if (opts.apply) {
      applyTuning(pathResolve(opts.project), proposal);
      console.log(chalk.green("\n✅ Changes applied to .engram/config.json"));
    } else {
      console.log(chalk.dim("\nRun with --apply to write these changes."));
    }
  });

// ── db: schema versioning and migration management ────────────────────────────
const dbCmd = program.command("db").description("Database management");

dbCmd
  .command("status")
  .description("Show schema version and migration status")
  .option("-p, --project <path>", "Project directory", ".")
  .action(async (opts: { project: string }) => {
    const { getStore } = await import("./core.js");
    const { CURRENT_SCHEMA_VERSION, getSchemaVersion } = await import("./db/migrate.js");
    const store = await getStore(pathResolve(opts.project));
    try {
      const version = getSchemaVersion((store as unknown as { db: Parameters<typeof getSchemaVersion>[0] }).db);
      const pending = CURRENT_SCHEMA_VERSION - version;
      console.log(`Schema version: ${version} (current: ${CURRENT_SCHEMA_VERSION})`);
      if (pending > 0) {
        console.log(chalk.yellow(`${pending} pending migration(s). Run 'engram db migrate' to update.`));
      } else {
        console.log(chalk.green("Up to date."));
      }
    } finally {
      store.close();
    }
  });

dbCmd
  .command("migrate")
  .description("Run pending schema migrations")
  .option("-p, --project <path>", "Project directory", ".")
  .action(async (opts: { project: string }) => {
    const { getStore } = await import("./core.js");
    const { runMigrations } = await import("./db/migrate.js");
    const store = await getStore(pathResolve(opts.project));
    try {
      const dbPath = join(pathResolve(opts.project), ".engram", "graph.db");
      const result = runMigrations(
        (store as unknown as { db: Parameters<typeof runMigrations>[0] }).db,
        dbPath
      );
      store.save();
      if (result.migrationsRun === 0) {
        console.log(chalk.green("Already up to date."));
      } else {
        console.log(
          chalk.green(`Migrated v${result.fromVersion} → v${result.toVersion} (${result.migrationsRun} migrations)`)
        );
        if (result.backedUp) {
          console.log(chalk.dim("Backup created."));
        }
      }
    } finally {
      store.close();
    }
  });

dbCmd
  .command("rollback")
  .description("Roll back to an earlier schema version (DESTRUCTIVE — always backs up first)")
  .option("-p, --project <path>", "Project directory", ".")
  .option("--to <version>", "Target schema version (0 drops all tables)")
  .option("--yes", "Skip confirmation prompt")
  .action(async (opts: { project: string; to?: string; yes?: boolean }) => {
    if (opts.to === undefined) {
      console.error(chalk.red("Required: --to <version>"));
      console.log(chalk.dim("Run 'engram db status' to see current version."));
      process.exit(1);
    }
    const target = parseInt(opts.to, 10);
    if (isNaN(target)) {
      console.error(chalk.red(`Invalid version: ${opts.to}`));
      process.exit(1);
    }

    const { getStore } = await import("./core.js");
    const { rollback, getSchemaVersion } = await import("./db/migrate.js");
    const store = await getStore(pathResolve(opts.project));
    try {
      const dbPath = join(pathResolve(opts.project), ".engram", "graph.db");
      const current = getSchemaVersion(
        (store as unknown as { db: Parameters<typeof getSchemaVersion>[0] }).db
      );

      if (target === current) {
        console.log(chalk.green(`Already at v${target}.`));
        return;
      }
      if (target > current) {
        console.error(
          chalk.red(`Cannot roll back to v${target}: current is v${current}.`)
        );
        console.log(chalk.dim("Use 'engram db migrate' to move forward."));
        process.exit(1);
      }

      if (!opts.yes) {
        console.log(
          chalk.yellow(
            `⚠  This will roll back from v${current} → v${target}.`
          )
        );
        console.log(
          chalk.yellow(
            `   Tables created after v${target} will be DROPPED (data loss).`
          )
        );
        console.log(chalk.dim(`   A backup will be saved to ${dbPath}.bak-v${current}`));
        console.log(chalk.dim(`   Re-run with --yes to confirm.`));
        process.exit(1);
      }

      const result = rollback(
        (store as unknown as { db: Parameters<typeof rollback>[0] }).db,
        dbPath,
        target
      );
      store.save();
      console.log(
        chalk.green(
          `✓ Rolled back v${result.fromVersion} → v${result.toVersion} (${result.migrationsReverted} migrations reverted)`
        )
      );
      if (result.backedUp) {
        console.log(chalk.dim(`  Backup: ${dbPath}.bak-v${result.fromVersion}`));
      }
    } finally {
      store.close();
    }
  });

// ── plugin: manage third-party context provider plugins ───────────────────────
const pluginCmd = program
  .command("plugin")
  .description("Manage context provider plugins");

pluginCmd
  .command("list")
  .description("List installed provider plugins")
  .action(async () => {
    const { loadPlugins, getPluginsDir, ensurePluginsDir } = await import("./providers/plugin-loader.js");
    const dir = getPluginsDir();
    ensurePluginsDir(dir);
    const { loaded, failed } = await loadPlugins(dir);

    if (loaded.length === 0 && failed.length === 0) {
      console.log(chalk.dim(`No plugins installed.`));
      console.log(chalk.dim(`Install with: engram plugin install <file.mjs>`));
      console.log(chalk.dim(`Plugins directory: ${dir}`));
      return;
    }

    if (loaded.length > 0) {
      console.log(chalk.bold(`Installed plugins (${loaded.length})`));
      console.log(chalk.dim("───────────────────────────────────"));
      for (const p of loaded) {
        const tierLabel = p.tier === 1 ? "internal" : "external";
        const descr = p.description ? ` — ${p.description}` : "";
        console.log(
          `  ${chalk.green("●")} ${chalk.bold(p.name)} ${chalk.dim(`v${p.version}`)} ` +
            chalk.dim(`[${tierLabel}, ${p.tokenBudget}tok budget]`)
        );
        if (descr) console.log(`    ${chalk.dim(descr.trim())}`);
      }
    }

    if (failed.length > 0) {
      console.log();
      console.log(chalk.yellow(`Failed to load (${failed.length}):`));
      for (const f of failed) {
        console.log(`  ${chalk.red("✗")} ${f.file} ${chalk.dim(`— ${f.reason}`)}`);
      }
    }
  });

pluginCmd
  .command("install")
  .description("Install a plugin by copying its .mjs file into ~/.engram/plugins/")
  .argument("<file>", "Path to plugin .mjs file")
  .action(async (file: string) => {
    const { copyFileSync, statSync } = await import("node:fs");
    const { basename } = await import("node:path");
    const { getPluginsDir, ensurePluginsDir, validatePlugin } = await import("./providers/plugin-loader.js");
    const { pathToFileURL } = await import("node:url");

    const absPath = pathResolve(file);
    if (!existsSync(absPath)) {
      console.error(chalk.red(`File not found: ${absPath}`));
      process.exit(1);
    }
    if (!statSync(absPath).isFile()) {
      console.error(chalk.red(`Not a file: ${absPath}`));
      process.exit(1);
    }
    if (!absPath.endsWith(".mjs") && !absPath.endsWith(".js")) {
      console.error(chalk.red(`Plugin must be .mjs or .js (got ${absPath})`));
      process.exit(1);
    }

    // Validate shape before copying — refuse to install a broken plugin
    try {
      const mod = (await import(pathToFileURL(absPath).href)) as unknown;
      const { plugin, reason } = validatePlugin(mod);
      if (!plugin) {
        console.error(chalk.red(`Invalid plugin: ${reason}`));
        process.exit(1);
      }
      console.log(
        chalk.dim(`Validated ${plugin.name} v${plugin.version} (tier ${plugin.tier})`)
      );
    } catch (e) {
      console.error(chalk.red(`Failed to load plugin: ${(e as Error).message}`));
      process.exit(1);
    }

    const pluginsDir = getPluginsDir();
    ensurePluginsDir(pluginsDir);
    const destName = basename(absPath);
    const destPath = join(pluginsDir, destName);
    copyFileSync(absPath, destPath);
    console.log(chalk.green(`✓ Installed: ${destPath}`));
  });

pluginCmd
  .command("remove")
  .description("Remove an installed plugin by filename")
  .argument("<filename>", "Plugin filename (e.g., my-provider.mjs)")
  .action(async (filename: string) => {
    const { getPluginsDir } = await import("./providers/plugin-loader.js");
    const pluginsDir = getPluginsDir();
    const target = join(pluginsDir, filename);
    if (!existsSync(target)) {
      console.error(chalk.red(`No such plugin: ${filename}`));
      console.log(chalk.dim(`Plugins directory: ${pluginsDir}`));
      process.exit(1);
    }
    unlinkSync(target);
    console.log(chalk.green(`✓ Removed: ${filename}`));
  });

// ── cache: inspect and manage the context cache ───────────────────────────────
const cacheCmd = program
  .command("cache")
  .description("Inspect and manage the context cache");

cacheCmd
  .command("stats")
  .description("Show cache hit rate, entries, and LRU sizes")
  .option("-p, --project <path>", "Project directory", ".")
  .action(async (opts: { project: string }) => {
    const { getStore } = await import("./core.js");
    const { getContextCache, ContextCache } = await import("./intelligence/cache.js");
    const store = await getStore(pathResolve(opts.project));
    try {
      ContextCache.ensureTables(store);
      const cache = getContextCache();
      const s = cache.getStats(store);

      const hitRatePct = (s.hitRate * 100).toFixed(1);
      const totalOps = s.totalHits + s.totalMisses;

      console.log(chalk.bold("Cache stats"));
      console.log(chalk.dim("───────────────────────────────────"));
      console.log(
        `  ${chalk.dim("Hit rate")}      ${chalk.green(chalk.bold(hitRatePct + "%"))}  ${chalk.dim(
          `(${s.totalHits} hits / ${totalOps} ops)`
        )}`
      );
      console.log(
        `  ${chalk.dim("Query cache")}   ${chalk.bold(String(s.queryEntries))} entries, ${chalk.green(
          String(s.queryHits)
        )} hits, ${chalk.dim(String(s.queryMisses) + " miss")}`
      );
      console.log(
        `  ${chalk.dim("Pattern cache")} ${chalk.bold(String(s.patternEntries))} entries, ${chalk.green(
          String(s.patternHits)
        )} hits, ${chalk.dim(String(s.patternMisses) + " miss")}`
      );
      console.log(
        `  ${chalk.dim("Hot files")}     ${chalk.bold(String(s.hotFileCount))} warmed`
      );
    } finally {
      store.close();
    }
  });

cacheCmd
  .command("clear")
  .description("Flush all cache layers (query, pattern, hot files)")
  .option("-p, --project <path>", "Project directory", ".")
  .action(async (opts: { project: string }) => {
    const { getStore } = await import("./core.js");
    const { getContextCache, ContextCache } = await import("./intelligence/cache.js");
    const store = await getStore(pathResolve(opts.project));
    try {
      ContextCache.ensureTables(store);
      const cache = getContextCache();
      const before = cache.getStats(store);
      cache.clearAll(store);
      store.save();
      console.log(
        chalk.green(
          `✓ Cleared ${before.queryEntries} query entries, ${before.patternEntries} pattern entries`
        )
      );
    } finally {
      store.close();
    }
  });

cacheCmd
  .command("warm")
  .description("Pre-warm hot file cache from access frequency (top-N)")
  .option("-p, --project <path>", "Project directory", ".")
  .option("-n, --limit <n>", "Number of files to warm", "20")
  .action(async (opts: { project: string; limit: string }) => {
    const { getStore } = await import("./core.js");
    const { getContextCache, ContextCache } = await import("./intelligence/cache.js");
    const store = await getStore(pathResolve(opts.project));
    try {
      ContextCache.ensureTables(store);
      const cache = getContextCache();
      const topN = parseInt(opts.limit, 10) || 20;
      const count = cache.warmHotFiles(store, pathResolve(opts.project), topN);
      if (count === 0) {
        console.log(
          chalk.dim(
            "No files to warm. Cache is empty — run a few Read-intercepted sessions first."
          )
        );
      } else {
        console.log(chalk.green(`✓ Warmed ${count} hot file${count === 1 ? "" : "s"} into LRU`));
      }
    } finally {
      store.close();
    }
  });

// ── v2.1: update + doctor + setup ─────────────────────────────────────────────

/**
 * engram update — check for and install a newer engram version via the
 * detected package manager (npm / pnpm / yarn / bun).
 *
 * Zero telemetry: the one network call is an anonymous GET to
 * registry.npmjs.org. `--check` shows "v2.1.0 available" without
 * installing. `ENGRAM_NO_UPDATE_CHECK=1` and `$CI` disable the passive
 * notify that runs on every other invocation.
 */
program
  .command("update")
  .description("Check for and install the latest engram release")
  .option("--check", "Check only — do not install", false)
  .option("--force", "Bypass 7-day throttle cache on registry check", false)
  .option(
    "--manager <mgr>",
    "Override package manager detection (npm | pnpm | yarn | bun)"
  )
  .option("--dry-run", "Print the upgrade command without executing", false)
  .action(
    async (opts: {
      check: boolean;
      force: boolean;
      manager?: string;
      dryRun: boolean;
    }) => {
      const { checkForUpdate } = await import("./update/check.js");
      const result = await checkForUpdate(PKG_VERSION, { force: opts.force });

      if (result.skipped) {
        if (result.fromCache === false) {
          console.log(
            chalk.dim("Skipped (opt-out via ENGRAM_NO_UPDATE_CHECK or $CI).")
          );
        } else {
          console.log(chalk.dim("Skipped (registry unreachable)."));
        }
        return;
      }

      const ageMin = result.checkedAt
        ? Math.round((Date.now() - result.checkedAt) / 60000)
        : 0;
      const freshness = result.fromCache
        ? chalk.dim(` (cached ${ageMin}m ago)`)
        : chalk.dim(" (live)");

      console.log(
        `${chalk.bold("engram")} ${chalk.dim("installed:")} v${result.current}   ${chalk.dim("latest:")} ${
          result.latest ?? chalk.yellow("unknown")
        }${freshness}`
      );

      if (!result.updateAvailable) {
        console.log(chalk.green("✓ You are on the latest release."));
        return;
      }

      console.log(
        chalk.yellow(
          `⬆ v${result.latest} is available — you're on v${result.current}.`
        )
      );

      if (opts.check) {
        console.log(chalk.dim("Run `engram update` to install it."));
        return;
      }

      const { runUpgrade, manualCommand } = await import(
        "./update/install.js"
      );
      const outcome = runUpgrade({
        dryRun: opts.dryRun,
        manager:
          opts.manager === "npm" ||
          opts.manager === "pnpm" ||
          opts.manager === "yarn" ||
          opts.manager === "bun"
            ? opts.manager
            : undefined,
      });

      if (outcome.ok) {
        console.log(chalk.green(`✓ ${outcome.message}`));
        if (!opts.dryRun) {
          console.log(chalk.dim("  Run `engram --version` to verify."));
        }
      } else {
        console.error(chalk.red(`✗ ${outcome.message}`));
        if (outcome.stderrTail) {
          console.error(chalk.dim(outcome.stderrTail));
        }
        console.error(chalk.dim(`  Manual: ${manualCommand()}`));
        process.exitCode = 1;
      }
    }
  );

/**
 * engram doctor — report on component health + remediation hints.
 *
 * Wraps component-status probes + graph-db + hook + version checks into
 * a single human report. Exit code reflects severity (0 ok, 1 warn,
 * 2 fail), CI-friendly.
 */
program
  .command("doctor")
  .description("Component health report with remediation hints")
  .option("-p, --project <path>", "Project directory", ".")
  .option("-v, --verbose", "Show remediation hints for warn/fail checks", false)
  .option("--json", "Output JSON", false)
  .option(
    "--export",
    "Redacted JSON for bug reports (same as --json with --verbose)",
    false
  )
  .action(
    async (opts: {
      project: string;
      verbose: boolean;
      json: boolean;
      export: boolean;
    }) => {
      const { buildReport, formatReport, exportReport } = await import(
        "./doctor/report.js"
      );
      const root = pathResolve(opts.project);
      const report = buildReport(root, PKG_VERSION);

      if (opts.json || opts.export) {
        console.log(exportReport(report));
      } else {
        console.log(formatReport(report, opts.verbose));
      }

      process.exitCode =
        report.overallSeverity === "ok"
          ? 0
          : report.overallSeverity === "warn"
            ? 1
            : 2;
    }
  );

/**
 * engram setup — first-run wizard. One command for zero-friction install.
 *
 * Steps: init → install-hook → detect IDEs → doctor. Each step idempotent.
 * `--yes` runs with defaults; `--dry-run` prints intent without acting.
 */
program
  .command("setup")
  .description("Zero-friction first-run wizard (init + install-hook + doctor)")
  .option("-p, --project <path>", "Project directory", ".")
  .option("-y, --yes", "Accept all defaults (non-interactive)", false)
  .option("--dry-run", "Print what would happen without touching anything", false)
  .option(
    "--scope <scope>",
    "Hook scope for install-hook step (local | project | user)",
    "local"
  )
  .action(
    async (opts: {
      project: string;
      yes: boolean;
      dryRun: boolean;
      scope: string;
    }) => {
      const { runSetup } = await import("./setup/wizard.js");
      const scope =
        opts.scope === "local" ||
        opts.scope === "project" ||
        opts.scope === "user"
          ? opts.scope
          : "local";
      const result = await runSetup({
        projectPath: opts.project,
        yes: opts.yes,
        dryRun: opts.dryRun,
        engramVersion: PKG_VERSION,
        settingsScope: scope,
      });
      process.exitCode = result.exitCode;
    }
  );

// ── First-run hint (only for non-init, non-intercept commands) ────────────────
// Show once per repo if there's no .engram/graph.db yet. Skipped in CI, under
// JSON-stdout commands, and inside the hook intercept entrypoint.
const FIRST_RUN_SILENT_CMDS = new Set([
  "intercept",
  "cursor-intercept",
  "hud-label",
  "setup",
  "init",
  "update",
  "doctor",
]);

function maybePrintFirstRunHint(): void {
  if (process.env.CI) return;
  if (process.env.ENGRAM_NO_UPDATE_CHECK === "1") return;
  const subcommand = process.argv[2];
  if (!subcommand) return;
  if (FIRST_RUN_SILENT_CMDS.has(subcommand)) return;

  try {
    const cwd = process.cwd();
    if (existsSync(join(cwd, ".engram", "graph.db"))) return;

    const sentinel = join(homedir(), ".engram", "first-run-shown");
    if (existsSync(sentinel)) return;

    mkdirSync(dirname(sentinel), { recursive: true });
    writeFileSync(sentinel, new Date().toISOString(), "utf-8");

    process.stderr.write(
      chalk.dim("💡 ") +
        chalk.yellow("First time in this repo?") +
        chalk.dim(" Run ") +
        chalk.white("engram setup") +
        chalk.dim(" for a zero-friction install.\n")
    );
  } catch {
    /* best-effort */
  }
}

// Passive update notify — at most one line per process, never in intercept.
function maybePrintUpdateHintSafe(): void {
  const subcommand = process.argv[2];
  if (!subcommand || FIRST_RUN_SILENT_CMDS.has(subcommand)) return;
  try {
    // Dynamic import avoids a hard dependency at bundle init time.
    import("./update/notify.js")
      .then((m) => m.maybePrintUpdateHint(PKG_VERSION))
      .catch(() => {});
  } catch {
    /* ignore */
  }
}

maybePrintFirstRunHint();
maybePrintUpdateHintSafe();

program.parse();
