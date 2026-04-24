/**
 * Mistake-guard — v3.0 pre-mortem warnings.
 *
 * Opt-in via `ENGRAM_MISTAKE_GUARD`:
 *   - unset / `0`   → no-op (default — zero production overhead)
 *   - `1`           → permissive: tool proceeds, a warning is prepended
 *                     to any additionalContext the primary handler emits
 *   - `2`           → strict:     tool is denied with the warning as reason
 *
 * Only fires for PreToolUse events on Edit / Write / Bash. Read events
 * already surface mistakes via the engram:mistakes context provider —
 * duplicating the warning at tool-call time would be noise.
 *
 * Matching algorithm:
 *   - Edit / Write: mistake.sourceFile equals the tool's file_path
 *     (normalized via context.toRelativePath)
 *   - Bash: mistake.metadata.commandPattern is a substring of the command,
 *     or mistake.sourceFile is a substring of the command (catches
 *     'rm src/auth.ts' style recurrences for auth.ts mistakes)
 *
 * Bi-temporal filter (item #7): mistakes with validUntil in the past are
 * suppressed — they refer to code that has since been refactored away
 * and would be noise.
 *
 * Safety: every path is wrapped in try/catch and returns null on error.
 * A broken guard MUST NEVER break the primary PreToolUse handler.
 */
import { relative } from "node:path";
import { getStore } from "../../core.js";
import { findProjectRoot } from "../context.js";
import { buildDenyResponse } from "../formatter.js";
import type { HandlerResult } from "../safety.js";

/**
 * Guard modes. Read from the environment at call time (not module load)
 * so tests can set/unset between cases without re-importing.
 */
export type GuardMode = "off" | "permissive" | "strict";

export function currentGuardMode(): GuardMode {
  const raw = process.env.ENGRAM_MISTAKE_GUARD;
  if (raw === "1") return "permissive";
  if (raw === "2") return "strict";
  return "off";
}

/**
 * Normalize a tool payload into its target "resource" — the file path
 * for Edit/Write or the raw command for Bash. Unsupported kinds return null.
 */
function extractTargetResource(
  kind: "edit-write" | "bash",
  toolInput: Record<string, unknown> | undefined
): { kind: "file"; filePath: string } | { kind: "command"; command: string } | null {
  if (!toolInput) return null;
  if (kind === "edit-write") {
    const fp = toolInput.file_path;
    if (typeof fp !== "string" || fp.length === 0) return null;
    return { kind: "file", filePath: fp };
  }
  if (kind === "bash") {
    const cmd = toolInput.command;
    if (typeof cmd !== "string" || cmd.length === 0) return null;
    return { kind: "command", command: cmd };
  }
  return null;
}

export interface MistakeMatch {
  readonly label: string;
  readonly sourceFile: string;
  readonly ageMs: number;
}

/**
 * Look up mistakes that apply to this tool call. Runs the bi-temporal
 * filter from item #7 so stale mistakes never warn.
 */
export async function findMatchingMistakesAsync(
  target: ReturnType<typeof extractTargetResource>,
  projectRoot: string
): Promise<MistakeMatch[]> {
  if (!target) return [];
  const now = Date.now();

  try {
    const store = await getStore(projectRoot);
    try {
      const matches: MistakeMatch[] = [];

      if (target.kind === "file") {
        // Normalize the tool's file_path to relative POSIX for matching.
        // If it's already relative, relative() is a no-op. If absolute,
        // it becomes relative to projectRoot.
        let normalized = target.filePath;
        try {
          const rel = relative(projectRoot, target.filePath);
          if (rel && !rel.startsWith("..")) {
            normalized = rel.split(/[\\/]/).join("/");
          }
        } catch {
          // Use raw path — better to over-match than miss
        }

        // Indexed lookup: getNodesByFile uses idx_nodes_source_file.
        // Try BOTH the normalized relative path AND the raw path, because
        // the miner could have stored either shape depending on how the
        // miner was invoked. Dedupe by node id.
        const candidates = [
          ...store.getNodesByFile(normalized),
          ...(normalized === target.filePath
            ? []
            : store.getNodesByFile(target.filePath)),
        ];
        const seenIds = new Set<string>();
        for (const m of candidates) {
          if (seenIds.has(m.id)) continue;
          seenIds.add(m.id);
          if (m.kind !== "mistake") continue;
          if (m.validUntil !== undefined && m.validUntil <= now) continue;
          matches.push({
            label: m.label,
            sourceFile: m.sourceFile,
            ageMs: now - m.lastVerified,
          });
        }
      } else {
        // Bash — no file axis to index on, fall back to a full-table scan
        // filtered to mistake-kind nodes. Bounded by project size; this
        // only runs when ENGRAM_MISTAKE_GUARD is explicitly enabled.
        const allMistakes = store
          .getAllNodes()
          .filter((n) => n.kind === "mistake")
          .filter((n) => n.validUntil === undefined || n.validUntil > now);

        if (allMistakes.length === 0) return [];

        // Bash — substring match on commandPattern (metadata) or sourceFile.
        const command = target.command.toLowerCase();
        for (const m of allMistakes) {
          const pattern = m.metadata?.commandPattern;
          const patternStr = typeof pattern === "string" ? pattern.toLowerCase() : "";
          const fileStr = m.sourceFile.toLowerCase();

          if (patternStr && patternStr.length > 2 && command.includes(patternStr)) {
            matches.push({
              label: m.label,
              sourceFile: m.sourceFile,
              ageMs: now - m.lastVerified,
            });
          } else if (fileStr && fileStr.length > 3 && command.includes(fileStr)) {
            matches.push({
              label: m.label,
              sourceFile: m.sourceFile,
              ageMs: now - m.lastVerified,
            });
          }
        }
      }

      return matches;
    } finally {
      store.close();
    }
  } catch {
    return [];
  }
}

