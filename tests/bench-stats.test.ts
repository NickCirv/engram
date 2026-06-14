/**
 * Tests for the benchmark statistics (bench/stats.ts) — the cluster-bootstrap CI
 * that gives the recall bench (and the #87 resolve-rate A/B) honest error bars.
 * Determinism is load-bearing: a CI that changes every run is not an honest one.
 */
import { describe, it, expect } from "vitest";
import { makeRng, mean, percentile, clusterBootstrapCI } from "../bench/stats.js";

describe("bench/stats: mean + percentile", () => {
  it("mean", () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(mean([])).toBe(0);
  });

  it("percentile (linear-interpolated, ascending)", () => {
    const xs = [1, 2, 3, 4, 5];
    expect(percentile(xs, 0)).toBe(1);
    expect(percentile(xs, 1)).toBe(5);
    expect(percentile(xs, 0.5)).toBe(3);
    expect(percentile(xs, 0.25)).toBe(2);
    expect(Number.isNaN(percentile([], 0.5))).toBe(true);
    expect(percentile([7], 0.9)).toBe(7);
  });
});

describe("bench/stats: makeRng determinism", () => {
  it("same seed → identical sequence; different seed → different", () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    const c = makeRng(43);
    expect([c(), c(), c()]).not.toEqual(seqA);
    for (const v of seqA) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThan(1);
  });
});

describe("bench/stats: clusterBootstrapCI", () => {
  it("no variance → degenerate CI at the constant", () => {
    const ci = clusterBootstrapCI([5, 5, 5, 5], { iterations: 500, seed: 1 });
    expect(ci.mean).toBe(5);
    expect(ci.lo).toBe(5);
    expect(ci.hi).toBe(5);
    expect(ci.n).toBe(4);
  });

  it("brackets the mean and stays within the data range", () => {
    const data = [0, 0.25, 0.5, 0.75, 1];
    const ci = clusterBootstrapCI(data, { iterations: 2000, seed: 7 });
    expect(ci.mean).toBeCloseTo(0.5, 10);
    expect(ci.lo).toBeGreaterThanOrEqual(0);
    expect(ci.hi).toBeLessThanOrEqual(1);
    expect(ci.lo).toBeLessThanOrEqual(ci.mean);
    expect(ci.hi).toBeGreaterThanOrEqual(ci.mean);
    expect(ci.lo).toBeLessThan(ci.hi); // real spread
  });

  it("is reproducible for a fixed seed", () => {
    const data = [0.1, 0.4, 0.2, 0.9, 0.3, 0.6];
    const a = clusterBootstrapCI(data, { iterations: 1000, seed: 99 });
    const b = clusterBootstrapCI(data, { iterations: 1000, seed: 99 });
    expect([a.lo, a.hi]).toEqual([b.lo, b.hi]);
  });

  it("a positive-lift sample yields a CI whose lower bound excludes 0", () => {
    // every cluster strictly positive → the mean's CI must be > 0
    const lift = [0.2, 0.15, 0.3, 0.25, 0.18, 0.22, 0.27, 0.19];
    const ci = clusterBootstrapCI(lift, { iterations: 2000, seed: 3 });
    expect(ci.lo).toBeGreaterThan(0);
  });

  it("handles n=0 and n=1 gracefully", () => {
    const z = clusterBootstrapCI([], {});
    expect(z.n).toBe(0);
    expect(Number.isNaN(z.mean)).toBe(true);
    const one = clusterBootstrapCI([0.42], {});
    expect(one.n).toBe(1);
    expect(one.lo).toBe(0.42);
    expect(one.hi).toBe(0.42);
  });
});
