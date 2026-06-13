/**
 * `engram measure --session` — Token-loop C (replay).
 *
 * `engram measure` (no flag) proves the structural reduction PER SYMBOL on a
 * fresh probe of your repo. This proves the COMBINED reduction END-TO-END over a
 * REAL recorded session, by replaying `.engram/hook-log.jsonl` through the SAME
 * recall-recovery P-model the deterministic bench uses (`bench/session-level.ts`,
 * ADR-0002). No live LLM, no cost — a deterministic re-accounting of what engram
 * already did at the hook boundary.
 *
 * Honest by construction (the whole point of this feature):
 *   - It reports a per-session BREAK-EVEN-P CURVE, never a single "X% saved".
 *     engram's packet is a SUBSET of the raw tool output, so when the agent's
 *     real need isn't in the packet it re-runs the raw call ON TOP. P = the
 *     fraction of intercepted calls where that happens; the curve is honest, a
 *     point estimate would not be.
 *   - STRUCTURAL context-token reduction, NEVER a $/bill claim. With prompt
 *     caching engram's net over the dollar bill is ~0 (measured); this is about
 *     capacity, not cost.
 *   - The whole-session number is a SAME-EPOCH CEILING: re-read dedup only fires
 *     when no `/compact` happened since the first read (ADR-0003 resets the
 *     served-set at PreCompact/SessionStart), so the realistic rate is below it.
 *   - MEASURE, don't INFER: the Bash shell-grep arm is only counted when the log
 *     actually carries the `command` field (logs predating v4.4 omit it). For
 *     such logs the arm is excluded and the report says so — we never fall back
 *     to the 39:1 Bash:Grep inference for a reported number.
 *
 * Session segmentation: by `sessionId` when the log carries it (v4.4+ logs);
 * otherwise by a 30-minute inter-event time gap. The report DISCLOSES which.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import chalk from "chalk";

/** Inter-event gap (ms) that starts a new session when no sessionId exists. */
const TIME_GAP_MS = 30 * 60 * 1000;

/** The two log files engram keeps (current + one rotation). */
const LOG_FILES = ["hook-log.jsonl", "hook-log.jsonl.1"] as const;

/** A replay-relevant projection of one hook-log line. */
export interface ReplayEvent {
  readonly ts: number; // epoch ms; NaN-safe (0 if unparseable)
  readonly tool?: string;
  readonly path?: string;
  readonly decision?: string;
  readonly wouldHaveRead?: number;
  readonly injected?: number;
  readonly sessionId?: string;
  readonly command?: string;
}

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

/**
 * Read replay events from a hook-log path (or a project's `.engram/` dir).
 * Tolerant: missing file → [], malformed line → skipped, never throws. This is
 * deliberately independent of `cost/aggregator.ts` because we need `sessionId`,
 * `decision`, and `command`, which the CostEvent projection drops.
 */
export function readReplayEvents(logArg: string): ReplayEvent[] {
  // A direct file path, or a project root whose `.engram/` we scan.
  const paths: string[] = [];
  if (logArg.endsWith(".jsonl") || logArg.endsWith(".jsonl.1")) {
    paths.push(logArg);
  } else {
    for (const f of LOG_FILES) paths.push(join(logArg, ".engram", f));
  }

  const out: ReplayEvent[] = [];
  for (const p of paths) {
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
        const o = JSON.parse(line) as Record<string, unknown>;
        const tsRaw = str(o.ts);
        const tsMs = tsRaw ? Date.parse(tsRaw) : NaN;
        out.push({
          ts: Number.isFinite(tsMs) ? tsMs : 0,
          tool: str(o.tool),
          path: str(o.path),
          decision: str(o.decision),
          wouldHaveRead: num(o.wouldHaveRead),
          injected: num(o.injected),
          sessionId: str(o.sessionId),
          command: str(o.command),
        });
      } catch {
        // Malformed line — skip, never throw (a corrupt log must still report).
      }
    }
  }
  // Stable chronological order (rotation file may sort before the current one).
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

