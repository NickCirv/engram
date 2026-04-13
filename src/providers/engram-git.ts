/**
 * engram:git provider — surfaces recent changes, churn rate, and last
 * author for a file from git history.
 *
 * Tier 1: internal, available when in a git repo (<100ms).
 * Uses execFileSync with a tight timeout — git log for a single file
 * is fast even on large repos.
 */
import { execFileSync } from "node:child_process";
import type { ContextProvider, NodeContext, ProviderResult } from "./types.js";

export const gitProvider: ContextProvider = {
  name: "engram:git",
  label: "CHANGES",
  tier: 1,
  tokenBudget: 50,
  timeoutMs: 200,

  async resolve(
    filePath: string,
    context: NodeContext
  ): Promise<ProviderResult | null> {
    try {
      const cwd = context.projectRoot;

      // Get last commit info for this file
      const lastLog = git(
        ["log", "-1", "--format=%ar|%an|%s", "--", filePath],
        cwd
      );
      if (!lastLog) return null;

      const [timeAgo, author, message] = lastLog.split("|", 3);

      // Get commit count in last 30 days
      const recentCount = git(
        [
          "rev-list",
          "--count",
          "--since=30.days",
          "HEAD",
          "--",
          filePath,
        ],
        cwd
      );

      const churnNote =
        context.churnRate > 0.3
          ? "high churn"
          : context.churnRate > 0.1
            ? "moderate"
            : "stable";

      const parts = [
        `  Last modified: ${timeAgo} by ${author} (${truncate(message, 50)})`,
        `  Churn: ${context.churnRate.toFixed(2)} (${churnNote}) | ${recentCount || "0"} changes in 30d`,
      ];

      return {
        provider: "engram:git",
        content: parts.join("\n"),
        confidence: 0.9,
        cached: false,
      };
    } catch {
      return null;
    }
  },

  async isAvailable(): Promise<boolean> {
    try {
      execFileSync("git", ["--version"], {
        encoding: "utf-8",
        timeout: 2000,
      });
      return true;
    } catch {
      return false;
    }
  },
};

function git(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      timeout: 3000,
      maxBuffer: 1024 * 1024,
    }).trim();
  } catch {
    return "";
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "\u2026";
}
