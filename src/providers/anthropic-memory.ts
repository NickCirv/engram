/**
 * anthropic:memory provider — reads Claude Code's auto-managed MEMORY.md
 * index and surfaces the entries relevant to the current file.
 *
 * Claude Code ships an Auto-Memory system (v2.1.59+, Feb 2026) that
 * writes to:
 *
 *   ~/.claude/projects/<encoded-cwd>/memory/MEMORY.md
 *
 * …where <encoded-cwd> is the project's absolute path with each forward
 * slash replaced by a hyphen (so /Users/alice/proj becomes
 * -Users-alice-proj). The leading slash maps to a leading hyphen.
 *
 * The MEMORY.md file is a flat index of bullet pointers — one line per
 * entry: a Markdown bullet with a title, a relative link to the full
 * memory file, and a one-line description separated by an em-dash.
 *
 * Each linked file in the same directory is the full memory record
 * (with optional frontmatter). This provider does NOT dereference the
 * bodies — it surfaces the index entries whose title/description match
 * the current file path, imports, or basename. Keeping it index-only
 * means the provider runs in under 10 ms even on large memory sets.
 *
 * URGENCY: Anthropic Auto-Dream (Mar 2026 infra ready, server flag off)
 * will CONSOLIDATE MEMORY.md entries over time. This bridge reads the
 * index as-is — when Auto-Dream flips on and starts merging/invalidating
 * entries, our output gets MORE relevant without any code change.
 *
 * Tier 1 (synchronous file read). Safe to run on every Read.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  ContextProvider,
  NodeContext,
  ProviderResult,
} from "./types.js";

/**
 * Encode a project absolute path the way Claude Code does for its
 * per-project memory directories. /Users/alice/proj becomes
 * -Users-alice-proj. The leading slash maps to the leading dash.
 *
 * Exported for tests and for the rare case a user wants to preview
 * the exact derived path.
 */
export function encodeProjectPath(absPath: string): string {
  // Normalize to POSIX separators first (Windows robustness).
  const posix = absPath.split(/[\\/]/).join("/");
  // Trim any trailing slash so /Users/alice/proj/ equals /Users/alice/proj.
  const trimmed = posix.replace(/\/+$/, "");
  // Replace every / with -. Leading / becomes a leading -.
  return trimmed.replace(/\//g, "-");
}

/**
 * Resolve the Auto-Memory index path for a given project root. Does
 * not check existence — the caller decides whether to short-circuit
 * on missing-file.
 */
export function getMemoryIndexPath(projectRoot: string): string {
  const encoded = encodeProjectPath(projectRoot);
  return join(homedir(), ".claude", "projects", encoded, "memory", "MEMORY.md");
}

/** Parsed index entry — the title, linked filename, and hook description. */
export interface MemoryIndexEntry {
  readonly title: string;
  readonly file: string;
  readonly description: string;
}

/**
 * Parse a MEMORY.md index. Tolerant — malformed lines are skipped.
 * Canonical shape: a bullet with Title in brackets, link in parens,
 * optional em-dash or hyphen-space, then description. Lines that don't
 * match are ignored; we never throw.
 */
export function parseMemoryIndex(content: string): MemoryIndexEntry[] {
  const entries: MemoryIndexEntry[] = [];
  const lines = content.split("\n");
  // One pattern handles en-dash, em-dash, and hyphen-space separators.
  const bullet = /^-\s*\[([^\]]+)\]\(([^)]+)\)\s*(?:[—–-]\s*)?(.*)$/;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (!line.startsWith("-")) continue;
    const match = bullet.exec(line);
    if (!match) continue;
    const [, title, file, rest] = match;
    entries.push({
      title: title.trim(),
      file: file.trim(),
      description: (rest ?? "").trim(),
    });
  }

  return entries;
}

/**
 * Relevance score (higher = more relevant) for a memory entry against
 * the current Read context. Scoring:
 *
 *   + 3  title contains file basename (without extension)
 *   + 2  description contains file basename
 *   + 2  any import name matches a word in title or description
 *   + 1  any full path segment appears in title or description
 *
 * Ties broken by index order (earlier entries assumed more recent or
 * recently-consolidated by Auto-Dream).
 */
export function scoreEntry(
  entry: MemoryIndexEntry,
  ctx: { filePath: string; imports: readonly string[] }
): number {
  const basename = ctx.filePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
  const segments = ctx.filePath.split(/[\\/]/).filter((s) => s.length > 2);
  const t = entry.title.toLowerCase();
  const d = entry.description.toLowerCase();

  let score = 0;
  if (basename.length > 2 && t.includes(basename.toLowerCase())) score += 3;
  if (basename.length > 2 && d.includes(basename.toLowerCase())) score += 2;
  for (const imp of ctx.imports) {
    const lower = imp.toLowerCase();
    if (lower.length < 3) continue;
    if (t.includes(lower) || d.includes(lower)) {
      score += 2;
      break;
    }
  }
  for (const seg of segments) {
    const lower = seg.toLowerCase();
    if (lower.length < 3) continue;
    if (t.includes(lower) || d.includes(lower)) {
      score += 1;
      break;
    }
  }
  return score;
}

/**
 * Path-override env var. When set, the provider reads MEMORY.md from
 * this exact path instead of computing it from projectRoot. Used by
 * tests + advanced users who want to hand-maintain a local MEMORY.md.
 */
const OVERRIDE_ENV = "ENGRAM_ANTHROPIC_MEMORY_PATH";

/**
 * Max MEMORY.md file size we will read (bytes). Auto-Memory indexes are
 * bullet lists; anything over 1 MB is pathological.
 */
const MAX_INDEX_BYTES = 1_048_576;

export const anthropicMemoryProvider: ContextProvider = {
  name: "anthropic:memory",
  label: "ANTHROPIC MEMORY",
  tier: 1,
  tokenBudget: 120,
  timeoutMs: 200,

  async isAvailable(): Promise<boolean> {
    try {
      const override = process.env[OVERRIDE_ENV];
      if (override) return existsSync(override);
      // Defer per-project existence to resolve(); returning true here
      // lets the resolver try us and short-circuit cleanly if missing.
      return true;
    } catch {
      return false;
    }
  },

  async resolve(
    filePath: string,
    context: NodeContext
  ): Promise<ProviderResult | null> {
    try {
      const path =
        process.env[OVERRIDE_ENV] || getMemoryIndexPath(context.projectRoot);
      if (!existsSync(path)) return null;

      const size = statSync(path).size;
      if (size === 0) return null;
      if (size > MAX_INDEX_BYTES) return null;

      const content = readFileSync(path, "utf-8");
      const entries = parseMemoryIndex(content);
      if (entries.length === 0) return null;

      const scored = entries
        .map((e) => ({
          entry: e,
          score: scoreEntry(e, { filePath, imports: context.imports }),
        }))
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score);

      if (scored.length === 0) return null;

      const top = scored.slice(0, 3);
      const lines = top.map((s) => {
        const desc = s.entry.description ? ` — ${s.entry.description}` : "";
        return `  • ${s.entry.title}${desc}`;
      });

      return {
        provider: "anthropic:memory",
        content: lines.join("\n"),
        confidence: 0.85,
        cached: false,
      };
    } catch {
      return null;
    }
  },
};
