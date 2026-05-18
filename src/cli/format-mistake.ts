/**
 * Bi-temporal mistake renderer (v4.0).
 *
 * Two layouts:
 *
 *   1. Bi-temporal layout — used when all four v9 fields are present
 *      (thenBelieved, foundFalseAt, truthNow, appliesTo). Renders the
 *      structured "then you believed / found false / truth now / ref +
 *      applies-to" diff that the rave demo screenshots.
 *
 *   2. Legacy single-line layout — used when v9 fields are absent
 *      (v3.x mistakes captured before schema v9 existed). Preserves the
 *      pre-v4.0 format so existing users see no regression.
 *
 * Color is applied via chalk and respects NO_COLOR per chalk's own logic.
 * Output is plain ASCII tree characters (┌├└─) for portability across
 * terminals that don't ship full Unicode box-drawing.
 */
import chalk from "chalk";
import type { MistakeEntry } from "../core.js";

const TREE_TOP = "┌─";
const TREE_MID = "├─";
const TREE_BOT = "└─";
const TREE_INDENT = "  ";

/**
 * Format an absolute unix-ms timestamp as an ISO-style date (YYYY-MM-DD).
 * No timezone offsets — keep deterministic across machines for screenshots.
 */
function formatDate(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "unknown";
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Format a relative age in days for the legacy layout.
 */
function formatAge(ms: number): string {
  const days = Math.max(1, Math.round((Date.now() - ms) / 86400000));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/**
 * Does this mistake have enough v9 data to render the bi-temporal layout?
 * Requires at least `thenBelieved` AND (`foundFalseAt` OR `truthNow`) — a
 * pure thenBelieved with nothing else is not useful as a structured diff.
 */
export function hasBiTemporalFields(m: MistakeEntry): boolean {
  return (
    typeof m.thenBelieved === "string" &&
    m.thenBelieved.length > 0 &&
    (typeof m.foundFalseAt === "number" || typeof m.truthNow === "string")
  );
}

/**
 * Render a single mistake in the bi-temporal 4-field layout.
 *
 * Example output:
 *
 *   ⚠ Mistake #1 — 2026-04-18
 *     ┌─ then you believed: useReducer dispatch is safe in onChange handlers
 *     ├─ found false:       2026-04-19
 *     └─ truth now:         useReducer + async dispatch needs useCallback wrapping
 *                           ref: src/forms/ContactForm.tsx
 *                           applies to: useReducer + async + form-event handlers
 */
export function formatBiTemporal(m: MistakeEntry, index: number): string {
  const header = `${chalk.bold.yellow("⚠")} ${chalk.bold(`Mistake #${index}`)} ${chalk.dim("—")} ${chalk.cyan(formatDate(m.lastVerified))}`;

  const thenLine =
    `${TREE_INDENT}${chalk.dim(TREE_TOP)} ${chalk.bold("then you believed:")} ${m.thenBelieved ?? chalk.dim("(unknown)")}`;

  const foundFalseDate =
    typeof m.foundFalseAt === "number" ? formatDate(m.foundFalseAt) : chalk.dim("(not recorded)");
  const foundLine =
    `${TREE_INDENT}${chalk.dim(TREE_MID)} ${chalk.bold("found false:      ")} ${chalk.cyan(foundFalseDate)}`;

  const truthLine =
    `${TREE_INDENT}${chalk.dim(TREE_BOT)} ${chalk.bold("truth now:        ")} ${m.truthNow ?? chalk.dim("(not recorded)")}`;

  // Indented continuation lines for ref + applies-to. The visual indent
  // matches the depth of the tree characters above.
  const continuationIndent = `${TREE_INDENT}${" ".repeat(TREE_BOT.length + 1)}`;
  const refLine = m.sourceFile
    ? `${continuationIndent}${chalk.dim("ref:        ")}${chalk.underline.cyan(m.sourceFile)}`
    : "";
  const appliesLine = m.appliesTo
    ? `${continuationIndent}${chalk.dim("applies to: ")}${chalk.green(m.appliesTo)}`
    : "";

  return [header, thenLine, foundLine, truthLine, refLine, appliesLine]
    .filter((line) => line.length > 0)
    .join("\n");
}

/**
 * Render a single mistake in the legacy single-line layout.
 *
 * Example output:
 *
 *   [src/auth.ts, 27d ago] 'npm login' interactively...
 */
export function formatLegacy(m: MistakeEntry): string {
  return `  ${chalk.dim(`[${m.sourceFile}, ${formatAge(m.lastVerified)}]`)} ${m.label}`;
}

/**
 * Top-level renderer — picks bi-temporal or legacy based on field presence.
 * Index is 1-based for human readability.
 */
export function renderMistake(m: MistakeEntry, index: number): string {
  return hasBiTemporalFields(m) ? formatBiTemporal(m, index) : formatLegacy(m);
}

/**
 * Render a full list of mistakes with a header. Returns the complete string
 * including header + blank-line separators between bi-temporal entries.
 */
export function renderMistakeList(items: readonly MistakeEntry[]): string {
  if (items.length === 0) {
    return chalk.yellow("No mistakes recorded.");
  }

  const header = chalk.bold(`\n⚠️  ${items.length} mistake(s) recorded:\n`);

  const body = items
    .map((m, i) => renderMistake(m, i + 1))
    .join(hasBiTemporalFields(items[0]) ? "\n\n" : "\n");

  return `${header}\n${body}\n`;
}
