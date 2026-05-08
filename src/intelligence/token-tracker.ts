/**
 * Token Tracker — measures and persists token savings across sessions.
 * The viral screenshot generator. Hard numbers, not marketing claims.
 */
import type { GraphStore } from "../graph/store.js";
import { projectStatKey } from "../core.js";
import { resolve as resolvePath } from "node:path";

export interface SessionTokens {
  naiveTokens: number;
  graphTokens: number;
  saved: number;
  savedPct: number;
}

export interface CumulativeStats {
  totalSessions: number;
  totalNaiveTokens: number;
  totalGraphTokens: number;
  totalSaved: number;
  avgReduction: number;
  estimatedCostSaved: number;
}

const COST_PER_MILLION_TOKENS = 3.0;

/**
 * Record a single session's token numbers. If projectRoot is provided,
 * stats are stored namespaced to that project so dashboards per-project
 * show the correct totals.
 */
export function recordSession(
  store: GraphStore,
  naiveTokens: number,
  graphTokens: number,
  projectRoot?: string
): SessionTokens {
  const saved = Math.max(0, naiveTokens - graphTokens);
  const savedPct =
    naiveTokens > 0 ? Math.round((saved / naiveTokens) * 1000) / 10 : 0;

  const prev = getCumulativeStats(store, projectRoot);
  const root = projectRoot ? resolvePath(projectRoot) : undefined;
  const sessKey = root ? projectStatKey(root, "total_sessions") : "total_sessions";
  const naiveKey = root ? projectStatKey(root, "total_naive_tokens") : "total_naive_tokens";
  const graphKey = root ? projectStatKey(root, "total_graph_tokens") : "total_graph_tokens";
  const savedKey = root ? projectStatKey(root, "total_tokens_saved") : "total_tokens_saved";

  store.setStat(sessKey, String(prev.totalSessions + 1));
  store.setStat(naiveKey, String(prev.totalNaiveTokens + naiveTokens));
  store.setStat(graphKey, String(prev.totalGraphTokens + graphTokens));
  store.setStat(savedKey, String(prev.totalSaved + saved));

  // Append to a session log for time-series visualization. Keep the
  // last 1000 entries to avoid unbounded growth.
  try {
    const logKey = root ? projectStatKey(root, "session_log") : "session_log";
    const existing = store.getStat(logKey);
    let arr: any[] = [];
    if (existing) {
      try { arr = JSON.parse(existing); if (!Array.isArray(arr)) arr = []; } catch { arr = []; }
    }
    arr.push({ ts: Date.now(), naiveTokens, graphTokens, saved, savedPct });
    if (arr.length > 1000) arr = arr.slice(-1000);
    store.setStat(logKey, JSON.stringify(arr));
  } catch {
    // best-effort only
  }

  return { naiveTokens, graphTokens, saved, savedPct };
}

/**
 * Read cumulative token stats. If projectRoot is provided, favors
 * project-scoped keys (project:<b64root>:<key>) and falls back to the
 * global keys when absent.
 */
export function getCumulativeStats(store: GraphStore, projectRoot?: string): CumulativeStats {
  const root = projectRoot ? resolvePath(projectRoot) : undefined;
  const makeKey = (k: string) => (root ? projectStatKey(root, k) : k);

  const totalSessions = store.getStatNum(makeKey("total_sessions"));
  const totalNaiveTokens = store.getStatNum(makeKey("total_naive_tokens"));
  const totalGraphTokens = store.getStatNum(makeKey("total_graph_tokens"));
  const totalSaved = store.getStatNum(makeKey("total_tokens_saved"));
  // avgReduction is a percentage (0-100). E.g., 88.4 means 88.4% fewer tokens
  // consumed when engram intercepts vs the naive full-read baseline.
  const avgReduction = totalNaiveTokens > 0
    ? Math.round((totalSaved / totalNaiveTokens) * 1000) / 10
    : 0;
  const estimatedCostSaved =
    Math.round((totalSaved / 1_000_000) * COST_PER_MILLION_TOKENS * 100) / 100;

  return { totalSessions, totalNaiveTokens, totalGraphTokens, totalSaved, avgReduction, estimatedCostSaved };
}
