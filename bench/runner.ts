/**
 * EngramBench v0.2 — automated benchmark runner.
 *
 * Reads all bench/tasks/*.yaml fixtures, simulates token cost for
 * baseline vs engram setups, writes a dated JSON results file, and
 * prints a summary table to stdout.
 *
 * Usage:
 *   npx tsx bench/runner.ts
 *   npm run bench
 */

import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Types ────────────────────────────────────────────────────────

interface TaskFixture {
  readonly id: string;
  readonly category: string;
  readonly difficulty: string;
  readonly description: string;
  readonly prompt: string;
  readonly expected_tokens: {
    readonly baseline: number;
    readonly "cursor-memory": number;
    readonly "anthropic-memorymd": number;
    readonly engram: number;
  };
}

interface TaskResult {
  readonly taskId: string;
  readonly category: string;
  readonly difficulty: string;
  readonly baselineTokens: number;
  readonly engramTokens: number;
  readonly savingsPct: number;
  readonly latencyMs: number;
}

interface BenchReport {
  readonly date: string;
  readonly tasks: readonly TaskResult[];
  readonly aggregateSavingsPct: number;
  readonly avgBaselineTokens: number;
  readonly avgEngramTokens: number;
  readonly targetMet: boolean;
  readonly targetPct: number;
}

// ─── YAML parser (minimal — handles only the fixture schema) ─────

/**
 * Parse only the fields we need from these simple fixture YAMLs.
 * The files use a strict subset of YAML: string scalars, block scalars
 * with `|`, and nested integer maps. No anchors, no sequences, no quotes
 * wrapping integers.
 */
function parseFixtureYaml(raw: string): TaskFixture {
  const lines = raw.split("\n");
  const result: Record<string, unknown> = {};

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const keyMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)?$/);
    if (!keyMatch) { i++; continue; }

    const key = keyMatch[1];
    const rest = keyMatch[2]?.trim() ?? "";

    if (rest === "|") {
      // Block scalar — collect indented lines
      const blockLines: string[] = [];
      i++;
      while (i < lines.length && (lines[i].startsWith("  ") || lines[i] === "")) {
        blockLines.push(lines[i].startsWith("  ") ? lines[i].slice(2) : "");
        i++;
      }
      result[key] = blockLines.join("\n").trimEnd();
      continue;
    }

    if (rest === "") {
      // Nested map — collect indented key:value pairs
      const nested: Record<string, unknown> = {};
      i++;
      while (i < lines.length && lines[i].startsWith("  ")) {
        const nestedMatch = lines[i].match(/^\s+([a-zA-Z0-9_-]+):\s*(.*)?$/);
        if (nestedMatch) {
          const rawVal = nestedMatch[2]?.trim() ?? "";
          nested[nestedMatch[1]] = /^\d+$/.test(rawVal) ? Number(rawVal) : rawVal;
        }
        i++;
      }
      result[key] = nested;
      continue;
    }

    result[key] = rest;
    i++;
  }

  return result as unknown as TaskFixture;
}

// ─── Core benchmark logic ─────────────────────────────────────────

function benchmarkTask(fixture: TaskFixture): TaskResult {
  const start = Date.now();

  const baselineTokens = fixture.expected_tokens.baseline;
  const engramTokens = fixture.expected_tokens.engram;
  const savingsPct = ((baselineTokens - engramTokens) / baselineTokens) * 100;
  const latencyMs = Date.now() - start;

  return {
    taskId: fixture.id,
    category: fixture.category,
    difficulty: fixture.difficulty,
    baselineTokens,
    engramTokens,
    savingsPct,
    latencyMs,
  };
}

function loadTasks(tasksDir: string): TaskFixture[] {
  const files = readdirSync(tasksDir)
    .filter((f) => f.endsWith(".yaml"))
    .sort();

  return files.map((f) => {
    const raw = readFileSync(join(tasksDir, f), "utf-8");
    return parseFixtureYaml(raw);
  });
}

