/**
 * Git Miner — extracts change patterns, authorship, and file evolution from git history.
 * Produces INFERRED edges: frequently co-changed files, hot files, authorship nodes.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { GraphEdge, GraphNode } from "../graph/schema.js";

interface GitMineResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function runGit(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 15000,
    }).trim();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("TIMEOUT") || msg.includes("timed out")) {
      console.error(`[engram] git command timed out: git ${args.join(" ")}`);
    }
    return "";
  }
}

function makeId(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join("_")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

/**
 * Mine git history for co-change patterns and authorship.
 * Creates INFERRED edges between files that frequently change together.
 */
export function mineGitHistory(
  projectRoot: string,
  maxCommits = 200
): GitMineResult {
  const root = resolve(projectRoot);
  const now = Date.now();
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // Check if this is a git repo
  const isGit = runGit(["rev-parse", "--git-dir"], root);
  if (!isGit) return { nodes, edges };

  // Get recent commits with files changed
  const log = runGit(
    [
      "log",
      `--max-count=${maxCommits}`,
      "--pretty=format:%H|%an|%s",
      "--name-only",
    ],
    root
  );

  if (!log) return { nodes, edges };

  // Parse commits into file groups
  const coChangeMap = new Map<string, Map<string, number>>();
  const fileChangeCount = new Map<string, number>();
  const authorMap = new Map<string, Set<string>>();
  const commitBlocks = log.split("\n\n").filter(Boolean);

  // Skip build/dist directories to avoid explosion of co-change pairs
  const SKIP_PREFIXES = ["dist/", "build/", "node_modules/", ".venv/", "target/", "coverage/"];
  const MAX_FILES_PER_COMMIT = 50; // Prevent O(n²) explosion

  for (const block of commitBlocks) {
    const lines = block.split("\n").filter(Boolean);
    if (lines.length === 0) continue;

    const [header, ...fileLines] = lines;
    const parts = header.split("|");
    if (parts.length < 3) continue;

    const author = parts[1];
    let files = fileLines.filter(
      (f) =>
        f.length > 0 &&
        !f.includes("|") &&
        !f.startsWith(" ") &&
        f.includes(".") &&
        !SKIP_PREFIXES.some((p) => f.startsWith(p))
    );

    // Limit files per commit to prevent O(n²) explosion
    if (files.length > MAX_FILES_PER_COMMIT) {
      files = files.slice(0, MAX_FILES_PER_COMMIT);
    }

    // Track file change frequency
    for (const file of files) {
      fileChangeCount.set(file, (fileChangeCount.get(file) ?? 0) + 1);

      // Track authorship
      if (!authorMap.has(file)) authorMap.set(file, new Set());
      authorMap.get(file)!.add(author);
    }

    // Track co-changes (files that change in the same commit)
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const key = [files[i], files[j]].sort().join("|");
        const [a, b] = key.split("|");
        if (!coChangeMap.has(a)) coChangeMap.set(a, new Map());
        coChangeMap.get(a)!.set(b, (coChangeMap.get(a)!.get(b) ?? 0) + 1);
      }
    }
  }

  // Create INFERRED edges for files that co-change frequently (3+ times)
  for (const [fileA, coFiles] of coChangeMap) {
    for (const [fileB, count] of coFiles) {
      if (count >= 3) {
        const confidence = Math.min(0.95, 0.5 + count * 0.05);
        const stemA = makeId(fileA.split("/").pop()?.replace(/\.\w+$/, "") ?? fileA);
        const stemB = makeId(fileB.split("/").pop()?.replace(/\.\w+$/, "") ?? fileB);

        edges.push({
          source: stemA,
          target: stemB,
          relation: "depends_on",
          confidence: "INFERRED",
          confidenceScore: confidence,
          sourceFile: fileA,
          sourceLocation: null,
          lastVerified: now,
          metadata: { coChangeCount: count, miner: "git" },
        });
      }
    }
  }

  // Create nodes for hot files (changed 5+ times)
  const hotFiles = [...fileChangeCount.entries()]
    .filter(([, count]) => count >= 5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  for (const [file, changeCount] of hotFiles) {
    const stem = makeId(file.split("/").pop()?.replace(/\.\w+$/, "") ?? file);
    nodes.push({
      id: `hotfile_${stem}`,
      label: `🔥 ${file} (${changeCount} changes)`,
      kind: "pattern",
      sourceFile: file,
      sourceLocation: null,
      confidence: "EXTRACTED",
      confidenceScore: 1.0,
      lastVerified: now,
      queryCount: 0,
      metadata: { changeCount, miner: "git", type: "hot_file" },
    });
  }

  return { nodes, edges };
}
