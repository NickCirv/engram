/**
 * UserPromptSubmit hook handler — pre-queries engram based on the
 * keywords in the user's message, injecting relevant graph context
 * BEFORE the agent starts tool-calling.
 *
 * The goal: when the user asks "how does authentication work in this
 * codebase", we preemptively load the auth subgraph into the session
 * so the agent doesn't need to run Read/Grep to discover it.
 *
 * Gating rules (prevents wasted injections):
 *   1. Prompt must produce ≥2 significant terms (len≥3, non-stopword).
 *      Short/generic prompts ("yes", "continue", "thanks") get no
 *      injection.
 *   2. Graph query result must have ≥3 matched nodes. Single-node
 *      matches are usually noise.
 *   3. Confidence not applicable here — we're injecting structural
 *      context, not replacing a file read.
 *
 * PRIVACY CONTRACT: this handler has access to every user prompt
 * Claude Code sees. It MUST NEVER write prompt content to hook-log or
 * any other persistent storage. Only metadata about the injection
 * decision (yes/no) may be logged.
 */
import { query, computeKeywordIDF } from "../../core.js";
import { findProjectRoot, isValidCwd } from "../context.js";
import { isHookDisabled, PASSTHROUGH, type HandlerResult } from "../safety.js";
import { buildSessionContextResponse } from "../formatter.js";

export interface UserPromptHookPayload {
  readonly hook_event_name: "UserPromptSubmit" | string;
  readonly cwd: string;
  readonly prompt?: string;
}

/**
 * Minimum significant terms required before we even run a query.
 * Two keywords is the threshold where engram's scoring starts to
 * produce meaningfully relevant seeds.
 */
const MIN_SIGNIFICANT_TERMS = 2;

/**
 * Minimum graph nodes required to justify injecting context. Below
 * this, the pre-query result is too sparse to be worth the token cost.
 */
const MIN_MATCHED_NODES = 3;

/**
 * Per-injection token budget. Kept tight so a prompt handler injection
 * doesn't dwarf the user's actual message. Sessions with many prompts
 * would otherwise accumulate injection overhead.
 */
const PROMPT_INJECTION_TOKEN_BUDGET = 500;

/**
 * v0.3.1: minimum IDF for a keyword to be used as a query seed.
 *
 * IDF = log(total_nodes / document_frequency). A keyword appearing in
 * X% of nodes has IDF = log(1/X). For a 25% cutoff: log(1/0.25) ≈ 1.386.
 * For a 15% cutoff: log(1/0.15) ≈ 1.897.
 *
 * 1.386 means "keyword must appear in ≤25% of graph nodes to count".
 *
 * Why 25% and not 15%:
 *   - On large graphs (250+ nodes, like engram itself) a keyword
 *     appearing in 25% of nodes is still a common-term generator —
 *     "engram" appearing in ~100 of 250 nodes gives idf ≈ 0.92, far
 *     below 1.386, still filtered.
 *   - On small graphs (10-20 nodes, test fixtures, fresh projects)
 *     even a semantically meaningful keyword like "auth" might appear
 *     in 20% of nodes — idf ≈ 1.6, passes 1.386 but would have been
 *     wrongly filtered by 1.897.
 *
 * The 25% threshold is the compromise that kills false-positive
 * injections on mature projects without breaking fresh ones. v0.5
 * self-tuning will adjust this per-project from hook-log outcomes.
 *
 * Math from 1972, zero dependencies.
 */
const MIN_IDF_THRESHOLD = 1.386;

/**
 * v0.3.1: after TF-IDF filtering, take the top-N most discriminative
 * keywords. Prevents a long prompt from dragging the query into BFS
 * explosion via too many seed terms.
 */
const MAX_SEED_KEYWORDS = 5;

/**
 * English stopwords stripped before keyword extraction. Intentionally
 * linguistic-only — we keep words like "function", "class", "method",
 * "type" because those are high-signal for code queries.
 */
const STOPWORDS = new Set<string>([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "can", "shall", "to", "of", "for",
  "in", "on", "at", "by", "with", "from", "and", "or", "but", "not",
  "no", "this", "that", "these", "those", "i", "you", "he", "she", "it",
  "we", "they", "my", "your", "his", "her", "its", "our", "their", "me",
  "him", "us", "them", "as", "if", "when", "where", "why", "how",
  "what", "which", "who", "whom", "so", "than", "then", "just",
]);

/**
 * Extract significant keywords from a prompt. Rules:
 *   - Lowercase
 *   - Split on whitespace and non-word chars
 *   - Keep tokens ≥3 chars
 *   - Drop stopwords
 *   - Dedupe while preserving order
 *
 * Returns the list (possibly empty). Pure function — no graph access.
 */
