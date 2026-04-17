/**
 * Auto-tuner — analyses `.engram/hook-log.jsonl` and proposes adjustments
 * to the per-project config. Never modifies config without an explicit
 * `applyTuning` call.
 *
 * Analysis rules
 * ──────────────
 * 1. Confidence threshold — if the median confidence of denied Read
 *    events is more than 0.1 above the current threshold, suggest raising
 *    the threshold (reduces noise without missing real context).
 * 2. Provider disable — if a provider name never appears in any entry's
 *    `provider` field across the entire log, suggest disabling it (it is
 *    contributing nothing and burning latency budget).
 * 3. Provider budget increase — if a provider always contributes content
 *    (appears in every intercepted read), suggest raising its token budget
 *    by 20% so it has room to deliver more context.
 *
 * All arithmetic uses immutable spreads; no in-place mutation.
 */
import { readHookLog } from "../intelligence/hook-log.js";
import { readConfig, writeConfig, type EngramConfig } from "./config.js";

/** A single proposed configuration change. */
export interface TuneChange {
  readonly field: string;
  readonly current: number | boolean;
  readonly proposed: number | boolean;
  readonly reason: string;
}

/** Output of an analysis run. */
export interface TuneProposal {
  readonly changes: TuneChange[];
  readonly entriesAnalyzed: number;
  readonly daysSpanned: number;
}

/** Minimum denied-read events required before suggesting threshold changes. */
const MIN_CONFIDENCE_SAMPLES = 10;

/** How far median must exceed current threshold before we suggest raising it. */
const CONFIDENCE_HYSTERESIS = 0.1;

/** Minimum intercepted-read events to conclude a provider is always-on. */
const ALWAYS_ON_MIN_EVENTS = 20;

/**
 * Analyse the hook log for the given project and return a list of
 * proposed configuration changes. Returns an empty proposal if the log
 * has too few entries to draw conclusions.
 */
export function analyzeTuning(projectRoot: string): TuneProposal {
  const entries = readHookLog(projectRoot);
  if (entries.length === 0) {
    return { changes: [], entriesAnalyzed: 0, daysSpanned: 0 };
  }

  const config = readConfig(projectRoot);
  const changes: TuneChange[] = [];

  // ── Derived sets ──────────────────────────────────────────────────
  const deniedReads = entries.filter(
    (e) => e.event === "PreToolUse" && e.decision === "deny"
  );

  // Track which providers appeared in any hook entry
  const providerHits = new Map<string, number>();
  const confidences: number[] = [];

  for (const entry of deniedReads) {
    const prov = (entry as unknown as Record<string, unknown>).provider;
    if (typeof prov === "string") {
      providerHits.set(prov, (providerHits.get(prov) ?? 0) + 1);
    }
    if (typeof entry.confidence === "number") {
      confidences.push(entry.confidence);
    }
  }

  // ── Rule 1: Confidence threshold ──────────────────────────────────
  if (confidences.length >= MIN_CONFIDENCE_SAMPLES) {
    const sorted = [...confidences].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median > config.confidenceThreshold + CONFIDENCE_HYSTERESIS) {
      const proposed = Math.round(median * 100) / 100;
      changes.push({
        field: "confidenceThreshold",
        current: config.confidenceThreshold,
        proposed,
        reason: `Median result confidence is ${median.toFixed(2)} — raising threshold reduces noise`,
      });
    }
  }

  // ── Rule 2: Disable never-contributing providers ──────────────────
  // Only flag a provider if it appeared 0 times AND we have enough data
  if (deniedReads.length >= ALWAYS_ON_MIN_EVENTS) {
    const knownProviders = ["engram:structure", "engram:mistakes", "engram:git", "mempalace", "context7", "obsidian"];
    for (const pName of knownProviders) {
      const hits = providerHits.get(pName) ?? 0;
      const override = config.providers[pName];
      const alreadyDisabled = override?.enabled === false;
      if (hits === 0 && !alreadyDisabled) {
        changes.push({
          field: `providers.${pName}.enabled`,
          current: true,
          proposed: false,
          reason: `Provider "${pName}" has 0 hits across ${deniedReads.length} intercepted reads — disabling saves latency`,
        });
      }
    }
  }

  // ── Rule 3: Increase budget for always-on providers ───────────────
  if (deniedReads.length >= ALWAYS_ON_MIN_EVENTS) {
    for (const [pName, hits] of providerHits) {
      const hitRate = hits / deniedReads.length;
      if (hitRate >= 0.9) {
        const currentBudget = config.providers[pName]?.tokenBudget ?? 200;
        const proposed = Math.round(currentBudget * 1.2);
        if (proposed !== currentBudget) {
          changes.push({
            field: `providers.${pName}.tokenBudget`,
            current: currentBudget,
            proposed,
            reason: `Provider "${pName}" contributes on ${Math.round(hitRate * 100)}% of reads — increasing budget allows richer output`,
          });
        }
      }
    }
  }

  // ── Time span ─────────────────────────────────────────────────────
  const timestamps = entries
    .map((e) => (e as unknown as Record<string, unknown>).ts)
    .filter((ts): ts is string => typeof ts === "string")
    .map((ts) => new Date(ts).getTime())
    .filter((t) => !isNaN(t));

  const daysSpanned =
    timestamps.length >= 2
      ? Math.ceil(
          (Math.max(...timestamps) - Math.min(...timestamps)) /
            (24 * 3600 * 1000)
        )
      : 0;

  return { changes, entriesAnalyzed: entries.length, daysSpanned };
}

/**
 * Apply a `TuneProposal` to the project's config, writing the result to
 * `.engram/config.json`. Only applies changes whose `proposed` values
 * differ from `current` — no-ops are silently skipped.
 */
export function applyTuning(projectRoot: string, proposal: TuneProposal): void {
  const config = readConfig(projectRoot);
  let updated: EngramConfig = { ...config };

  for (const change of proposal.changes) {
    if (change.field === "confidenceThreshold") {
      updated = { ...updated, confidenceThreshold: change.proposed as number };
    } else if (change.field === "totalTokenBudget") {
      updated = { ...updated, totalTokenBudget: change.proposed as number };
    } else if (change.field.startsWith("providers.")) {
      const parts = change.field.split(".");
      // field format: "providers.<name>.<key>"
      const providerName = parts[1];
      const key = parts[2];
      if (providerName && key) {
        const existing = updated.providers[providerName] ?? {};
        updated = {
          ...updated,
          providers: {
            ...updated.providers,
            [providerName]: { ...existing, [key]: change.proposed },
          },
        };
      }
    }
  }

  writeConfig(projectRoot, updated);
}