/** How a log was split into sessions — disclosed in the report. */
export type SegmentMode = "session-id" | "time-gap" | "mixed";

/**
 * Segment events into sessions. If EVERY event carries a sessionId we group by
 * it (the honest path). If NONE do, we fall back to a 30-min time-gap heuristic.
 * A mixed log (some ids, some not) groups id-bearing events by id and time-gaps
 * the rest — reported as "mixed" so the reader knows it's partly a guess.
 */
export function segmentSessions(events: ReplayEvent[]): {
  sessions: ReplayEvent[][];
  mode: SegmentMode;
} {
  if (events.length === 0) return { sessions: [], mode: "time-gap" };

  const withId = events.filter((e) => e.sessionId);
  const withoutId = events.filter((e) => !e.sessionId);

  // Pure id-based.
  if (withoutId.length === 0) {
    return { sessions: groupById(events), mode: "session-id" };
  }

  // Pure time-gap.
  if (withId.length === 0) {
    return { sessions: timeGapSplit(events), mode: "time-gap" };
  }

  // Mixed: group id-bearing by id, time-gap the rest, concatenate.
  const sessions = [...groupById(withId), ...timeGapSplit(withoutId)];
  return { sessions, mode: "mixed" };
}

/** Group events by their (present) sessionId, preserving first-seen order. */
function groupById(events: ReplayEvent[]): ReplayEvent[][] {
  const byId = new Map<string, ReplayEvent[]>();
  for (const e of events) {
    const k = e.sessionId as string;
    const list = byId.get(k);
    if (list) list.push(e);
    else byId.set(k, [e]);
  }
  return [...byId.values()];
}

/** Split a chronologically-sorted list on >30-min inter-event gaps. */
function timeGapSplit(events: ReplayEvent[]): ReplayEvent[][] {
  if (events.length === 0) return [];
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const sessions: ReplayEvent[][] = [];
  let current: ReplayEvent[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].ts - sorted[i - 1].ts;
    if (gap > TIME_GAP_MS) {
      sessions.push(current);
      current = [];
    }
    current.push(sorted[i]);
  }
  if (current.length > 0) sessions.push(current);
  return sessions;
}

/**
 * The P-model buckets for one session, reconstructed from the log. Mirrors the
 * TraceResult buckets in `bench/session-level.ts` exactly so the SAME math
 * (`engramAt`, `breakEvenP`, `sessionReductionAt`) applies.
 */
export interface SessionBuckets {
  /** First-occurrence intercepted (deny) calls — P-discounted. */
  interceptedBaseline: number;
  interceptedPacket: number;
  /** First-occurrence passthrough calls — engram cost == baseline. */
  passthroughBaseline: number;
  /** Re-occurrences of an already-seen path — the CLEAN dedup bucket. */
  dedupBaseline: number;
  dedupEngram: number;
  /** Counts for disclosure. */
  events: number;
  interceptedCalls: number;
  bashGrepCounted: number; // intercepted Bash-grep calls actually counted
  bashGrepSkipped: number; // Bash events with no `command` field → excluded
}

/**
 * Replay one session's events into P-model buckets.
 *
 * - Read/Grep/Bash-grep events with `decision==="deny"` are intercepted: the
 *   baseline is `wouldHaveRead`, the packet is `injected`.
 * - `decision==="passthrough"` (or unknown) → engram cost == baseline.
 * - A Read whose `path` was already seen this session is a re-read → dedup
 *   bucket (the SAME-EPOCH ceiling; not P-discounted).
 * - Bash events are only included when they carry the `command` field AND it is
 *   a symbol-grep that engram intercepted (`decision==="deny"`); otherwise the
 *   Bash event is excluded from the measured number (measure-don't-infer).
 */
