#!/usr/bin/env tsx
/**
 * engram — the honest before/after demo (ADR-0006).
 *
 * Shows the real structural context-token collapse when an agent searches a
 * codebase, using engram's REAL shipped handler (`handleGrep`) on engram's own
 * repo — the same engine + token heuristic as `bench/session-level.ts`.
 * Nothing is staged: the "without" number is the real `rg` output (the match-
 * line flood); the "with" number is the real `handleGrep` packet.
 *
 * Honest by construction:
 *   - Frame is STRUCTURAL context tokens / capacity — never cost.
 *   - The packet is a ranked SUBSET; the `rg -n` escalation is always offered.
 *   - A passthrough case is shown on purpose — engram never makes it worse.
 *   - The reproducible aggregate lives in `npm run bench`; this is illustrative.
 *
 * Run:     npm run demo                       (paced, for watching/recording)
 * Fast:    DEMO_FAST=1 npm run demo           (no delays, for CI/e2e)
 * Record:  asciinema rec --command "npm run demo" docs/demos/before-after.cast
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { handleGrep } from "../src/intercept/handlers/grep.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const FAST = process.env.DEMO_FAST === "1";

// Mirrors bench/session-level.ts estimateTokens — same heuristic so the demo's
// numbers are byte-comparable to the bench. (No tiktoken in either; ~4 chars/tok.)
const estimateTokens = (t: string): number => Math.ceil(t.length / 4);

const sleep = (ms: number): Promise<void> =>
  FAST ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));
const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};
const fmt = (n: number): string => n.toLocaleString("en-US");

/** Real `rg` content search, line-numbered, scoped to src/. "" if no match. */
function rgContent(pattern: string): string {
  try {
    // --sort=path forces deterministic file order (rg walks in parallel by
    // default, which would make "first 3 caller files" — and the numbers — vary).
    return execFileSync("rg", ["--line-number", "--no-heading", "--sort=path", pattern, "src"], {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    return ""; // rg exits 1 on no matches
  }
}

/** engram's real Grep packet for a symbol, or null if it passes through. */
async function engramPacket(pattern: string): Promise<string | null> {
  const result = (await handleGrep({
    tool_name: "Grep",
    cwd: REPO,
    tool_input: { pattern, output_mode: "content" },
  })) as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };
  const out = result?.hookSpecificOutput;
  return out?.permissionDecision === "deny" ? out.permissionDecisionReason ?? null : null;
}

interface Measured {
  symbol: string;
  rawTokens: number;
  engramTokens: number;
  intercepted: boolean;
  reduction: number;
  matchLines: number;
}

/** Measure one symbol the honest way. */
async function measure(symbol: string): Promise<Measured> {
  const rgOut = rgContent(symbol);
  // Without engram: the agent's grep floods every match line into the context
  // window. raw = rg output ONLY — the same grep-step model as
  // bench/session-level.ts. We deliberately do NOT also bill whole-file reads
  // (that would inflate the "before" side against engram's packet alone).
  const rawTokens = estimateTokens(rgOut);
  const packet = await engramPacket(symbol);
  const engramTokens = packet === null ? rawTokens : estimateTokens(packet);
  const intercepted = packet !== null;
  const reduction = intercepted && rawTokens > 0 ? 1 - engramTokens / rawTokens : 0;
  return {
    symbol,
    rawTokens,
    engramTokens,
    intercepted,
    reduction,
    matchLines: rgOut.split("\n").filter(Boolean).length,
  };
}

// A fixed, disclosed set of real engram symbols: four high-fan-out searches
// engram intercepts, plus one (`Node`, 400+ matches) that passes through — the
// floor. raw = rg output only; whatever the live graph produces is what's shown,
// nothing hand-tuned per number. `npm run bench` is the rigorous P-modelled aggregate.
const SYMBOLS = ["init", "query", "parse", "getStore", "Node"];

async function main(): Promise<void> {
  console.log("");
  console.log(c.bold("  engram — the honest before/after"));
  console.log(
    c.dim("  real handler, engram's own repo. nothing staged. " + (FAST ? "" : "(DEMO_FAST=1 to skip pacing)"))
  );
  console.log("");
  await sleep(900);

  console.log(c.dim("  A developer's agent searches the codebase. Every match line from each"));
  console.log(c.dim("  search floods into the model's context window."));
  console.log("");
  await sleep(1100);

  const rows: Measured[] = [];
  for (const sym of SYMBOLS) {
    const m = await measure(sym);
    rows.push(m);
    const left = `  ${c.cyan(`"${sym}"`)} ${c.dim(`(${fmt(m.matchLines)} matches)`)}`.padEnd(48);
    if (m.intercepted) {
      console.log(
        `${left}  ${c.dim(fmt(m.rawTokens) + " tok")} → ${c.green(fmt(m.engramTokens) + " tok")}  ${c.green(
          "−" + Math.round(m.reduction * 100) + "%"
        )}`
      );
    } else {
      console.log(`${left}  ${c.dim(fmt(m.rawTokens) + " tok")} → ${c.yellow("passthrough")}  ${c.dim("(engram declines — never worse)")}`);
    }
    await sleep(700);
  }
  console.log("");
  await sleep(600);

  const hits = rows.filter((r) => r.intercepted);
  const rawSum = hits.reduce((s, r) => s + r.rawTokens, 0);
  const engSum = hits.reduce((s, r) => s + r.engramTokens, 0);
  const agg = rawSum > 0 ? Math.round((1 - engSum / rawSum) * 100) : 0;
  console.log(
    c.bold(`  Structural context on the intercepted searches: ${fmt(rawSum)} → ${fmt(engSum)} tokens  (${c.green("−" + agg + "%")})`)
  );
  console.log(c.dim(`  ~${(rawSum / Math.max(engSum, 1)).toFixed(1)}× more searching before you hit the context wall.`));
  console.log("");
  await sleep(1000);

  console.log(c.yellow("  The asterisks the over-claimers hide:"));
  console.log(c.dim("  • STRUCTURAL context tokens — not your bill. Prompt caching owns cost;"));
  console.log(c.dim("    engram's net over caching ≈ 0. The win is capacity + ranked quality."));
  console.log(c.dim("  • The packet is a RANKED subset (PageRank), and the reductions above are a"));
  console.log(c.dim("    CEILING — they assume the ranked call-sites answer the search with no raw"));
  console.log(c.dim("    follow-up. engram always prints the exact `rg -n` to recover the rest;"));
  console.log(c.dim("    real recall-coverage here is ~22%. The honest P-modelled figure: `npm run bench`."));
  console.log(c.dim("  • Selective by design — engram intercepts only ~20% of searches here (the"));
  console.log(c.dim("    high-fan-out ones, ≥4 caller files); the rest pass through, never worse."));
  console.log("");
  await sleep(900);
  console.log(c.dim("  Reproduce the rigorous aggregate on any repo:  ") + c.cyan("npm run bench"));
  console.log("");
}

main().catch((e: unknown) => {
  console.error("demo error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
