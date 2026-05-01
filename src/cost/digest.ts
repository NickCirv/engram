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
  CostSummary,
  DEFAULT_COST_CONFIG,
  ProjectCostRow,
} from "./types.js";
import { summarizeProjects } from "./aggregator.js";
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
  const totals = sumRows(rows, config);
  const isoWeek = isoWeekLabel(now);
  const md = formatMarkdownDigest(rows, totals, isoWeek);
  const path = join(outDir, `cost-report-${isoWeek}.md`);
  writeFileSync(path, md, "utf8");
  return { path, isoWeek, rows };
}

/**
 * Roll the per-project summaries up into a single totals row. Avoids
 * re-reading the JSONL files since the per-project summaries already
 * encode every event we'd see.
 */
function sumRows(
  rows: readonly ProjectCostRow[],
  config: CostConfig
): CostSummary {
  let saved = 0;
  let injected = 0;
  let wouldHave = 0;
  let events = 0;
  let firstTs = "";
  let lastTs = "";
  for (const r of rows) {
    saved += r.summary.tokensSaved;
    injected += r.summary.tokensInjected;
    wouldHave += r.summary.tokensWouldHave;
    events += r.summary.events;
    if (r.summary.fromTs && (!firstTs || r.summary.fromTs < firstTs)) {
      firstTs = r.summary.fromTs;
    }
    if (r.summary.toTs && (!lastTs || r.summary.toTs > lastTs)) {
      lastTs = r.summary.toTs;
    }
  }
  const denom = wouldHave > 0 ? wouldHave : saved + injected;
  return {
    fromTs: firstTs,
    toTs: lastTs,
    events,
    tokensSaved: saved,
    tokensInjected: injected,
    tokensWouldHave: wouldHave,
    reductionRatio: denom > 0 ? saved / denom : 0,
    approxUsdSaved: (saved / 1_000_000) * config.inputUsdPerMillion,
  };
}
