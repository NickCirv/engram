#!/usr/bin/env tsx
/**
 * cochange-holdout.ts — does PAST co-change predict FUTURE co-change?
 *
 * engram's git-miner emits co-change edges ("files that changed together 3+
 * times"). The recall-coverage bench DELIBERATELY excludes them, because
 * measuring co-change-edges against a co-change gold is CIRCULAR. So that
 * feature has never been honestly validated. This bench is the non-circular
 * test: split the git history TEMPORALLY, learn co-change from the PAST window,
 * and predict co-change in a DISJOINT FUTURE window. Past→future is exactly the
 * real product question (engram learns from history, predicts forward) and
 * carries no label leakage.
 *
 * It compares three predictors against the same future gold, plus a naive
 * popularity baseline (some files always change — co-change must beat that):
 *   COCHANGE  — training co-change neighbours of f1, ranked by count
 *   PATHREACH — same-dir siblings + test↔impl (path math, no history)
 *   COMBINED  — co-change first, path-reach appended (tiered, never-worse)
 *   POPULARITY (baseline) — the globally-most-changed files, ignoring f1
 *
 * STRUCTURAL recall, NOT task success. Run:
 *   npx tsx bench/cochange-holdout.ts --project . [--split 0.7] [--limit 600]
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { clusterBootstrapCI, mean } from "./stats.js";
import { sameDirSiblings, testImplCounterparts } from "../src/graph/reach.js";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

/** Exclude build output, deps, binaries, lockfiles — keep all real source/config. */
const SKIP =
  /(^|\/)(node_modules|dist|build|out|\.next|coverage|vendor)\/|\.(png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|pdf|zip|gz|mp4|lock|lockb)$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb)$/i;
const isTrackable = (p: string): boolean => p.length > 0 && !SKIP.test(p);

