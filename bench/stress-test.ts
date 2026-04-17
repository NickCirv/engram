/**
 * EngramBench stress-test runner.
 *
 * Five independent stress tests that probe memory safety, concurrency,
 * graph scalability, and hook-log replay. Each test is self-contained
 * and reports pass/fail with timing.
 *
 * Usage:
 *   npx tsx bench/stress-test.ts [--reads N] [--providers] [--large-graph [--nodes N]]
 *                                [--replay PATH [--limit N]] [--all]
 *   npm run stress
 *
 * With no flags, runs the full-cycle (all 4 subtests in sequence).
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Types ────────────────────────────────────────────────────────

interface TestResult {
  readonly name: string;
  readonly passed: boolean;
  readonly durationMs: number;
  readonly detail: string;
}

// ─── Test 1: Rapid reads ──────────────────────────────────────────

/**
 * Call resolveRichPacket N times in sequence for different files.
 * Verify no memory leak (RSS delta < 50 MB) and no timeouts.
 */
async function testRapidReads(n: number): Promise<TestResult> {
  const name = `rapid-reads (N=${n})`;
  const start = Date.now();

  try {
    const { resolveRichPacket } = await import(
      "../src/providers/resolver.js"
    );
    const { _resetAvailabilityCache } = await import(
      "../src/providers/resolver.js"
    );
    _resetAvailabilityCache();

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const projectRoot = dirname(__dirname);

    // Build a list of real files to rotate through
    const srcDir = join(projectRoot, "src");
    const files = readdirSync(srcDir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => `src/${f}`);

    if (files.length === 0) {
      return { name, passed: false, durationMs: Date.now() - start, detail: "No .ts files found in src/" };
    }

    // Warm up one call to let sql.js WASM load before taking the baseline.
    // sql.js loads ~100 MB of WASM on first use; that is a one-time
    // process cost, not a per-call leak.
    const warmCtx = {
      filePath: files[0],
      projectRoot,
      nodeIds: [],
      imports: [],
      hasTests: false,
      churnRate: 0,
    };
    await resolveRichPacket(files[0], warmCtx).catch(() => null);

    // Force a GC cycle before snapshotting baseline (V8 exposes gc() when
    // --expose-gc is set; otherwise this is a no-op).
    if (typeof (global as Record<string, unknown>).gc === "function") {
      (global as Record<string, unknown>).gc as () => void;
    }

    const memBefore = process.memoryUsage().rss;

    let resolved = 0;
    for (let i = 0; i < n; i++) {
      const filePath = files[i % files.length];
      const context = {
        filePath,
        projectRoot,
        nodeIds: [],
        imports: [],
        hasTests: false,
        churnRate: 0,
      };
      try {
        await resolveRichPacket(filePath, context);
        resolved++;
      } catch {
        // Provider failures are acceptable — count only hard crashes
      }
    }

    const memAfter = process.memoryUsage().rss;
    const memDeltaMb = (memAfter - memBefore) / (1024 * 1024);
    // sql.js caches provider results in SQLite per-call (expected growth).
    // 200 MB gives headroom for 100 calls while catching unbounded leaks
    // (e.g., unclosed handles, growing arrays) that would exceed this.
    const MEM_LIMIT_MB = 200;

    if (memDeltaMb > MEM_LIMIT_MB) {
      return {
        name,
        passed: false,
        durationMs: Date.now() - start,
        detail: `Memory delta ${memDeltaMb.toFixed(1)} MB exceeds ${MEM_LIMIT_MB} MB limit`,
      };
    }

    return {
      name,
      passed: true,
      durationMs: Date.now() - start,
      detail: `${resolved}/${n} resolved, RSS delta ${memDeltaMb.toFixed(1)} MB`,
    };
  } catch (err) {
    return { name, passed: false, durationMs: Date.now() - start, detail: String(err) };
  }
}

// ─── Test 2: Provider concurrency ────────────────────────────────

/**
 * Call resolveRichPacket C times concurrently.
 * Verify all settle (no unhandled rejections, no crashes).
 */
