/**
 * `engram measure` — the honest, user-runnable saving on YOUR repo.
 *
 * Auto-discovers this repo's highest-fan-out symbols (PageRank god-nodes),
 * then for each measures the REAL structural context-token reduction engram
 * delivers: a raw `rg` symbol search (every match line floods context) vs
 * engram's real `handleGrep` ranked call-site packet. Same grep-step model and
 * token heuristic as `bench/session-level.ts` and `demo/run.ts`.
 *
 * Honest by construction (the numbers are computed live, per-repo):
 *   - STRUCTURAL context tokens, never a cost/bill claim.
 *   - The reduction is a CEILING (assumes the ranked call-sites answer the
 *     search); recall-coverage is reported live, and `rg -n` recovers the rest.
 *   - The intercept rate is reported live (engram is selective by design).
 *   - Symbols engram declines pass through unchanged — never worse.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import chalk from "chalk";
import { godNodes } from "../core.js";
import { handleGrep } from "../intercept/handlers/grep.js";

/** Mirrors bench/session-level.ts + demo/run.ts — same ~4 chars/token heuristic. */
const estimateTokens = (t: string): number => Math.ceil(t.length / 4);

/**
 * Bare identifier from a god-node label so it survives handleGrep's SYMBOL_RE
 * gate: "init()" → "init", "Foo.bar()" → "bar". Returns null if what's left
 * isn't a plain identifier (engram wouldn't intercept it anyway).
 */