export function replaySession(events: ReplayEvent[]): SessionBuckets {
  const b: SessionBuckets = {
    interceptedBaseline: 0,
    interceptedPacket: 0,
    passthroughBaseline: 0,
    dedupBaseline: 0,
    dedupEngram: 0,
    events: events.length,
    interceptedCalls: 0,
    bashGrepCounted: 0,
    bashGrepSkipped: 0,
  };
  const seenPaths = new Set<string>();

  for (const e of events) {
    const tool = e.tool;

    // Bash: only counted when the log carries the command string (v4.4+). A
    // Bash event without it can't be honestly classified as a shell-grep, so we
    // exclude it from the number rather than infer.
    if (tool === "Bash") {
      if (!e.command) {
        b.bashGrepSkipped++;
        continue;
      }
      if (e.decision === "deny") b.bashGrepCounted++;
      // fall through to the generic accounting below (it's grep-shaped)
    }

    if (tool !== "Read" && tool !== "Grep" && tool !== "Bash") continue;

    const baseline = e.wouldHaveRead;
    const packet = e.injected;
    const intercepted = e.decision === "deny";

    // We can only account for an event that recorded its baseline cost.
    if (baseline === undefined) {
      // Intercepted but no cost recorded → can't model; skip silently.
      continue;
    }

    // Re-read dedup applies to Reads with a known path.
    const isReread =
      tool === "Read" && e.path !== undefined && seenPaths.has(e.path);
    if (tool === "Read" && e.path !== undefined) seenPaths.add(e.path);

    if (isReread) {
      b.dedupBaseline += baseline;
      b.dedupEngram += intercepted ? packet ?? baseline : baseline;
      if (intercepted) b.interceptedCalls++;
    } else if (intercepted) {
      b.interceptedBaseline += baseline;
      b.interceptedPacket += packet ?? baseline;
      b.interceptedCalls++;
    } else {
      b.passthroughBaseline += baseline;
    }
  }
  return b;
}

// ── P-model math (identical shape to bench/session-level.ts) ──────────────

/** First-read/grep baseline (excludes the dedup bucket). */
export const pBase = (b: SessionBuckets): number =>
  b.passthroughBaseline + b.interceptedBaseline;

/** engram cost over first-reads/greps at recall-recovery fraction P. */
export const engramAt = (b: SessionBuckets, p: number): number =>
  b.passthroughBaseline + b.interceptedPacket + p * b.interceptedBaseline;

/** P-model reduction over first-reads/greps only, as a percentage. */
export const reductionAt = (b: SessionBuckets, p: number): number => {
  const base = pBase(b);
  return base > 0 ? ((base - engramAt(b, p)) / base) * 100 : 0;
};

/**
 * Break-even P: engram nets positive while the agent re-fetches raw content on
 * fewer than this fraction of intercepted calls. 0 when nothing was intercepted.
 */
export const breakEvenP = (b: SessionBuckets): number =>
  b.interceptedBaseline > 0
    ? (b.interceptedBaseline - b.interceptedPacket) / b.interceptedBaseline
    : 0;

/** Whole-session reduction = P-model engram + dedup (clean), over full base. */
export const sessionReductionAt = (b: SessionBuckets, p: number): number => {
  const base = pBase(b) + b.dedupBaseline;
  const eng = engramAt(b, p) + b.dedupEngram;
  return base > 0 ? ((base - eng) / base) * 100 : 0;
};

/** Share of the whole-session baseline that is the (near-free) dedup bucket. */
export const dedupShare = (b: SessionBuckets): number => {
  const base = pBase(b) + b.dedupBaseline;
  return base > 0 ? (b.dedupBaseline / base) * 100 : 0;
};

// ── Rendering ─────────────────────────────────────────────────────────────

export interface MeasureSessionOptions {
  project: string;
  /** Explicit hook-log path; defaults to the project's `.engram/` logs. */
  replay?: string;
}

const P_GRID = [0, 0.25, 0.5, 0.75, 1.0] as const;

