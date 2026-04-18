/**
 * Vitest configuration.
 *
 * Defaults are vitest stock values outside CI. Inside CI (CI=true, set
 * automatically by GitHub Actions and most runners), we:
 *
 * 1. Retry each test once on failure. Single retry buys us a warm-worker
 *    second attempt, which reliably clears the handful of cold-start
 *    flakes we've observed on Windows Node runners (first-call Intl init,
 *    lazy module load, spiky Actions VM I/O). Real bugs still fail twice
 *    in a row and surface cleanly.
 *
 * 2. Raise the per-test timeout from 5000ms to 15000ms. GitHub's
 *    windows-latest runners have been observed to take up to 5s on the
 *    first test in a cold worker just to import the module graph.
 *    15s is comfortably above the p99 observed run time while still
 *    catching genuine hangs.
 *
 * Keep the local defaults tight (5000ms, no retry) so developers notice
 * slow tests on their machine before they ship.
 */
import { defineConfig } from "vitest/config";

const isCI = process.env.CI === "true";

export default defineConfig({
  test: {
    retry: isCI ? 1 : 0,
    testTimeout: isCI ? 15000 : 5000,
    hookTimeout: isCI ? 15000 : 5000,
  },
});
