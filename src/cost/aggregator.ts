/**
 * v3.3 Cost Lens — aggregator.
 *
 * Reads existing hook-log.jsonl files (and rotated .1 siblings) from one
 * or many project roots, projects each entry into a CostEvent, then folds
 * into a CostSummary. Tolerant of malformed lines, missing fields, and
 * absent log files — engram cost must never fail noisily on a fresh repo.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CostConfig,
  CostEvent,
  CostSummary,
  DEFAULT_COST_CONFIG,
  ProjectCostRow,
} from "./types.js";

const LOG_FILES = ["hook-log.jsonl", "hook-log.jsonl.1"] as const;

export function readEvents(projectRoot: string): CostEvent[] {
  const out: CostEvent[] = [];
  for (const name of LOG_FILES) {
    const p = join(projectRoot, ".engram", name);
    if (!existsSync(p)) continue;
    let raw = "";
    try {
      raw = readFileSync(p, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        out.push(toCostEvent(parsed));
      } catch {
        // Malformed line — skip, never throw.
      }
    }
  }
  return out;
}

function toCostEvent(raw: Record<string, unknown>): CostEvent {
  const tokensSaved = numOrUndef(raw.tokensSaved);
  const injected = numOrUndef((raw as { injected?: unknown }).injected);
  const wouldHaveRead = numOrUndef(
    (raw as { wouldHaveRead?: unknown }).wouldHaveRead
  );
  return {
    ts: typeof raw.ts === "string" ? raw.ts : new Date(0).toISOString(),
    event: typeof raw.event === "string" ? raw.event : "unknown",
    tool: strOrUndef(raw.tool),
    path: strOrUndef(raw.path),
    wouldHaveRead,
    injected,
    tokensSaved,
  };
}

function numOrUndef(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}
function strOrUndef(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export function summarize(
  events: CostEvent[],
  config: CostConfig = DEFAULT_COST_CONFIG
): CostSummary {
  let saved = 0;
  let injected = 0;
  let wouldHave = 0;
  let firstTs = "";
  let lastTs = "";
  for (const e of events) {
    if (e.tokensSaved) saved += e.tokensSaved;
    if (e.injected) injected += e.injected;
    if (e.wouldHaveRead) wouldHave += e.wouldHaveRead;
    if (!firstTs || e.ts < firstTs) firstTs = e.ts;
    if (!lastTs || e.ts > lastTs) lastTs = e.ts;
  }
  const denom = wouldHave > 0 ? wouldHave : saved + injected;
  const reductionRatio = denom > 0 ? saved / denom : 0;
  const approxUsdSaved = (saved / 1_000_000) * config.inputUsdPerMillion;
  return {
    fromTs: firstTs,
    toTs: lastTs,
    events: events.length,
    tokensSaved: saved,
    tokensInjected: injected,
    tokensWouldHave: wouldHave,
    reductionRatio,
    approxUsdSaved,
  };
}

export function summarizeProjects(
  projectRoots: readonly string[],
  config: CostConfig = DEFAULT_COST_CONFIG
): ProjectCostRow[] {
  return projectRoots.map((projectRoot) => ({
    projectRoot,
    summary: summarize(readEvents(projectRoot), config),
  }));
}