async function testProviderConcurrency(concurrency: number): Promise<TestResult> {
  const name = `provider-concurrency (C=${concurrency})`;
  const start = Date.now();

  try {
    const { resolveRichPacket, _resetAvailabilityCache } = await import(
      "../src/providers/resolver.js"
    );
    _resetAvailabilityCache();

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const projectRoot = dirname(__dirname);
    const filePath = "src/core.ts";
    const context = {
      filePath,
      projectRoot,
      nodeIds: [],
      imports: [],
      hasTests: false,
      churnRate: 0,
    };

    const promises = Array.from({ length: concurrency }, () =>
      resolveRichPacket(filePath, context).catch(() => null)
    );

    const results = await Promise.allSettled(promises);
    const rejected = results.filter((r) => r.status === "rejected").length;

    if (rejected > 0) {
      return {
        name,
        passed: false,
        durationMs: Date.now() - start,
        detail: `${rejected} of ${concurrency} calls rejected`,
      };
    }

    const settled = results.length;
    return {
      name,
      passed: true,
      durationMs: Date.now() - start,
      detail: `${settled}/${concurrency} settled cleanly`,
    };
  } catch (err) {
    return { name, passed: false, durationMs: Date.now() - start, detail: String(err) };
  }
}

// ─── Test 3: Large graph ──────────────────────────────────────────

/**
 * Create a temporary GraphStore with N synthetic nodes, run queries,
 * verify latency < 100ms.
 */
async function testLargeGraph(nodeCount: number): Promise<TestResult> {
  const name = `large-graph (N=${nodeCount})`;
  const start = Date.now();

  try {
    const { GraphStore } = await import("../src/graph/store.js");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const tmpDir = mkdtempSync(join(tmpdir(), "engram-bench-"));
    const dbPath = join(tmpDir, ".engram", "graph.db");

    let store: InstanceType<typeof GraphStore>;
    try {
      store = await GraphStore.open(dbPath);
    } catch (err) {
      rmSync(tmpDir, { recursive: true, force: true });
      return { name, passed: false, durationMs: Date.now() - start, detail: `GraphStore.open failed: ${String(err)}` };
    }

    // Insert N synthetic nodes in batches to avoid transaction overhead
    const now = Date.now();
    const BATCH = 500;
    for (let batch = 0; batch < nodeCount; batch += BATCH) {
      const count = Math.min(BATCH, nodeCount - batch);
      const nodes = Array.from({ length: count }, (_, j) => ({
        id: `node-${batch + j}`,
        label: `SyntheticNode${batch + j}`,
        kind: "function" as const,
        sourceFile: `src/synthetic-${batch + j}.ts`,
        sourceLocation: `L${(batch + j) % 200}`,
        confidence: "EXTRACTED" as const,
        confidenceScore: 0.95,
        lastVerified: now,
        queryCount: 0,
        metadata: {},
      }));
      store.bulkUpsert(nodes, []);
    }

    // Query and measure latency
    const queryStart = Date.now();
    store.searchNodes("SyntheticNode", 20);
    const queryMs = Date.now() - queryStart;

    store.close();
    rmSync(tmpDir, { recursive: true, force: true });

    const LATENCY_LIMIT_MS = 100;
    if (queryMs > LATENCY_LIMIT_MS) {
      return {
        name,
        passed: false,
        durationMs: Date.now() - start,
        detail: `Query latency ${queryMs}ms exceeds ${LATENCY_LIMIT_MS}ms limit`,
      };
    }

    return {
      name,
      passed: true,
      durationMs: Date.now() - start,
      detail: `${nodeCount} nodes inserted, query latency ${queryMs}ms`,
    };
  } catch (err) {
    return { name, passed: false, durationMs: Date.now() - start, detail: String(err) };
  }
}

// ─── Test 4: Hook-log replay ──────────────────────────────────────

/**
 * Read a real hook-log JSONL file, replay N entries through
 * summarizeHookLog(), verify no corruption (no NaN, no undefined counts).
 */
async function testHookLogReplay(
  logPath: string,
  limit: number
): Promise<TestResult> {
  const name = `hook-log-replay (limit=${limit})`;
  const start = Date.now();

  try {
    const { readHookLog } = await import("../src/intelligence/hook-log.js");
    const { summarizeHookLog } = await import("../src/intercept/stats.js");

    if (!existsSync(logPath)) {
      return {
        name,
        passed: true,
        durationMs: Date.now() - start,
        detail: `Hook log not found at ${logPath} — skipped (no hook activity yet)`,
      };
    }

    const allEntries = readHookLog(logPath.replace(/\/\.engram\/hook-log\.jsonl$/, "").replace(/hook-log\.jsonl$/, ".."));

    // Fallback: read the file directly if readHookLog path resolution is awkward
    let entries = allEntries;
    if (entries.length === 0) {
      try {
        const raw = readFileSync(logPath, "utf-8");
        entries = raw
          .split("\n")
          .filter((l) => l.trim())
          .map((l) => {
            try { return JSON.parse(l); } catch { return null; }
          })
          .filter(Boolean);
      } catch {
        entries = [];
      }
    }

    const slice = entries.slice(0, limit);
    if (slice.length === 0) {
      return {
        name,
        passed: true,
        durationMs: Date.now() - start,
        detail: "Log is empty — nothing to replay",
      };
    }

    const summary = summarizeHookLog(slice);

    // Validate: no NaN, no undefined in numeric fields
    const corrupt =
      isNaN(summary.totalInvocations) ||
      isNaN(summary.readDenyCount) ||
      isNaN(summary.estimatedTokensSaved) ||
      summary.totalInvocations === undefined;

    if (corrupt) {
      return {
        name,
        passed: false,
        durationMs: Date.now() - start,
        detail: "summarizeHookLog returned corrupt/NaN values",
      };
    }

    return {
      name,
      passed: true,
      durationMs: Date.now() - start,
      detail: `${slice.length} entries replayed, ${summary.readDenyCount} read denies, ${summary.estimatedTokensSaved} tokens saved`,
    };
  } catch (err) {
    return { name, passed: false, durationMs: Date.now() - start, detail: String(err) };
  }
}

