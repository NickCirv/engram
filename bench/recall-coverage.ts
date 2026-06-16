#!/usr/bin/env tsx
/**
 * engram — recall-coverage benchmark (#85, ADR-0009). The deterministic half of
 * the recall→resolve proof (the live resolve-rate A/B is the budget-gated half).
 *
 * QUESTION: given a real historical commit that changed ≥2 source files, if the
 * agent starts on ONE of them, does engram's ranked related-files answer surface
 * the OTHER files the commit touched — before the agent greps around to find
 * them? Gold = git co-change (a real outcome). This is STRUCTURAL recall, NOT
 * task success / resolve-rate.
 *
 * METHOD (honest by construction — see ADR-0009 + the Phase-0 backtest):
 *   - candidate related files for f1 = callers(f1's symbols) ∪ callees(f1).
 *     `impact` (transitive blast radius) is DELIBERATELY EXCLUDED — it returns up
 *     to ~81% of the repo on hub files, so "recall against 81% of the codebase"
 *     is a vanity number our own honesty discipline rejects.
 *   - rank candidates with engram's real ranker: personalized PageRank seeded on
 *     f1's symbols. recall@k = |gold_others ∩ top-k| / |gold_others|; MRR over
 *     the first gold hit. Every changed file is rotated as f1 (mean AND worst).
 *   - reported against a random-chance baseline (k / #source-files).
 *
 * Run: npx tsx bench/recall-coverage.ts [--project .] [--limit 60]
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { getStore } from "../src/core.js";
import { findCallers, findCallees, findImporters, findImports } from "../src/graph/traversal.js";
import { pageRank } from "../src/graph/pagerank.js";
import { clusterBootstrapCI, mean as avg } from "./stats.js";

interface Node { id: string; label: string; kind: string; sourceFile: string }
interface Edge { source: string; target: string; relation: string }

const CALLABLE = new Set(["function", "class", "method", "interface", "type", "variable"]);
const IS_TEST = /(^|\/)(tests?|__tests__|spec|bench)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/i;
const IS_SOURCE = (p: string): boolean => /\.[cm]?[jt]sx?$/.test(p) && !IS_TEST.test(p) && !/(^|\/)(docs|examples|scripts)\//i.test(p);

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

/** Historical commits → their changed source files (the gold co-change sets). */
function goldCommits(root: string, limit: number): Array<{ hash: string; files: string[] }> {
  const out = execFileSync(
    "git",
    ["-C", root, "log", "--no-merges", "-n", "400", "--name-status", "--pretty=format:%H", "--diff-filter=AM"],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
  );
  const commits: Array<{ hash: string; files: string[] }> = [];
  let cur: { hash: string; files: string[] } | null = null;
  for (const line of out.split("\n")) {
    if (/^[0-9a-f]{40}$/.test(line)) {
      if (cur && cur.files.length >= 2) commits.push(cur);
      cur = { hash: line, files: [] };
    } else if (cur) {
      const m = line.match(/^[AM]\t(.+)$/); // skip renames (R) / deletes (D)
      if (m && IS_SOURCE(m[1])) cur.files.push(m[1]);
    }
  }
  if (cur && cur.files.length >= 2) commits.push(cur);
  return commits.slice(0, limit);
}

