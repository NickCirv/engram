import { existsSync, readFileSync } from "node:fs";
import { basename, relative, extname } from "node:path";
import { createHash } from "node:crypto";
import { getStore, learn, projectStatKey } from "../core.js";
import { readConfig } from "../tuner/config.js";
import { isContentUnsafeForIntercept } from "./context.js";

// Conservative caps to avoid storing huge blobs
const MAX_CONTENT_CHARS = 16_000;
const MIN_CONTENT_CHARS = 20;

function truncateContent(s: string): string {
  if (!s) return "";
  return s.length > MAX_CONTENT_CHARS ? s.slice(0, MAX_CONTENT_CHARS) : s;
}

function sha1Hex(s: string): string {
  return createHash("sha1").update(s).digest("hex");
}

function isLikelyTextFile(filePath: string): boolean {
  const ext = extname(filePath || "").toLowerCase();
  return ext === ".md" || ext === ".markdown" || ext === ".txt" || ext === ".rst" || ext === ".mdown" || ext === ".adoc" || ext === ".html" || ext === ".htm";
}

/**
 * Perform auto-learn for a piece of textual content into the engram store.
 * Dedupe by hashing the content per-scope+relPath so identical content
 * isn't re-inserted repeatedly. Uses project's global DB via getStore.
 *
 * Non-throwing: any internal error is swallowed so callers can fire-and-forget.
 */
export async function performAutoLearnForContent(
  projectRoot: string,
  content: string,
  relPath?: string,
  sourceLabel?: string
): Promise<void> {
  try {
    if (!projectRoot || !content || typeof content !== "string") return;
    const cfg = readConfig(projectRoot);

    // Aggressive default: if config doesn't mention autoMemory fields,
    // treat as enabled across all scopes. For safety, tests can override
    // readConfig to set different defaults.
    const autoEnabled = (cfg as any).autoMemoryEnabled !== undefined ? (cfg as any).autoMemoryEnabled : true;
    if (!autoEnabled) return;

    const scopes: string[] = (cfg as any).autoMemoryScopes ?? ["project", "global", "entity"];

    // Trim + sanity
    const trimmed = truncateContent(content).trim();
    if (trimmed.length < MIN_CONTENT_CHARS) return;

    // If a relPath is given and the file looks unsafe (binary / secrets), skip
    if (relPath && isContentUnsafeForIntercept(relPath)) return;

    // Simple entity-detection: first Markdown/H1 heading or first line
    const firstLine = trimmed.split(/\r?\n/)[0] || "";
    const entityMatch = firstLine.match(/^#{1,3}\s+(.{2,200})/) ?? firstLine.match(/^(.{2,100})$/);
    const entityName = entityMatch ? (entityMatch[1] || entityMatch[0]).trim() : null;

    // For each configured scope, dedupe by stat key and call learn
    for (const scope of scopes) {
      // entity scope: require an entity name to avoid noise
      if (scope === "entity" && !entityName) continue;

      // Build a stat key to track last-ingested hash for this relPath+scope
      const keySuffix = `auto_mem_hash:${scope}:${encodeURIComponent(relPath ?? "session")}`;
      const statKey = projectStatKey(projectRoot, keySuffix);

      const hash = sha1Hex(trimmed + "|" + scope);

      // Check existing hash
      let store;
      try {
        store = await getStore(projectRoot);
        const existing = store.getStat(statKey);
        if (existing === hash) {
          // Nothing new to learn for this scope
          continue;
        }
      } finally {
        if (store) store.close();
      }

      // Build a sensible source label
      const src = sourceLabel ?? `auto:${relPath ?? "session"}`;

      // For entity scope, craft a focused payload that emphasizes the entity
      const payload = scope === "entity" && entityName
        ? `entity: ${entityName}\n\n${trimmed}`
        : trimmed;

      try {
        await learn(projectRoot, payload, src, scope);
      } catch {
        // swallow learn errors
      }

      // After successful learn attempt, record the new hash
      try {
        const s = await getStore(projectRoot);
        try {
          s.setStat(statKey, hash);
        } finally {
          s.close();
        }
      } catch {
        // swallow
      }
    }
  } catch {
    // swallow any unexpected error; this module must be silent
  }
}

/**
 * Convenience wrapper used at SessionStart: learns the session brief
 * across configured scopes. Fire-and-forget by callers.
 */
export async function onSessionStart(projectRoot: string, fullText: string): Promise<void> {
  try {
    await performAutoLearnForContent(projectRoot, fullText, "session-start", "session-start");
  } catch {
    // swallow
  }
}

/**
 * Convenience wrapper for PostToolUse Read/Edit/Write handling.
 * If the tool provided textual output, prefer that; otherwise attempt
 * to read the file from disk and ingest.
 */
export async function onPostToolFile(
  projectRoot: string,
  cwd: string,
  filePath: string | undefined,
  toolResponse: unknown
): Promise<void> {
  try {
    if (!filePath) return;
    // Prefer toolResponse string if available
    let maybeText: string | null = null;
    if (typeof toolResponse === "string") maybeText = toolResponse;
    else if (toolResponse && typeof toolResponse === "object") {
      const t = toolResponse as Record<string, unknown>;
      if (typeof t.output === "string") maybeText = t.output;
      else if (typeof t.stdout === "string") maybeText = t.stdout;
      else if (typeof t.content === "string") maybeText = t.content;
    }

    // If we don't have textual toolResponse, read file from disk
    if (!maybeText) {
      try {
        const resolved = filePath.startsWith("/") ? filePath : require("node:path").resolve(cwd, filePath);
        if (existsSync(resolved) && !isContentUnsafeForIntercept(resolved)) {
          maybeText = readFileSync(resolved, "utf8");
          // use project-relative path for relPath
          filePath = relative(projectRoot, resolved).replaceAll("\\", "/");
        }
      } catch {
        maybeText = null;
      }
    }

    if (maybeText && typeof maybeText === "string") {
      await performAutoLearnForContent(projectRoot, maybeText, filePath, `auto:posttool`);
    }
  } catch {
    // swallow
  }
}