export function extractKeywords(prompt: string): string[] {
  if (!prompt || typeof prompt !== "string") return [];

  const tokens = prompt
    .toLowerCase()
    // Split on anything that isn't a word character or underscore.
    // This preserves identifiers like `validate_token` or `authService`.
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length >= 3)
    .filter((t) => !STOPWORDS.has(t));

  // Dedupe preserving first-occurrence order.
  const seen = new Set<string>();
  const result: string[] = [];
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    result.push(t);
  }
  return result;
}

/**
 * Handle a UserPromptSubmit hook payload. Returns a SessionContext
 * response when the prompt has enough signal AND the graph has enough
 * matches. Otherwise PASSTHROUGH.
 */
export async function handleUserPromptSubmit(
  payload: UserPromptHookPayload
): Promise<HandlerResult> {
  if (payload.hook_event_name !== "UserPromptSubmit") return PASSTHROUGH;

  const prompt = payload.prompt;
  if (!prompt || typeof prompt !== "string") return PASSTHROUGH;

  // Length cap — truly massive prompts (pasted code blocks, etc.)
  // shouldn't get pre-query treatment; the agent will inspect them
  // directly.
  if (prompt.length > 8000) return PASSTHROUGH;

  const rawKeywords = extractKeywords(prompt);
  if (rawKeywords.length < MIN_SIGNIFICANT_TERMS) return PASSTHROUGH;

  const cwd = payload.cwd;
  if (!isValidCwd(cwd)) return PASSTHROUGH;

  const projectRoot = findProjectRoot(cwd);
  if (projectRoot === null) return PASSTHROUGH;

  if (isHookDisabled(projectRoot)) return PASSTHROUGH;

  // v0.3.1: TF-IDF common-term filter.
  //
  // The gate logic has two layers:
  //
  //   1. RAW gate (already passed) — rawKeywords must have
  //      >= MIN_SIGNIFICANT_TERMS tokens after stopword removal.
  //      Keeps out "yes" / "continue" / "thanks" prompts.
  //
  //   2. DISCRIMINATIVE gate (below) — AT LEAST ONE keyword must
  //      have IDF >= MIN_IDF_THRESHOLD. If no keyword is above the
  //      threshold, every term in the prompt is a "common graph term"
  //      with no discriminative value, and injecting would produce
  //      the false-positive noise we're trying to avoid.
  //
  // After the discriminative gate passes, we pass the top-N most-
  // discriminative keywords to the query. Single-keyword queries
  // are fine — engram's scoreNodes handles them correctly.
  //
  // Fail-safe: if IDF computation returns empty (DB missing, etc.),
  // fall back to the raw keywords. Better to ship occasional noise
  // than a silent block.
  let keywords: string[];
  try {
    const scored = await computeKeywordIDF(projectRoot, rawKeywords);
    if (scored.length === 0) {
      // IDF failed or graph empty — trust the raw extraction
      keywords = rawKeywords;
    } else {
      const discriminative = scored.filter((s) => s.idf >= MIN_IDF_THRESHOLD);
      if (discriminative.length === 0) {
        // Every keyword is a common graph term. Silent passthrough.
        return PASSTHROUGH;
      }
      // At least one discriminative keyword exists. Pass the top-N
      // by IDF (may include below-threshold terms for context).
      keywords = scored
        .filter((s) => s.idf > 0)
        .slice(0, MAX_SEED_KEYWORDS)
        .map((s) => s.keyword);
      if (keywords.length === 0) {
        keywords = rawKeywords;
      }
    }
  } catch {
    keywords = rawKeywords;
  }

  // Final sanity check — should never be empty but belt+suspenders
  if (keywords.length === 0) return PASSTHROUGH;

  // Run the query with a tight budget. Join keywords with spaces to
  // form a single query string — engram's scoreNodes function already
  // handles multi-term matching.
  let result;
  try {
    result = await query(projectRoot, keywords.join(" "), {
      tokenBudget: PROMPT_INJECTION_TOKEN_BUDGET,
      depth: 2, // Shallower than default (3) to keep injection focused.
    });
  } catch {
    return PASSTHROUGH;
  }

  if (result.nodesFound < MIN_MATCHED_NODES) return PASSTHROUGH;

  // Format the injection. Include a short header so Claude knows this
  // is engram-provided context and not part of the user's message.
  const header = `[engram] Pre-query context for this message (matched ${result.nodesFound} graph nodes):`;
  const text = `${header}\n\n${result.text}`;

  return buildSessionContextResponse("UserPromptSubmit", text);
}