/** All commits oldest→newest, each with its changed trackable files (≥2). */
function commitsChrono(root: string, limit: number): Array<{ hash: string; files: string[] }> {
  const out = execFileSync(
    "git",
    ["-C", root, "log", "--reverse", "--no-merges", "-n", String(limit),
      "--name-status", "--pretty=format:%H", "--diff-filter=AM"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  const commits: Array<{ hash: string; files: string[] }> = [];
  let cur: { hash: string; files: string[] } | null = null;
  for (const line of out.split("\n")) {
    if (/^[0-9a-f]{40}$/.test(line)) {
      if (cur && cur.files.length >= 2) commits.push(cur);
      cur = { hash: line, files: [] };
    } else if (cur) {
      const m = line.match(/^[AM]\t(.+)$/); // skip renames(R)/deletes(D)
      if (m && isTrackable(m[1])) cur.files.push(m[1]);
    }
  }
  if (cur && cur.files.length >= 2) commits.push(cur);
  return commits;
}

function recallAtK(ranked: readonly string[], gold: readonly string[], k: number): number {
  if (gold.length === 0) return 0;
  const top = new Set(ranked.slice(0, k));
  let hit = 0;
  for (const g of gold) if (top.has(g)) hit++;
  return hit / gold.length;
}

function main(): void {
  const root = resolve(arg("--project", "."));
  const split = Math.min(0.9, Math.max(0.1, parseFloat(arg("--split", "0.7"))));
  const limitRaw = parseInt(arg("--limit", "600"), 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 600;
  const K = 10;

  const all = commitsChrono(root, limit);
  if (all.length < 10) {
    console.log(`Not enough qualifying commits (${all.length}) for a temporal holdout.`);
    return;
  }
  const cut = Math.floor(all.length * split);
  const train = all.slice(0, cut);
  const test = all.slice(cut);

  // Training co-change counts + global change frequency (popularity baseline).
  const co = new Map<string, Map<string, number>>();
  const freq = new Map<string, number>();
  const trainFiles = new Set<string>();
  for (const c of train) {
    for (const f of c.files) {
      freq.set(f, (freq.get(f) ?? 0) + 1);
      trainFiles.add(f);
    }
    for (let i = 0; i < c.files.length; i++) {
      for (let j = i + 1; j < c.files.length; j++) {
        const a = c.files[i], b = c.files[j];
        if (!co.has(a)) co.set(a, new Map());
        if (!co.has(b)) co.set(b, new Map());
        co.get(a)!.set(b, (co.get(a)!.get(b) ?? 0) + 1);
        co.get(b)!.set(a, (co.get(b)!.get(a) ?? 0) + 1);
      }
    }
  }
  // Universe of files path-reach may draw on. Uses ALL commits' filenames (not
  // just training) — this leaks candidate *existence*, never the co-change *label*
  // (path-reach is pure path-math, it can propose a file but cannot know it
  // co-changed). It mirrors production, where the broker sees every file on disk.
  // Co-change neighbours are still drawn ONLY from training, so that leg is strict.
  const universe = [...new Set([...all.flatMap((c) => c.files)])];
  // Popularity ranking (global, f1-independent) — the naive baseline.
  const popRanked = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([f]) => f);

  const cochangeNeighbours = (f1: string): string[] => {
    const m = co.get(f1);
    if (!m) return [];
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([f]) => f);
  };
  const pathRanked = (f1: string): string[] => {
    const seen = new Set<string>([f1]);
    const out: string[] = [];
    for (const f of testImplCounterparts(f1, universe)) if (!seen.has(f)) { seen.add(f); out.push(f); }
    for (const f of sameDirSiblings(f1, universe)) if (!seen.has(f)) { seen.add(f); out.push(f); }
    return out;
  };
  const combined = (f1: string): string[] => {
    const seen = new Set<string>([f1]);
    const out: string[] = [];
    for (const f of cochangeNeighbours(f1)) if (!seen.has(f)) { seen.add(f); out.push(f); }
    for (const f of pathRanked(f1)) if (!seen.has(f)) { seen.add(f); out.push(f); }
    return out;
  };

  let trials = 0, unseenF1 = 0, goldFiles = 0, goldUnseen = 0;
  const acc = { cochange: 0, path: 0, combined: 0, pop: 0 };
  const perCommit = { cochange: [] as number[], combined: [] as number[], pop: [] as number[] };

  for (const c of test) {
    const cc: number[] = [], cm: number[] = [], pp: number[] = [];
    for (const f1 of c.files) {
      const gold = c.files.filter((g) => g !== f1);
      if (gold.length === 0) continue;
      trials++;
      goldFiles += gold.length;
      goldUnseen += gold.filter((g) => !trainFiles.has(g)).length;
      if (!co.has(f1)) unseenF1++;
      const rCo = recallAtK(cochangeNeighbours(f1), gold, K);
      const rPath = recallAtK(pathRanked(f1), gold, K);
      const rCmb = recallAtK(combined(f1), gold, K);
      const rPop = recallAtK(popRanked.filter((f) => f !== f1), gold, K);
      acc.cochange += rCo; acc.path += rPath; acc.combined += rCmb; acc.pop += rPop;
      cc.push(rCo); cm.push(rCmb); pp.push(rPop);
    }
    if (cc.length > 0) { perCommit.cochange.push(mean(cc)); perCommit.combined.push(mean(cm)); perCommit.pop.push(mean(pp)); }
  }

  if (trials === 0) { console.log("No scorable test trials."); return; }
  const pct = (n: number): string => `${((n / trials) * 100).toFixed(1)}%`;
  const ciCo = clusterBootstrapCI(perCommit.cochange, { seed: 3 });
  const ciCm = clusterBootstrapCI(perCommit.combined, { seed: 3 });
  // Paired per-commit lift of COMBINED over the popularity baseline (the honest test).
  const liftPairs = perCommit.combined.map((v, i) => v - perCommit.pop[i]);
  const ciLift = clusterBootstrapCI(liftPairs, { seed: 3 });

  console.log(`
  cochange temporal-holdout — does PAST co-change predict FUTURE co-change?
  ${all.length} qualifying commits · train ${train.length} (oldest ${(split * 100).toFixed(0)}%) → test ${test.length} · ${trials} (commit,f1) trials

  recall@${K}:
    COCHANGE (past→future)        ${pct(acc.cochange)}
    PATHREACH (siblings+test↔impl) ${pct(acc.path)}
    COMBINED (cochange+path)      ${pct(acc.combined)}
    POPULARITY (naive baseline)   ${pct(acc.pop)}   ← co-change must beat this

  per-commit macro recall@${K} (95% CI):
    COCHANGE  ${(ciCo.mean * 100).toFixed(1)}% [${(ciCo.lo * 100).toFixed(1)}, ${(ciCo.hi * 100).toFixed(1)}]
    COMBINED  ${(ciCm.mean * 100).toFixed(1)}% [${(ciCm.lo * 100).toFixed(1)}, ${(ciCm.hi * 100).toFixed(1)}]
  COMBINED lift over popularity (95% CI): ${(ciLift.mean * 100).toFixed(1)}pp [${(ciLift.lo * 100).toFixed(1)}, ${(ciLift.hi * 100).toFixed(1)}] ${ciLift.lo > 0 ? "— excludes 0 → real" : "— includes 0 → NOT distinguishable"}

  Honest disclosures:
  • Temporal split: edges learned ONLY from the oldest ${(split * 100).toFixed(0)}% of commits; gold is the
    newest ${((1 - split) * 100).toFixed(0)}% — disjoint, no label leakage.
  • ${pct(unseenF1)} of test f1 files were never seen co-changing in training → 0 co-change recall by construction.
  • ${((goldUnseen / Math.max(1, goldFiles)) * 100).toFixed(1)}% of gold files never appeared in training at all (unpredictable from history).
  • POPULARITY is the f1-independent "these files always change" baseline — the bar co-change must clear to prove it carries pairwise signal, not just hot-file frequency.
  • Self-/single-repo, small N — replicate before quoting. STRUCTURAL recall, not task success.
`);
}

main();
