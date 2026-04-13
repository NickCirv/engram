/**
 * engram:mistakes provider — surfaces known issues and past failures
 * from the mistake memory system.
 *
 * Tier 1: internal, always available, no cache needed (<10ms).
 */
import { getStore } from "../core.js";
import type { ContextProvider, NodeContext, ProviderResult } from "./types.js";

export const mistakesProvider: ContextProvider = {
  name: "engram:mistakes",
  label: "KNOWN ISSUES",
  tier: 1,
  tokenBudget: 50,
  timeoutMs: 200,

  async resolve(
    filePath: string,
    context: NodeContext
  ): Promise<ProviderResult | null> {
    try {
      const store = await getStore(context.projectRoot);
      try {
        const allMistakes = store
          .getNodesByFile(filePath)
          .filter((n) => n.kind === "mistake");

        if (allMistakes.length === 0) return null;

        const lines = allMistakes
          .slice(0, 5)
          .map((m) => `  ! ${m.label} (flagged ${formatAge(m.lastVerified)})`)
          .join("\n");

        return {
          provider: "engram:mistakes",
          content: lines,
          confidence: 0.95,
          cached: false,
        };
      } finally {
        store.close();
      }
    } catch {
      return null;
    }
  },

  async isAvailable(): Promise<boolean> {
    return true;
  },
};

function formatAge(timestampMs: number): string {
  if (timestampMs === 0) return "unknown";
  const days = Math.floor((Date.now() - timestampMs) / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
