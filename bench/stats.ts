/**
 * Small, dependency-free statistics for the benchmarks — deterministic so a
 * reported confidence interval is reproducible run-to-run (an "honest number"
 * that changes every run is not honest). Used by the recall-coverage bench and
 * the #87 resolve-rate A/B harness.
 *
 * The key tool is a CLUSTER bootstrap: recall/resolve trials are clustered
 * within a commit/instance (non-independent), so resampling individual trials
 * would understate the variance. We resample the CLUSTERS (commits/instances)
 * with replacement, which is the statistically correct unit.
 */

/** Deterministic PRNG (mulberry32) — seeded, so a bootstrap CI reproduces exactly. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Arithmetic mean; 0 for an empty list (callers guard n=0 explicitly). */
export function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Linear-interpolated percentile of an ASCENDING-sorted array. `p` in [0, 1].
 * NaN for an empty array; the single value for a 1-element array.
 */
export function percentile(sortedAsc: readonly number[], p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return NaN;
  if (n === 1) return sortedAsc[0];
  const idx = Math.min(Math.max(p, 0), 1) * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

export interface BootstrapCI {
  /** Point estimate: mean of the observed cluster values. */
  readonly mean: number;
  /** Lower / upper bound of the (1 - alpha) CI. */
  readonly lo: number;
  readonly hi: number;
  /** Number of clusters (sample size for the bootstrap). */
  readonly n: number;
  readonly iterations: number;
}

/**
 * Cluster bootstrap CI for the MEAN of `clusterValues` (one value per cluster —
 * e.g. each commit's mean recall@10, or each instance's resolve indicator).
 * Resamples clusters with replacement `iterations` times, recomputes the mean,
 * and returns the empirical [alpha/2, 1-alpha/2] percentile interval.
 *
 * Deterministic given `seed`. n=0 → NaN bounds; n=1 → a degenerate point CI
 * (lo=hi=mean) since a single cluster carries no resampling spread.
 */
export function clusterBootstrapCI(
  clusterValues: readonly number[],
  opts: { iterations?: number; alpha?: number; seed?: number } = {}
): BootstrapCI {
  const n = clusterValues.length;
  const iterations = opts.iterations ?? 2000;
  const alpha = opts.alpha ?? 0.05;
  const seed = opts.seed ?? 1;
  const m = mean(clusterValues);
  if (n === 0) return { mean: NaN, lo: NaN, hi: NaN, n: 0, iterations };
  if (n === 1) return { mean: m, lo: m, hi: m, n: 1, iterations };

  const rng = makeRng(seed);
  const resampledMeans: number[] = new Array(iterations);
  for (let b = 0; b < iterations; b++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += clusterValues[Math.floor(rng() * n)];
    resampledMeans[b] = sum / n;
  }
  resampledMeans.sort((a, b) => a - b);
  return {
    mean: m,
    lo: percentile(resampledMeans, alpha / 2),
    hi: percentile(resampledMeans, 1 - alpha / 2),
    n,
    iterations,
  };
}
