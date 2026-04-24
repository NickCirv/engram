/**
 * EngramBench Real-World — measured token savings on engramx's own codebase.
 *
 * Where `runner.ts` uses YAML-estimated costs (useful for CI regression
 * tracking), this runner PRODUCES ACTUAL NUMBERS by running the full
 * resolver pipeline against real files and comparing to the baseline
 * cost of the agent reading the same file raw.
 *
 * Methodology (kept simple and honest on purpose):
 *
 *   1. Walk the repo, collect N real source files (configurable cap).
 *   2. For each file:
 *      a) baselineTokens = ceil(file.length / 4)        — what the agent
 *                                                          would pay to
 *                                                          Read() the file
 *      b) engramTokens = resolveRichPacket().estimatedTokens
 *         (or 0 if no providers produced output — rare)
 *      c) deltaTokens = baselineTokens - engramTokens
 *      d) savingsPct = (deltaTokens / baselineTokens) * 100
 *   3. Aggregate: total baseline, total engram, weighted savings %.
 *   4. Write JSON to bench/results/real-world-<date>.json.
 *   5. Print a human-readable table + save a markdown report.
 *
 * This is honest arithmetic — if the agent never has to Read the file
 * because engramx hands it a rich packet via PreToolUse deny+reason,
 * the agent pays engramTokens instead of baselineTokens. Per-call savings
 * is the quantity that matters; session savings is #calls × per-call.
 *
 * Usage:
 *   npx tsx bench/real-world.ts [--project PATH] [--files N] [--out PATH]
 *
 *   --project  Path to project to bench. Default: engramx repo root.
 *   --files    Max number of files to sample. Default: 50.
 *   --out      Output directory. Default: bench/results/.
 */
import {
  readdirSync,
  readFileSync,
  statSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Args ───────────────────────────────────────────────────────────

function argOf(name: string, def: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx === process.argv.length - 1) return def;
  return process.argv[idx + 1];
}

const PROJECT = argOf("project", join(__dirname, ".."));
const MAX_FILES = parseInt(argOf("files", "50"), 10);
const OUT_DIR = argOf("out", join(__dirname, "results"));

// ── Supported source extensions ────────────────────────────────────
const SOURCE_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".py",
  ".go",
  ".rs",
]);
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".engram",
  ".git",
  "coverage",
  ".next",
  ".nuxt",
  ".output",
  ".turbo",
  "bench", // skip bench itself to keep the sample focused on the product code
  "tests", // tests are repetitive; sample real source, not fixtures
]);

function collectSourceFiles(root: string, cap: number): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    if (out.length >= cap) return;
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= cap) return;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (entry.isFile()) {
        const dot = entry.name.lastIndexOf(".");
        if (dot < 0) continue;
        const ext = entry.name.slice(dot).toLowerCase();
        if (!SOURCE_EXTS.has(ext)) continue;
        out.push(full);
      }
    }
  }
  walk(root);
  return out;
}

// ── Token estimator — matches engramx's internal heuristic ─────────
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ── Main ───────────────────────────────────────────────────────────

interface FileResult {
  path: string;
  baselineTokens: number;
  engramTokens: number;
  deltaTokens: number;
  savingsPct: number;
  providerCount: number;
}