export async function runMeasureSession(
  opts: MeasureSessionOptions
): Promise<void> {
  const root = resolve(opts.project ?? ".");
  const logArg = opts.replay ? resolve(opts.replay) : root;

  const events = readReplayEvents(logArg);
  if (events.length === 0) {
    console.log(
      chalk.yellow(
        `\n  No hook-log events found at ${chalk.bold(logArg)}.\n` +
          `  Use engram for a while (it logs to .engram/hook-log.jsonl), then re-run,\n` +
          `  or pass --replay <path-to-hook-log.jsonl>.\n`
      )
    );
    return;
  }

  const { sessions, mode } = segmentSessions(events);
  const buckets = sessions.map(replaySession);
  // Only sessions where engram had cost-recorded activity to model are shown.
  const active = buckets.filter((b) => pBase(b) + b.dedupBaseline > 0);

  console.log(
    chalk.bold("\n  engram — cumulative session structural reduction (replay)\n")
  );
  console.log(
    chalk.dim(
      `  Replaying ${events.length} hook-log events · ${sessions.length} session(s) · ` +
        `segmented by ${modeLabel(mode)}`
    )
  );
  console.log(
    chalk.dim(
      `  STRUCTURAL context-token reduction, not a cost/bill saving. The number is\n` +
        `  a per-session break-even-P CURVE — engram's packet is a subset of the raw\n` +
        `  tool output, so the real saving sits between the P=0 ceiling and break-even.`
    )
  );
  console.log();

  const bashSkipped = buckets.reduce((a, b) => a + b.bashGrepSkipped, 0);
  if (bashSkipped > 0) {
    console.log(
      chalk.yellow(
        `  ⚠ ${bashSkipped} Bash event(s) lack the v4.4 \`command\` field and were ` +
          `EXCLUDED\n    from the measured number (we measure the shell-grep arm, never infer it).`
      )
    );
    console.log();
  }

  if (active.length === 0) {
    console.log(
      chalk.yellow(
        `  No session had any cost-recorded Read/Grep activity to model.\n`
      )
    );
    return;
  }

  // Per-session curves.
  let idx = 0;
  for (const b of active) {
    idx++;
    const be = breakEvenP(b) * 100;
    console.log(
      chalk.bold(
        `  Session ${idx}  ` +
          chalk.dim(
            `(${b.events} events · ${b.interceptedCalls} intercepted · ` +
              `${formatTokens(pBase(b) + b.dedupBaseline)} session tokens)`
          )
      )
    );
    const curve = P_GRID.map(
      (p) => `P=${p.toFixed(2)} ${reductionAt(b, p).toFixed(1)}%`
    ).join("  ");
    console.log(`    first-read/grep:  ${curve}`);
    console.log(
      chalk.green(
        `    break-even P = ${be.toFixed(1)}%` +
          chalk.dim(
            `  (engram nets positive while the agent re-fetches raw on <${be.toFixed(0)}% of intercepts)`
          )
      )
    );
    if (b.dedupBaseline > 0) {
      console.log(
        chalk.dim(
          `    whole-session (SAME-EPOCH CEILING): P=0 ${sessionReductionAt(b, 0).toFixed(1)}% · ` +
            `P=0.5 ${sessionReductionAt(b, 0.5).toFixed(1)}%  ` +
            `(dedup = ${dedupShare(b).toFixed(0)}% of base)`
        )
      );
    }
    console.log();
  }

  // Disclosures (always printed — this is the credibility).
  console.log(chalk.dim("  ─────────────────────────────────────────────────────────"));
  console.log(
    chalk.dim(
      "  HONEST READ: P=0 is an OPTIMISTIC ceiling (assumes the structural packet\n" +
        "  fully answers what the agent grepped/read — it doesn't always). The real\n" +
        "  saving is between P=0 and break-even, by workload. Whole-session figures\n" +
        "  are a SAME-EPOCH CEILING: re-read dedup doesn't survive a /compact\n" +
        "  (the served-set resets), so the realistic rate is below them. This is a\n" +
        "  STRUCTURAL context-token reduction, NOT a dollar/bill saving."
    )
  );
  console.log();
}

function modeLabel(mode: SegmentMode): string {
  switch (mode) {
    case "session-id":
      return "harness session id (exact)";
    case "time-gap":
      return "30-min time-gap heuristic (no session id in log — approximate)";
    case "mixed":
      return "session id where present, else 30-min time-gap (partly approximate)";
  }
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));
}