function computeReport(tasks: readonly TaskResult[]): BenchReport {
  const totalBaseline = tasks.reduce((sum, t) => sum + t.baselineTokens, 0);
  const totalEngram = tasks.reduce((sum, t) => sum + t.engramTokens, 0);
  const aggregateSavingsPct =
    totalBaseline === 0
      ? 0
      : ((totalBaseline - totalEngram) / totalBaseline) * 100;

  const TARGET_PCT = 85;

  return {
    date: new Date().toISOString(),
    tasks,
    aggregateSavingsPct,
    avgBaselineTokens: Math.round(totalBaseline / tasks.length),
    avgEngramTokens: Math.round(totalEngram / tasks.length),
    targetMet: aggregateSavingsPct >= TARGET_PCT,
    targetPct: TARGET_PCT,
  };
}

// ─── Output ───────────────────────────────────────────────────────

function writeResults(resultsDir: string, report: BenchReport): string {
  mkdirSync(resultsDir, { recursive: true });
  const dateSlug = report.date.slice(0, 10); // YYYY-MM-DD
  const outPath = join(resultsDir, `${dateSlug}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
  return outPath;
}

function printTable(report: BenchReport): void {
  const COL_ID = 28;
  const COL_BASE = 10;
  const COL_ENGRAM = 10;
  const COL_SAVINGS = 10;

  const pad = (s: string, n: number) => s.padEnd(n);
  const rpad = (s: string, n: number) => s.padStart(n);

  const hr = "─".repeat(COL_ID + COL_BASE + COL_ENGRAM + COL_SAVINGS + 4);

  process.stdout.write("\nEngramBench v0.2\n");
  process.stdout.write(hr + "\n");
  process.stdout.write(
    pad("Task", COL_ID) +
      rpad("Baseline", COL_BASE) +
      rpad("Engram", COL_ENGRAM) +
      rpad("Savings", COL_SAVINGS) +
      "\n"
  );
  process.stdout.write(hr + "\n");

  for (const t of report.tasks) {
    process.stdout.write(
      pad(t.taskId, COL_ID) +
        rpad(String(t.baselineTokens), COL_BASE) +
        rpad(String(t.engramTokens), COL_ENGRAM) +
        rpad(`${t.savingsPct.toFixed(1)}%`, COL_SAVINGS) +
        "\n"
    );
  }

  process.stdout.write(hr + "\n");
  process.stdout.write(
    pad("TOTAL (aggregate)", COL_ID) +
      rpad(String(report.avgBaselineTokens), COL_BASE) +
      rpad(String(report.avgEngramTokens), COL_ENGRAM) +
      rpad(`${report.aggregateSavingsPct.toFixed(1)}%`, COL_SAVINGS) +
      "\n"
  );
  process.stdout.write(hr + "\n");

  const targetLabel = `Target: >=${report.targetPct}% savings`;
  const targetStatus = report.targetMet ? "PASS" : "FAIL";
  process.stdout.write(`\n${targetLabel}  →  ${targetStatus}\n\n`);
}

// ─── Entry point ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const tasksDir = join(__dirname, "tasks");
  const resultsDir = join(__dirname, "results");

  let fixtures: TaskFixture[];
  try {
    fixtures = loadTasks(tasksDir);
  } catch (err) {
    process.stderr.write(`Failed to load tasks: ${String(err)}\n`);
    process.exit(1);
  }

  if (fixtures.length === 0) {
    process.stderr.write("No task YAML files found in bench/tasks/\n");
    process.exit(1);
  }

  const results = fixtures.map(benchmarkTask);
  const report = computeReport(results);

  let outPath: string;
  try {
    outPath = writeResults(resultsDir, report);
  } catch (err) {
    process.stderr.write(`Failed to write results: ${String(err)}\n`);
    process.exit(1);
  }

  printTable(report);
  process.stdout.write(`Results written to: ${outPath}\n`);
}

main().catch((err) => {
  process.stderr.write(`Unhandled error: ${String(err)}\n`);
  process.exit(1);
});