async function main(): Promise<void> {
  console.log(`EngramBench Real-World`);
  console.log(`────────────────────────────────────────────────────────`);
  console.log(`Project:   ${PROJECT}`);
  console.log(`Sample cap: ${MAX_FILES} files`);
  console.log();

  // 1. Ensure a .engram/graph.db exists (the resolver needs the graph).
  const engramDir = join(PROJECT, ".engram");
  if (!existsSync(join(engramDir, "graph.db"))) {
    console.error(
      `[FATAL] no .engram/graph.db found at ${engramDir}. Run \`engram init\` first.`
    );
    process.exit(1);
  }

  // 2. Collect real files
  const files = collectSourceFiles(PROJECT, MAX_FILES);
  if (files.length === 0) {
    console.error(`[FATAL] no source files found under ${PROJECT}`);
    process.exit(1);
  }
  console.log(`Sampled: ${files.length} files`);
  console.log();

  // 3. Load the resolver
  const { resolveRichPacket } = await import("../src/providers/resolver.js");

  // 4. Measure each file
  const perFile: FileResult[] = [];
  let totalBaseline = 0;
  let totalEngram = 0;

  for (const abs of files) {
    const rel = relative(PROJECT, abs).split(/[\\/]/).join("/");
    let raw = "";
    try {
      raw = readFileSync(abs, "utf-8");
    } catch {
      continue;
    }
    const baselineTokens = estimateTokens(raw);

    const packet = await resolveRichPacket(rel, {
      filePath: rel,
      projectRoot: PROJECT,
      nodeIds: [],
      imports: [],
      hasTests: false,
      churnRate: 0,
    });
    const engramTokens = packet?.estimatedTokens ?? 0;
    const providerCount = packet?.providerCount ?? 0;
    const deltaTokens = Math.max(0, baselineTokens - engramTokens);
    const savingsPct =
      baselineTokens > 0 ? (deltaTokens / baselineTokens) * 100 : 0;

    perFile.push({
      path: rel,
      baselineTokens,
      engramTokens,
      deltaTokens,
      savingsPct,
      providerCount,
    });
    totalBaseline += baselineTokens;
    totalEngram += engramTokens;
  }

  const aggregateSavings =
    totalBaseline > 0 ? ((totalBaseline - totalEngram) / totalBaseline) * 100 : 0;

  // 5. Print table (sort by savingsPct descending — biggest wins first)
  perFile.sort((a, b) => b.savingsPct - a.savingsPct);
  console.log(
    `${"File".padEnd(60)} ${"Baseline".padStart(10)} ${"Engram".padStart(8)} ${"Savings".padStart(10)} ${"Providers".padStart(10)}`
  );
  console.log("─".repeat(102));
  for (const r of perFile.slice(0, 20)) {
    console.log(
      `${r.path.slice(-60).padEnd(60)} ${String(r.baselineTokens).padStart(10)} ${String(r.engramTokens).padStart(8)} ${r.savingsPct.toFixed(1).padStart(9)}% ${String(r.providerCount).padStart(10)}`
    );
  }
  if (perFile.length > 20) {
    console.log(
      `… and ${perFile.length - 20} more files (see JSON for full list)`
    );
  }
  console.log("─".repeat(102));
  console.log(
    `${"TOTAL".padEnd(60)} ${String(totalBaseline).padStart(10)} ${String(totalEngram).padStart(8)} ${aggregateSavings.toFixed(1).padStart(9)}%`
  );
  console.log();

  // 6. Summary stats
  const wins = perFile.filter((r) => r.savingsPct > 0).length;
  const worst = perFile
    .slice()
    .sort((a, b) => a.savingsPct - b.savingsPct)[0];
  const best = perFile.slice().sort((a, b) => b.savingsPct - a.savingsPct)[0];
  const median = (() => {
    const sorted = perFile
      .slice()
      .map((r) => r.savingsPct)
      .sort((a, b) => a - b);
    return sorted.length === 0
      ? 0
      : sorted[Math.floor(sorted.length / 2)];
  })();

  console.log(
    `Files where engramx saved tokens:    ${wins} of ${perFile.length}`
  );
  console.log(`Median per-file savings:             ${median.toFixed(1)}%`);
  console.log(
    `Best:                                ${best?.savingsPct.toFixed(1)}% (${best?.path})`
  );
  console.log(
    `Worst:                               ${worst?.savingsPct.toFixed(1)}% (${worst?.path})`
  );
  console.log();

  // 7. Write results
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const jsonPath = join(OUT_DIR, `real-world-${date}.json`);
  const mdPath = join(OUT_DIR, `real-world-${date}.md`);
  const payload = {
    version: "real-world.v1",
    date: new Date().toISOString(),
    project: PROJECT,
    sample: { requested: MAX_FILES, actual: perFile.length },
    aggregate: {
      totalBaselineTokens: totalBaseline,
      totalEngramTokens: totalEngram,
      savingsPct: Number(aggregateSavings.toFixed(2)),
      wins,
      median: Number(median.toFixed(2)),
    },
    perFile,
  };
  writeFileSync(jsonPath, JSON.stringify(payload, null, 2));

  const md = [
    `# EngramBench Real-World — ${date}`,
    "",
    `**Project:** \`${PROJECT}\``,
    `**Files sampled:** ${perFile.length}`,
    "",
    `## Aggregate`,
    "",
    `| Metric | Value |`,
    `|---|---|`,
    `| Baseline tokens (all files, raw Read) | **${totalBaseline.toLocaleString()}** |`,
    `| engramx tokens (rich packets) | **${totalEngram.toLocaleString()}** |`,
    `| Aggregate savings | **${aggregateSavings.toFixed(1)}%** |`,
    `| Median per-file savings | ${median.toFixed(1)}% |`,
    `| Files where engramx saved tokens | ${wins} of ${perFile.length} |`,
    "",
    `## Top 10 savings`,
    "",
    `| File | Baseline | Engram | Savings | Providers |`,
    `|------|---------:|-------:|--------:|----------:|`,
    ...perFile
      .slice(0, 10)
      .map(
        (r) =>
          `| \`${r.path}\` | ${r.baselineTokens} | ${r.engramTokens} | ${r.savingsPct.toFixed(1)}% | ${r.providerCount} |`
      ),
    "",
    `## Reproduce`,
    "",
    `\`\`\`bash`,
    `cd ${relative(process.cwd(), PROJECT) || "."}`,
    `engram init   # if not already initialized`,
    `npx tsx bench/real-world.ts --files ${MAX_FILES}`,
    `\`\`\``,
  ].join("\n");
  writeFileSync(mdPath, md);

  console.log(`Results written:`);
  console.log(`  ${jsonPath}`);
  console.log(`  ${mdPath}`);
  console.log();
  const verdict = aggregateSavings >= 80 ? "PASS" : "FAIL";
  const target = 80;
  console.log(
    `Target (>= ${target}% aggregate savings): ${verdict === "PASS" ? "✅" : "❌"} ${verdict}`
  );

  process.exit(verdict === "PASS" ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