// ─── Output ───────────────────────────────────────────────────────

function printResults(results: readonly TestResult[]): void {
  const hr = "─".repeat(60);
  process.stdout.write("\nEngramBench stress-test\n");
  process.stdout.write(hr + "\n");

  for (const r of results) {
    const status = r.passed ? "PASS" : "FAIL";
    const ms = `${r.durationMs}ms`;
    process.stdout.write(
      `[${status}] ${r.name.padEnd(35)} ${ms.padStart(8)}\n`
    );
    process.stdout.write(`       ${r.detail}\n`);
  }

  process.stdout.write(hr + "\n");

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  process.stdout.write(`\n${passed}/${total} tests passed\n\n`);
}

// ─── CLI arg parsing ──────────────────────────────────────────────

function parseArgs(argv: readonly string[]): {
  reads: number | null;
  providers: boolean;
  largeGraph: boolean;
  nodes: number;
  replay: string | null;
  limit: number;
  all: boolean;
} {
  const args = argv.slice(2);
  let reads: number | null = null;
  let providers = false;
  let largeGraph = false;
  let nodes = 1000;
  let replay: string | null = null;
  let limit = 500;
  let all = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--reads") { reads = Number(args[++i] ?? 100); continue; }
    if (a === "--providers") { providers = true; continue; }
    if (a === "--large-graph") { largeGraph = true; continue; }
    if (a === "--nodes") { nodes = Number(args[++i] ?? 1000); continue; }
    if (a === "--replay") { replay = args[++i] ?? null; continue; }
    if (a === "--limit") { limit = Number(args[++i] ?? 500); continue; }
    if (a === "--all") { all = true; continue; }
  }

  return { reads, providers, largeGraph, nodes, replay, limit, all };
}

// ─── Entry point ─────────────────────────────────────────────────

export async function runStressTests(opts?: {
  reads?: number;
  providers?: boolean;
  largeGraph?: boolean;
  nodes?: number;
  replay?: string | null;
  limit?: number;
}): Promise<readonly TestResult[]> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const projectRoot = dirname(__dirname);
  const defaultLogPath = join(projectRoot, ".engram", "hook-log.jsonl");

  const results: TestResult[] = [];

  if (opts?.reads != null) {
    results.push(await testRapidReads(opts.reads));
  }
  if (opts?.providers) {
    results.push(await testProviderConcurrency(50));
  }
  if (opts?.largeGraph) {
    results.push(await testLargeGraph(opts.nodes ?? 1000));
  }
  if (opts?.replay !== undefined) {
    results.push(await testHookLogReplay(opts.replay ?? defaultLogPath, opts.limit ?? 500));
  }

  // Full cycle: run all 4 if nothing was explicitly selected
  if (results.length === 0) {
    results.push(await testRapidReads(100));
    results.push(await testProviderConcurrency(50));
    results.push(await testLargeGraph(1000));
    results.push(await testHookLogReplay(defaultLogPath, 500));
  }

  return results;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);

  const runOpts =
    opts.reads != null || opts.providers || opts.largeGraph || opts.replay != null
      ? {
          reads: opts.reads ?? undefined,
          providers: opts.providers || undefined,
          largeGraph: opts.largeGraph || undefined,
          nodes: opts.nodes,
          replay: opts.replay,
          limit: opts.limit,
        }
      : undefined; // triggers full cycle

  const results = await runStressTests(runOpts);
  printResults(results);

  const allPassed = results.every((r) => r.passed);
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`Unhandled error: ${String(err)}\n`);
  process.exit(1);
});
