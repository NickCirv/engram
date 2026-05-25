/**
 * Skills Miner — indexes Claude Code skills (`SKILL.md` files) as graph nodes.
 *
 * Skills are stored as `concept` nodes with `metadata.subkind === "skill"`
 * (following Hickey's review guidance: don't add a new NodeKind for what is
 * effectively a documented procedure). Trigger phrases extracted from each
 * skill's `description` field become separate `concept` nodes with
 * `metadata.subkind === "keyword"`, linked to their skill via the new
 * `triggered_by` EdgeRelation. Skill-to-skill cross-references from the
 * "## Related Skills" section become `similar_to` edges.
 *
 * Zero LLM cost. Hand-rolled YAML parser (no new dependency). Line-based
 * trigger regex that survives `Node.js`, `React.js`, and Unicode curly quotes.
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import type { GraphEdge, GraphNode } from "../graph/schema.js";
import { truncateGraphemeSafe } from "../graph/render-utils.js";

export interface SkillMineResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  skillCount: number;
  anomalies: string[];
}

// ─── ID generation ──────────────────────────────────────────────────────────
// Duplicated from session-miner (10 lines — not worth the coupling of exporting
// and importing across miners, per the plan's Carmack-lens guidance).
function makeId(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join("_")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase()
    .slice(0, 120);
}

// ─── YAML frontmatter parser (minimal) ──────────────────────────────────────
// Handles: `key: value`, `key: >\n  multiline`, `key: |\n  multiline`,
// one level of nesting (e.g. `metadata:\n  version: X`), and quoted values.
// Returns an empty data object if frontmatter is missing or malformed —
// callers treat that as the "anomaly" case.
interface ParsedFrontmatter {
  data: Record<string, unknown>;
  body: string;
  parseOk: boolean;
}

function parseFrontmatter(content: string): ParsedFrontmatter {
  if (!content.startsWith("---")) {
    return { data: {}, body: content, parseOk: false };
  }
  // Find the closing `---` on its own line
  const closeMatch = content.slice(3).match(/\n---\s*(\n|$)/);
  if (!closeMatch || closeMatch.index === undefined) {
    return { data: {}, body: content, parseOk: false };
  }
  const yamlBlock = content.slice(3, 3 + closeMatch.index).trim();
  const bodyStart = 3 + closeMatch.index + closeMatch[0].length;
  const body = content.slice(bodyStart);

  try {
    const data = parseYaml(yamlBlock);
    return { data, body, parseOk: true };
  } catch {
    return { data: {}, body, parseOk: false };
  }
}

function parseYaml(block: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  // Strip carriage returns so CRLF files (common on Windows when Git
  // autocrlf=true) are parsed identically to LF files. Without this,
  // `rest === ">"` checks fail because `rest` is `">\r"`, multiline
  // blocks are misread as nested objects, and `data.description = ">"`.
  const lines = block.replace(/\r/g, "").split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    // Skip blank lines and comments at top level
    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }

    // Top-level key (no leading whitespace)
    const topMatch = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!topMatch) {
      // Malformed line — throw to let the caller fall back to anomaly
      throw new Error(`YAML parse: unexpected line ${i}: ${line}`);
    }

    const [, key, rest] = topMatch;

    if (rest === ">" || rest === "|") {
      // Multiline scalar — collect indented continuation lines
      const style = rest;
      const collected: string[] = [];
      i++;
      while (i < lines.length) {
        const next = lines[i];
        if (next === "" || /^\s/.test(next)) {
          collected.push(next.replace(/^ {2}/, "").replace(/^\t/, ""));
          i++;
        } else {
          break;
        }
      }
      data[key] =
        style === ">"
          ? collected.filter((l) => l.trim()).join(" ").trim()
          : collected.join("\n").trim();
    } else if (rest === "") {
      // Nested object — collect indented child key/values (one level only)
      const nested: Record<string, string> = {};
      i++;
      while (i < lines.length && /^\s+\S/.test(lines[i])) {
        const childMatch = lines[i].match(
          /^\s+([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/
        );
        if (childMatch) {
          nested[childMatch[1]] = stripQuotes(childMatch[2]);
        }
        i++;
      }
      data[key] = nested;
    } else {
      data[key] = stripQuotes(rest);
      i++;
    }
  }

  return data;
}

function stripQuotes(s: string): string {
  const trimmed = s.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if (first === '"' && last === '"') {
    // Double-quoted YAML supports backslash escapes including \uXXXX for
    // Unicode codepoints (e.g. \u201C for a curly left double quote)
    return trimmed
      .slice(1, -1)
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      )
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\");
  }
  if (first === "'" && last === "'") {
    // Single-quoted YAML escapes only '' → '
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

// ─── Trigger extraction (line-safe, Unicode-aware) ──────────────────────────
// Handles ASCII and Unicode curly quotes. Avoids the Knuth bug where a period
// inside an identifier (Node.js, React.js, e.g.) would falsely terminate.

// Any quoted phrase (ASCII or Unicode curly quotes) of 4-100 characters is
// a candidate trigger. High recall, low precision by design — SKILL.md
// descriptions rarely have quoted phrases that ARE NOT triggers.
const QUOTED_PHRASE_RE =
  /[\u0022\u0027\u201C\u201D\u2018\u2019]([^\u0022\u0027\u201C\u201D\u2018\u2019\n]{4,100}?)[\u0022\u0027\u201C\u201D\u2018\u2019]/g;
// "Use when X" — capture until sentence boundary (period + space + Capital),
// newline, or end of string. Period inside identifiers like Node.js does not
// terminate because the lookahead requires `\.\s+[A-Z]`.
const USE_WHEN_RE = /\bUse when\s+(.+?)(?=\.\s+[A-Z]|[\n\r]|$)/g;

function extractTriggers(text: string): string[] {
  const triggers = new Set<string>();

  for (const m of text.matchAll(QUOTED_PHRASE_RE)) {
    const t = m[1]?.trim();
    if (t && t.length >= 4) triggers.add(t);
  }
  for (const m of text.matchAll(USE_WHEN_RE)) {
    const t = m[1]?.trim().replace(/[.,;]+$/, "");
    if (t && t.length > 0 && t.length < 120) triggers.add(t);
  }

  return [...triggers];
}

// ─── Related Skills extraction ──────────────────────────────────────────────
function extractRelatedSkills(body: string): string[] {
  // Match a `## Related Skills` section up to the next header or end of file
  const sectionMatch = body.match(
    /##\s*Related Skills\s*\r?\n([\s\S]*?)(?=\r?\n##|\r?\n#[^#]|$)/i
  );
  if (!sectionMatch) return [];
  const section = sectionMatch[1];
  const names: string[] = [];
  for (const line of section.split(/\r?\n/)) {
    // Match bullet items with optional backticks around the skill name
    const m = line.match(/^[\s]*[-*+]\s+`?([a-z][a-z0-9-]*)`?/i);
    if (m) names.push(m[1].toLowerCase());
  }
  return [...new Set(names)];
}

// ─── Skill discovery ────────────────────────────────────────────────────────
function discoverSkillFiles(skillsDir: string): string[] {
  if (!existsSync(skillsDir)) return [];

  // Pin string-encoded dirents — node 25's stricter types default to
  // NonSharedBuffer when encoding is omitted, which breaks downstream
  // `.localeCompare`, `.startsWith`, and path join calls.
  let entries;
  try {
    const entries = readdirSync(dir, { withFileTypes: true, encoding: "utf-8" });
  } catch {
    return [];
  }

  // Sort for deterministic output across platforms and case-insensitive FSes
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  const results: string[] = [];

  for (const entry of sorted) {
    if (entry.name.startsWith(".")) continue;

    // Must be a directory (or a symlink resolving to one)
    let isDir = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      try {
        const resolved = realpathSync(join(skillsDir, entry.name));
        isDir = statSync(resolved).isDirectory();
      } catch {
        continue; // broken symlink — skip silently
      }
    }
    if (!isDir) continue;

    const skillMdPath = join(skillsDir, entry.name, "SKILL.md");
    if (existsSync(skillMdPath)) {
      results.push(skillMdPath);
    }
  }

  return results;
}

// ─── Main miner entry point ─────────────────────────────────────────────────
export function mineSkills(skillsDir: string): SkillMineResult {
  const result: SkillMineResult = {
    nodes: [],
    edges: [],
    skillCount: 0,
    anomalies: [],
  };

  const skillFiles = discoverSkillFiles(skillsDir);
  if (skillFiles.length === 0) return result;

  const now = Date.now();
  const keywordIds = new Set<string>();
  const skillIdByDirName = new Map<string, string>();
  const pendingRelated: Array<{ fromId: string; toName: string }> = [];

  for (const skillPath of skillFiles) {
    let content: string;
    try {
      content = readFileSync(skillPath, "utf-8");
    } catch {
      continue; // unreadable — skip silently
    }

    const skillDirName = basename(dirname(skillPath));
    const { data, body, parseOk } = parseFrontmatter(content);
    const hasFrontmatter = parseOk && Object.keys(data).length > 0;

    let name: string;
    let description: string;
    let version: string | undefined;

    if (hasFrontmatter) {
      name = String(data.name ?? skillDirName);
      description = String(data.description ?? "");
      const meta = data.metadata;
      if (meta && typeof meta === "object" && "version" in meta) {
        version = String((meta as Record<string, unknown>).version);
      }
    } else {
      // Anomaly: no frontmatter. Fall back to first heading + first paragraph.
      result.anomalies.push(skillPath);
      const headingMatch = content.match(/^#\s+(.+)$/m);
      name = headingMatch?.[1]?.trim() ?? skillDirName;
      const paragraphs = content
        .split(/\r?\n\s*\r?\n/)
        .map((p) => p.trim())
        .filter((p) => p && !p.startsWith("#"));
      description = paragraphs[0] ?? "";
    }

    const skillId = makeId("skill", skillDirName);
    skillIdByDirName.set(skillDirName.toLowerCase(), skillId);

    const sourceFileRel = `${skillDirName}/SKILL.md`;
    const sizeLines = content.split("\n").length;

    result.nodes.push({
      id: skillId,
      label: name,
      kind: "concept",
      sourceFile: sourceFileRel,
      sourceLocation: skillPath,
      confidence: "EXTRACTED",
      confidenceScore: 1.0,
      lastVerified: now,
      queryCount: 0,
      metadata: {
        miner: "skills",
        subkind: "skill",
        description: truncateGraphemeSafe(description, 500),
        sizeLines,
        hasFrontmatter,
        version,
        skillDir: skillDirName,
      },
    });
    result.skillCount++;

    // Extract trigger phrases from the description AND body — many skills
    // describe their triggers in the body prose, not just the frontmatter.
    const triggers = extractTriggers(description + "\n\n" + body);
    for (const trigger of triggers) {
      const normalized = trigger.toLowerCase().trim();
      if (normalized.length === 0 || normalized.length > 120) continue;

      const keywordId = makeId("keyword", normalized);
      if (!keywordIds.has(keywordId)) {
        result.nodes.push({
          id: keywordId,
          label: trigger,
          kind: "concept",
          sourceFile: sourceFileRel,
          sourceLocation: null,
          confidence: "EXTRACTED",
          confidenceScore: 1.0,
          lastVerified: now,
          queryCount: 0,
          metadata: { miner: "skills", subkind: "keyword" },
        });
        keywordIds.add(keywordId);
      }

      // Edge: keyword --triggered_by--> skill
      result.edges.push({
        source: keywordId,
        target: skillId,
        relation: "triggered_by",
        confidence: "EXTRACTED",
        confidenceScore: 1.0,
        sourceFile: sourceFileRel,
        sourceLocation: skillPath,
        lastVerified: now,
        metadata: { miner: "skills" },
      });
    }

    // Collect Related Skills references for post-pass resolution
    if (hasFrontmatter || body.length > 0) {
      const relatedNames = extractRelatedSkills(body);
      for (const relatedName of relatedNames) {
        pendingRelated.push({ fromId: skillId, toName: relatedName });
      }
    }
  }

  // Resolve similar_to edges now that all skill IDs are known
  for (const { fromId, toName } of pendingRelated) {
    const toId = skillIdByDirName.get(toName.toLowerCase());
    if (toId && toId !== fromId) {
      result.edges.push({
        source: fromId,
        target: toId,
        relation: "similar_to",
        confidence: "INFERRED",
        confidenceScore: 0.8,
        sourceFile: "SKILL.md",
        sourceLocation: null,
        lastVerified: Date.now(),
        metadata: { miner: "skills", via: "related_skills_section" },
      });
    }
  }

  return result;
}