/** Format a human-readable age string for a mistake. */
function formatAge(ms: number): string {
  if (ms < 0) return "unknown";
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** Format a warning block from a set of matched mistakes. */
export function formatWarning(matches: readonly MistakeMatch[]): string {
  if (matches.length === 0) return "";
  const lines = matches
    .slice(0, 5)
    .map((m) => `  ⚠ ${m.label} (flagged ${formatAge(m.ageMs)}, file: ${m.sourceFile})`);
  const more = matches.length > 5 ? `\n  … and ${matches.length - 5} more` : "";
  return [
    "⛔ engramx pre-mortem — this target has recurred as a mistake before:",
    ...lines,
    more,
  ]
    .filter((s) => s.length > 0)
    .join("\n");
}

/**
 * Wrap a primary handler's result with mistake-guard output. Pure
 * function: takes the raw handler result + the payload + the project
 * root, and returns either the raw result (no matches / guard off),
 * an augmented allow-with-context result (permissive mode + matches),
 * or a deny response (strict mode + matches).
 */
export async function applyMistakeGuard(
  rawResult: HandlerResult,
  payload: { tool_name?: unknown; tool_input?: unknown; cwd?: unknown },
  kind: "edit-write" | "bash"
): Promise<HandlerResult> {
  const mode = currentGuardMode();
  if (mode === "off") return rawResult;

  try {
    const cwd = typeof payload.cwd === "string" ? payload.cwd : "";
    const projectRoot = findProjectRoot(cwd);
    if (!projectRoot) return rawResult;

    const toolInput =
      payload.tool_input && typeof payload.tool_input === "object"
        ? (payload.tool_input as Record<string, unknown>)
        : undefined;

    const target = extractTargetResource(kind, toolInput);
    const matches = await findMatchingMistakesAsync(target, projectRoot);
    if (matches.length === 0) return rawResult;

    const warning = formatWarning(matches);

    if (mode === "strict") {
      return buildDenyResponse(warning);
    }

    // Permissive — augment the existing allow response's additionalContext.
    if (rawResult && typeof rawResult === "object") {
      const res = rawResult as Record<string, unknown>;
      const hso =
        res.hookSpecificOutput && typeof res.hookSpecificOutput === "object"
          ? (res.hookSpecificOutput as Record<string, unknown>)
          : undefined;
      const existingContext =
        typeof hso?.additionalContext === "string" ? hso.additionalContext : "";
      const merged = existingContext
        ? `${warning}\n\n${existingContext}`
        : warning;
      return {
        ...res,
        hookSpecificOutput: {
          ...(hso ?? {}),
          hookEventName: "PreToolUse",
          permissionDecision:
            typeof hso?.permissionDecision === "string"
              ? hso.permissionDecision
              : "allow",
          additionalContext: merged,
        },
      };
    }

    // rawResult was PASSTHROUGH (null) — emit a fresh allow-with-warning.
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        additionalContext: warning,
      },
    };
  } catch {
    // Any error → return raw result unchanged. Guard must never break
    // the primary handler.
    return rawResult;
  }
}
