/**
 * Token Tracker — measures and persists token savings across sessions.
 * The viral screenshot generator. Hard numbers, not marketing claims.
 */
import type { GraphStore } from "../graph/store.js";

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

export function recordSession(
  store: GraphStore,
  naiveTokens: number,
  graphTokens: number
): SessionTokens {
  const saved = Math.max(0, naiveTokens - graphTokens);
  const savedPct =
    naiveTokens > 0 ? Math.round((saved / naiveTokens) * 1000) / 10 : 0;

  const prev = getCumulativeStats(store);
  store.setStat("total_sessions", String(prev.totalSessions + 1));
  store.setStat("total_naive_tokens", String(prev.totalNaiveTokens + naiveTokens));
  store.setStat("total_graph_tokens", String(prev.totalGraphTokens + graphTokens));
  store.setStat("total_tokens_saved", String(prev.totalSaved + saved));

  return { naiveTokens, graphTokens, saved, savedPct };
}

export function getCumulativeStats(store: GraphStore): CumulativeStats {
  const totalSessions = store.getStatNum("total_sessions");
  const totalNaiveTokens = store.getStatNum("total_naive_tokens");
  const totalGraphTokens = store.getStatNum("total_graph_tokens");
  const totalSaved = store.getStatNum("total_tokens_saved");
  // avgReduction is a percentage (0-100). E.g., 88.4 means 88.4% fewer tokens
  // consumed when engram intercepts vs the naive full-read baseline.
  const avgReduction = totalNaiveTokens > 0
    ? Math.round((totalSaved / totalNaiveTokens) * 1000) / 10
    : 0;
  const estimatedCostSaved =
    Math.round((totalSaved / 1_000_000) * COST_PER_MILLION_TOKENS * 100) / 100;

  return { totalSessions, totalNaiveTokens, totalGraphTokens, totalSaved, avgReduction, estimatedCostSaved };
}
