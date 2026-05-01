/**
 * v3.3 Cost Lens — types shared across the cost subsystem.
 *
 * The cost lens reads existing PreToolUse / PostToolUse JSONL hook logs
 * (see `intelligence/hook-log.ts`) and aggregates token-saved metrics
 * into per-session, per-project, and per-week shapes. No new persistence
 * layer is introduced — the hook log is already the source of truth.
 *
 * All numbers are conservative. Token estimates use the same 4-chars-per-
 * token heuristic as `providers/resolver.ts` so that "tokens saved" is
 * comparable to "tokens injected" without unit-mismatch.
 */

/** A single hook event after enrichment with cost fields. */
export interface CostEvent {
  readonly ts: string;
  readonly event: "PreToolUse" | "PostToolUse" | string;
  readonly tool?: string;
  readonly path?: string;
  /** Estimated tokens that would have been read without engram. */
  readonly wouldHaveRead?: number;
  /** Estimated tokens actually injected by engram. */
  readonly injected?: number;
  /** wouldHaveRead − injected, never negative. */
  readonly tokensSaved?: number;
}

/** Aggregate over a window. */
export interface CostSummary {
  readonly fromTs: string;
  readonly toTs: string;
  readonly events: number;
  readonly tokensSaved: number;
  readonly tokensInjected: number;
  readonly tokensWouldHave: number;
  /** Saved / wouldHave, 0..1. NaN-safe (returns 0 if denominator is 0). */
  readonly reductionRatio: number;
  /** Approx USD value of tokens saved at modelRate. */
  readonly approxUsdSaved: number;
}

/** Per-project breakdown row. */
export interface ProjectCostRow {
  readonly projectRoot: string;
  readonly summary: CostSummary;
}

/**
 * Cost configuration. Defaults match Claude Sonnet 4.6 input pricing as of
 * 2026-04-27. User can override via `~/.engram/cost-config.json`.
 */
export interface CostConfig {
  /** USD per 1M input tokens. */
  readonly inputUsdPerMillion: number;
  /** Currency label for display. Default "USD". */
  readonly currency: string;
}

export const DEFAULT_COST_CONFIG: CostConfig = {
  inputUsdPerMillion: 3.0,
  currency: "USD",
};