function main(): void {
  const root = resolve(arg("--project", "."));
  const limitRaw = parseInt(arg("--limit", "60"), 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 60;
  const K1 = 5, K2 = 10;

  getStore(root).then((store) => {
    const nodes = store.getAllNodes() as unknown as Node[];
    const edges = store.getAllEdges() as unknown as Edge[];
    store.close();

    // Index: file → its symbol node-ids + names; node-id → sourceFile.
    const fileSyms = new Map<string, { ids: string[]; names: string[] }>();
    const sourceFileById = new Map<string, string>();
    const knownFiles = new Set<string>();
    for (const n of nodes) {
      sourceFileById.set(n.id, n.sourceFile);
      if (n.kind === "file") knownFiles.add(n.sourceFile);
      if (CALLABLE.has(n.kind)) {
        let e = fileSyms.get(n.sourceFile);
        if (!e) fileSyms.set(n.sourceFile, (e = { ids: [], names: [] }));
        e.ids.push(n.id);
        e.names.push(n.label);
      }
    }
    const totalSourceFiles = [...knownFiles].filter(IS_SOURCE).length || 1;

    // Candidate related files for f1 (callers ∪ callees), ranked by personalized
    // PageRank seeded on f1's symbols. impact() deliberately excluded.
    function rankedRelated(f1: string): string[] {
      const f1sym = fileSyms.get(f1);
      if (!f1sym || f1sym.ids.length === 0) return [];
      const cand = new Set<string>();
      for (const name of f1sym.names) for (const cf of findCallers(nodes as never, edges as never, name)) if (cf !== f1) cand.add(cf);
      for (const c of findCallees(nodes as never, edges as never, f1)) if (c.file !== f1) cand.add(c.file);
      // #138: widen reach with import edges (file→file) — non-circular vs the co-change gold.
      for (const f of findImporters(nodes as never, edges as never, f1)) if (f !== f1) cand.add(f);
      for (const f of findImports(nodes as never, edges as never, f1)) if (f !== f1) cand.add(f);
      if (cand.size === 0) return [];

      // PageRank over the f1 + candidate-file subgraph, personalized on f1's symbols.
      const scope = new Set<string>([f1, ...cand]);
      const ids = nodes.filter((n) => scope.has(n.sourceFile)).map((n) => n.id);
      const personalization = new Map(f1sym.ids.map((id) => [id, 1] as const));
      const scores = pageRank(ids, edges as never, { personalization });
      const fileScore = new Map<string, number>();
      for (const id of ids) {
        const f = sourceFileById.get(id)!;
        if (cand.has(f)) fileScore.set(f, (fileScore.get(f) ?? 0) + (scores.get(id) ?? 0));
      }
      return [...cand].sort((a, b) => (fileScore.get(b) ?? 0) - (fileScore.get(a) ?? 0) || a.localeCompare(b));
    }

    const commits = goldCommits(root, limit);
    let r5 = 0, r10 = 0, mrr = 0, trials = 0, hit = 0;
    // Honesty instrumentation (adversarial review): separate candidate generation
    // from ranking, expose the method's own reachable ceiling, disclose exclusions.
    let randW5 = 0, randW10 = 0, ceilingSum = 0, allGoldFiles = 0, noSymGoldFiles = 0;
    const perCommitWorst: number[] = [];
    // Per-commit means for the cluster bootstrap. The COMMIT is the independent
    // unit — trials within a commit are correlated — so the CI resamples commits.
    const perCommitEngram: number[] = [];
    const perCommitRandom: number[] = [];

    for (const c of commits) {
      allGoldFiles += c.files.length;
      noSymGoldFiles += c.files.filter((f) => !fileSyms.has(f)).length;
      // Only score gold files engram actually knows (present as graph nodes).
      const gold = c.files.filter((f) => fileSyms.has(f));
      if (gold.length < 2) continue;
      const commitR10: number[] = [];
      const commitRand10: number[] = [];
      for (const f1 of gold) {
        const others = gold.filter((g) => g !== f1);
        const ranked = rankedRelated(f1);
        trials++;
        const top5 = new Set(ranked.slice(0, K1));
        const top10 = new Set(ranked.slice(0, K2));
        const rec5 = others.filter((o) => top5.has(o)).length / others.length;
        const rec10 = others.filter((o) => top10.has(o)).length / others.length;
        r5 += rec5; r10 += rec10; commitR10.push(rec10);
        if (rec10 > 0) hit++;
        const firstHit = ranked.findIndex((f) => others.includes(f));
        if (firstHit >= 0) mrr += 1 / (firstHit + 1);
        // Reachable (membership) ceiling + analytic random-order-within-candidates
        // baseline (deterministic — isolates the PageRank ranker's own lift).
        const C = ranked.length;
        const reachable = others.filter((o) => ranked.includes(o)).length;
        ceilingSum += reachable / others.length;
        if (C > 0) {
          randW5 += (reachable * Math.min(K1, C)) / C / others.length;
          const randTrial10 = (reachable * Math.min(K2, C)) / C / others.length;
          randW10 += randTrial10;
          commitRand10.push(randTrial10);
        } else {
          commitRand10.push(0); // no candidates → random recall is 0 (stays aligned with commitR10)
        }
      }
      if (commitR10.length > 0) {
        perCommitWorst.push(Math.min(...commitR10));
        perCommitEngram.push(avg(commitR10));
        perCommitRandom.push(avg(commitRand10));
      }
    }

    if (trials === 0) {
      console.log(
        `\n  recall-coverage: no eligible trials — needs commits with ≥2 known source files (no merges/renames).\n  Found ${commits.length} candidate commit(s) at --limit ${limit}; none had ≥2 graph-known files.\n  Try a repo with more history, re-run \`engram init\`, or raise --limit.\n`
      );
      return;
    }
    const pct = (x: number): string => (100 * x).toFixed(1) + "%";
    const chance5 = K1 / totalSourceFiles, chance10 = K2 / totalSourceFiles;
    console.log("");
    console.log("  engram — recall-coverage benchmark (structural co-change prediction)");
    console.log(`  ${commits.length} commits (≥2 known source files, no merges/renames) · ${trials} (commit,f1) trials\n`);
    const ceiling = ceilingSum / trials;
    console.log(`  recall@5:   ${pct(r5 / trials).padStart(6)}   (blind-grep chance: ${pct(chance5)} · random-order within candidates: ${pct(randW5 / trials)})`);
    console.log(`  recall@10:  ${pct(r10 / trials).padStart(6)}   (blind-grep chance: ${pct(chance10)} · random-order within candidates: ${pct(randW10 / trials)})`);
    console.log(`  MRR:        ${(mrr / trials).toFixed(3)}`);
    console.log(`  trials with ≥1 hit @10: ${pct(hit / trials)}`);
    console.log(`  worst-case recall@10 (mean of per-commit minimums): ${pct(perCommitWorst.reduce((a, b) => a + b, 0) / (perCommitWorst.length || 1))}`);
    console.log("");
    console.log(`  Where the signal comes from (honest decomposition):`);
    console.log(`  • candidate generation (callers∪callees∪imports) reaches ${pct(ceiling)} of co-changed files;`);
    console.log(`    PageRank ranking then captures ${pct((r10 / trials) / (ceiling || 1))} of that reachable set at @10`);
    console.log(`    (vs ${pct(randW10 / trials)} for random ordering of the same candidates — the ranker's own lift).`);
    console.log("");
    // Cluster bootstrap (resampling COMMITS — the independent unit) → honest error
    // bars on the headline, and whether the ranker's lift is distinguishable from random.
    const recCI = clusterBootstrapCI(perCommitEngram, { seed: 1 });
    const liftCI = clusterBootstrapCI(
      perCommitEngram.map((e, i) => e - perCommitRandom[i]),
      { seed: 2 }
    );
    const pp = (x: number): string => (x >= 0 ? "+" : "") + (100 * x).toFixed(1) + "pp";
    console.log(`  recall@10 (per-commit macro, 95% CI over ${recCI.n} commits): ${pct(recCI.mean)} [${pct(recCI.lo)}, ${pct(recCI.hi)}]`);
    console.log(
      `  ranker lift vs random-order (95% CI): ${pp(liftCI.mean)} [${pp(liftCI.lo)}, ${pp(liftCI.hi)}]` +
        (liftCI.lo > 0
          ? "  — excludes 0 → real"
          : "  — includes 0 → NOT distinguishable from random")
    );
    console.log("");
    console.log("  Honest caveats:");
    console.log(`  • ${pct(noSymGoldFiles / (allGoldFiles || 1))} of co-changed source files have no extracted symbols and are`);
    console.log("    excluded — engram can't structurally predict them; including them would lower recall.");
    console.log("  • STRUCTURAL recall — does engram surface the co-changed files. NOT task");
    console.log("    success / resolve-rate (that needs live agents — the gated half of #85).");
    console.log("  • Co-change ≠ structural relatedness (sibling refactors, doc+code share no");
    console.log("    call edge) — a ceiling on what ANY structural tool can predict.");
    console.log("  • `impact` (transitive blast radius) excluded — it returns up to ~81% of the");
    console.log("    repo; recall against 81% of the codebase is a vanity number.");
    console.log("  • Self-repo only (engram on engram). Generalise before quoting publicly.");
    console.log("");
  });
}

main();
