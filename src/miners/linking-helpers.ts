/**
 * Heuristic helpers for extracting linking candidates from free text.
 * Used by core.learn to create inferred edges between summary/conclusion
 * fragments and existing graph nodes (files, identifiers, commands).
 */
import { basename } from "node:path";

function splitCamelCaseToken(tok: string): string[] {
  // Split camelCase and PascalCase: fooBar -> [foo, Bar]
  const s = tok.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  // Replace non-word separators with spaces then split
  return s.split(/[^A-Za-z0-9]+/).filter(Boolean).map((t) => t.toLowerCase());
}

export function extractKeywords(text: string, minLength = 4, maxTokens = 60): string[] {
  if (!text) return [];
  const seen = new Set<string>();

  // 1) inline code/backtick spans are high-value — include them
  for (const m of text.matchAll(/`([^`]+)`/g)) {
    const t = String(m[1]).trim();
    for (const part of t.split(/[^A-Za-z0-9_]/).filter(Boolean)) {
      if (part.length >= 2) {
        for (const p of splitCamelCaseToken(part)) {
          if (p.length >= minLength) seen.add(p);
        }
      }
    }
  }

  // 2) identifiers / words from plain text
  for (const m of text.matchAll(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g)) {
    const tok = String(m[0]);
    for (const p of splitCamelCaseToken(tok)) {
      if (p.length >= minLength) seen.add(p);
    }
    if (seen.size >= maxTokens) break;
  }

  // 3) bigrams of nouns (naive): two adjacent words of alpha chars
  if (seen.size < maxTokens) {
    for (const m of text.matchAll(/\b([A-Za-z]{3,})\s+([A-Za-z]{3,})\b/g)) {
      const bigram = (m[1] + " " + m[2]).toLowerCase();
      if (bigram.length >= minLength && bigram.split(/\s+/).every((s) => s.length >= 3)) seen.add(bigram);
      if (seen.size >= maxTokens) break;
    }
  }

  return Array.from(seen).slice(0, maxTokens);
}

export function extractFilePaths(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  // Match explicit paths like src/foo/bar.ts or ./module/index.js or README.md
  const pathRe = /(?:`([^`]+)`)|((?:\.\/?|\/?)[\w\-\.\/]+\.[a-z0-9]{1,6})/gi;
  for (const m of text.matchAll(pathRe)) {
    const candidate = (m[1] || m[2] || "").trim();
    if (!candidate) continue;
    // Strip surrounding ./ prefixes
    let c = candidate.replace(/^\.\//, "");
    // Normalize windows drive like C:/foo -> foo (best-effort)
    c = c.replace(/^[A-Z]:\\/i, "");
    if (c.length > 0) out.push(c);
  }
  // Dedupe while preserving order
  return Array.from(new Set(out));
}

export function extractCommands(text: string): string[] {
  if (!text) return [];
  const cmds = new Set<string>();
  // Prefer backticked commands e.g. `git commit` or `npx tsx ...`
  for (const m of text.matchAll(/`([^`]{2,200})`/g)) {
    const t = String(m[1]).trim();
    if (t.length > 0) cmds.add(t);
  }

  // Look for common command names followed by args, up to punctuation
  const common = ["git", "npm", "npx", "yarn", "pnpm", "node", "engram", "pi", "make"];
  const re = new RegExp(`\\b(${common.join("|")})\\b[^\\n\\,;\.]{0,80}`, "gi");
  for (const m of text.matchAll(re)) {
    const t = String(m[0]).trim();
    if (t.length > 0) cmds.add(t);
  }

  return Array.from(cmds);
}

export function basenameFromPath(p: string): string | null {
  try {
    return basename(p);
  } catch {
    return null;
  }
}

export function extractLinkCandidates(text: string) {
  return {
    keywords: extractKeywords(text),
    filePaths: extractFilePaths(text),
    commands: extractCommands(text),
  };
}
