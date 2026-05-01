/**
 * v3.3 Cost Lens — weekly digest writer.
 *
 * Produces ISO-week (`YYYY-Www`) Markdown digests at
 * `~/.engram/cost-report-YYYY-Www.md`. Idempotent — overwriting the
 * same week is fine. Designed to be pipeable into Telegram via Jarvis
 * or pasted into Substack/LinkedIn drafts.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  CostConfig,
  DEFAULT_COST_CONFIG,
  ProjectCostRow,
} from "./types.js";
import { summarizeProjects, summarize } from "./aggregator.js";
import { formatMarkdownDigest } from "./formatter.js";

export function isoWeekLabel(d: Date = new Date()): string {
  // ISO week: Monday-start, week 01 contains the year's first Thursday.
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const weekNum =
    1 +
    Math.round(
      ((target.getTime() - firstThursday.getTime()) / 86_400_000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7
    );
  return `${target.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

export interface DigestResult {
  readonly path: string;
  readonly isoWeek: string;
  readonly rows: ProjectCostRow[];
}

export function writeWeeklyDigest(
  projectRoots: readonly string[],
  config: CostConfig = DEFAULT_COST_CONFIG,
  outDir: string = join(homedir(), ".engram"),
  now: Date = new Date()
): DigestResult {
  mkdirSync(outDir, { recursive: true });
  const rows = summarizeProjects(projectRoots, config);
  const totals = summarize(rows.flatMap(() => []), config); // placeholder shape
  // Recompute totals from the per-project sums to avoid double-reading the log files.
  const totalSaved = rows.reduce((a, r) => a + r.summary.tokensSaved, 0);
  const totalInjected = rows.reduce((a, r) => a + r.summary.tokensInjected, 0);
  const totalWould = rows.reduce((a, r) => a + r.summary.tokensWouldHave, 0);
  const denom = totalWould > 0 ? totalWould : totalSaved + totalInjected;
  const realTotals = {
    ...totals,
    tokensSaved: totalSaved,
    tokensInjected: totalInjected,
    tokensWouldHave: totalWould,
    reductionRatio: denom > 0 ? totalSaved / denom : 0,
    approxUsdSaved: (totalSaved / 1_000_000) * config.inputUsdPerMillion,
    events: rows.reduce((a, r) => a + r.summary.events, 0),
  };
  const isoWeek = isoWeekLabel(now);
  const md = formatMarkdownDigest(rows, realTotals, isoWeek);
  const path = join(outDir, `cost-report-${isoWeek}.md`);
  writeFileSync(path, md, "utf8");
  return { path, isoWeek, rows };
}