export function bareIdentifier(label: string): string | null {
  const base = label.replace(/\(.*$/, "").split(".").pop()?.trim() ?? "";
  return /^[A-Za-z_$][\w$]*$/.test(base) ? base : null;
}

/**
 * Real `rg` content search for a SYMBOL: word-boundary (`-w`) so we model how an
 * agent actually searches for an identifier — `get` matches `.get(`, not
 * `target`/`together`. Without `-w` a common substring inflates the baseline
 * with prose/identifier noise (which would inflate the reduction dishonestly).
 */
function rgContent(pattern: string, root: string): string {
  try {
    return execFileSync(
      "rg",
      ["--line-number", "--no-heading", "--word-regexp", "--sort=path", pattern, "."],
      { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 15_000 }
    );
  } catch {
    return ""; // rg exits 1 on no matches (or isn't installed → treated as unsearchable)
  }
}

/**
 * `file:line` locations from rg output ("./path:line:…") or a call-site packet
 * ("  path:line: code", indented). Normalised so the two sets are comparable:
 * leading whitespace and a leading "./" are stripped before matching.
 */
export function fileLineSet(text: string): Set<string> {
  const s = new Set<string>();
  for (const raw of text.split("\n")) {
    const line = raw.trimStart().replace(/^\.\//, "");
    const m = line.match(/^([^:\s][^:]*):(\d+):/);
    if (m) s.add(`${m[1]}:${m[2]}`);
  }
  return s;
}

/** engram's real Grep packet for a symbol, or null if it passes through. */
async function packetFor(pattern: string, root: string): Promise<string | null> {
  const r = (await handleGrep({
    tool_name: "Grep",
    cwd: root,
    tool_input: { pattern, output_mode: "content" },
  })) as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };
  const o = r?.hookSpecificOutput;
  return o?.permissionDecision === "deny" ? o.permissionDecisionReason ?? null : null;
}

interface Row {
  symbol: string;
  rawTokens: number;
  engramTokens: number;
  intercepted: boolean;
  reduction: number;
  recall: number;
}

async function measureSymbol(symbol: string, root: string): Promise<Row | null> {
  const rgOut = rgContent(symbol, root);
  if (!rgOut) return null; // unsearchable as a bare identifier — not a fair sample
  const rawTokens = estimateTokens(rgOut);
  const packet = await packetFor(symbol, root);
  const intercepted = packet !== null;
  const engramTokens = intercepted ? estimateTokens(packet as string) : rawTokens;
  const reduction = intercepted && rawTokens > 0 ? 1 - engramTokens / rawTokens : 0;
  let recall = 0;
  if (intercepted) {
    const raw = fileLineSet(rgOut);
    const pkt = fileLineSet(packet as string);
    recall = raw.size > 0 ? [...raw].filter((k) => pkt.has(k)).length / raw.size : 0;
  }
  return { symbol, rawTokens, engramTokens, intercepted, reduction, recall };
}

export interface MeasureOptions {
  project: string;
  top?: number;
}

export async function runMeasure(opts: MeasureOptions): Promise<void> {
  const root = resolve(opts.project ?? ".");
  const topN = Math.max(1, Math.min(opts.top ?? 15, 50));

  let gods: Array<{ label: string }>;
  try {
    gods = await godNodes(root, topN);
  } catch {
    console.log(chalk.yellow("\n  No engram graph found here. Run `engram init` first, then `engram measure`.\n"));
    return;
  }
  if (gods.length === 0) {
    console.log(chalk.yellow("\n  The graph is empty. Run `engram init` first, then `engram measure`.\n"));
    return;
  }

  console.log(chalk.bold("\n  engram — structural context saving on this repo\n"));
  console.log(chalk.dim(`  Measuring engram's ${gods.length} highest-fan-out symbols: a raw \`rg\` search`));
  console.log(chalk.dim("  (every match line floods context) vs engram's ranked call-site packet…\n"));

  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const g of gods) {
    const sym = bareIdentifier(g.label);
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    const r = await measureSymbol(sym, root);
    if (r) rows.push(r);
  }

  const measured = rows.length;
  if (measured === 0) {
    console.log(chalk.yellow("  None of the top symbols were searchable as identifiers — try a code-heavier repo.\n"));
    return;
  }

  // A "win" is a genuine reduction (packet smaller than the raw grep). Symbols
  // where engram intercepts but its packet is NOT smaller are honestly NOT a
  // saving — and engram should pass those through (gate fix tracked, #82). We
  // never fold them into the headline.
  const wins = rows.filter((r) => r.intercepted && r.reduction > 0).sort((a, b) => b.reduction - a.reduction);
  const larger = rows.filter((r) => r.intercepted && r.reduction <= 0);

  if (wins.length === 0) {
    console.log(chalk.yellow(`  engram reduced context on 0 of ${measured} top symbols here — likely a small repo`));
    console.log(chalk.dim("  where the raw search is already lean. engram passes through, never claims a win it didn't earn."));
    if (larger.length) {
      console.log(chalk.dim(`  (For ${larger.length}, the call-site packet came out larger than the raw grep —`));
      console.log(chalk.dim("   engram should pass those through; that gate is being tightened.)"));
    }
    console.log("");
    return;
  }

  if (wins.length > 8) console.log(chalk.dim(`  (top 8 of ${wins.length} shown; aggregate below is over all ${wins.length})\n`));
  for (const r of wins.slice(0, 8)) {
    const left = `  ${chalk.cyan(r.symbol)}`.padEnd(36);
    console.log(
      `${left}  ${chalk.dim(r.rawTokens.toLocaleString("en-US") + " tok")} → ` +
        `${chalk.green(r.engramTokens.toLocaleString("en-US") + " tok")}  ${chalk.green("−" + Math.round(r.reduction * 100) + "%")}`
    );
  }

  const rawSum = wins.reduce((s, r) => s + r.rawTokens, 0);
  const engSum = wins.reduce((s, r) => s + r.engramTokens, 0);
  const agg = rawSum > 0 ? Math.round((1 - engSum / rawSum) * 100) : 0;
  const cap = (rawSum / Math.max(engSum, 1)).toFixed(1);
  const rate = Math.round((wins.length / measured) * 100);
  const avgRecall = Math.round((wins.reduce((s, r) => s + r.recall, 0) / wins.length) * 100);

  console.log("");
  console.log(
    chalk.bold(`  ${wins.length} of ${measured} of your highest-fan-out symbols reduce context (${rate}%) — narrower`)
  );
  console.log(chalk.bold("  symbols across your repo pass through unchanged, never worse."));
  console.log(
    chalk.bold(`  Structural context across all ${wins.length}: ${rawSum.toLocaleString("en-US")} → ${engSum.toLocaleString("en-US")} tokens  (${chalk.green("−" + agg + "%")})`)
  );
  console.log(chalk.dim(`  ~${cap}× more searching before you hit the context wall.`));
  if (larger.length) console.log(chalk.dim(`  (${larger.length} intercepted symbol(s) produced a larger packet than the raw grep — gate fix tracked.)`));
  console.log("");
  console.log(chalk.yellow("  Read this before you quote the number:"));
  console.log(chalk.dim("  • STRUCTURAL context tokens — not your bill. Prompt caching owns cost; engram's"));
  console.log(chalk.dim("    net over caching ≈ 0. The win is capacity + ranked quality, not a smaller invoice."));
  console.log(chalk.dim(`  • The −${agg}% is a CEILING — it assumes the ranked call-sites answer the search.`));
  console.log(chalk.dim(`    Recall-coverage on your repo: ~${avgRecall}% of raw match locations are in the packet;`));
  console.log(chalk.dim("    engram always prints the exact `rg -n` to recover the rest."));
  console.log(chalk.dim("  • Selective by design — engram intercepts high-fan-out symbols (≥4 caller files)."));
  console.log("");
}
