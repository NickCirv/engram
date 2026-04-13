/**
 * engram:structure provider — serves the structural summary from the
 * local graph. This is the existing renderFileStructure behavior
 * wrapped in the ContextProvider interface.
 *
 * Tier 1: internal, always available, no cache needed (<50ms).
 */
import { renderFileStructure } from "../graph/query.js";
import { getStore } from "../core.js";
import type { ContextProvider, NodeContext, ProviderResult } from "./types.js";

export const structureProvider: ContextProvider = {
  name: "engram:structure",
  label: "STRUCTURE",
  tier: 1,
  tokenBudget: 250,
  timeoutMs: 500,

  async resolve(
    filePath: string,
    context: NodeContext
  ): Promise<ProviderResult | null> {
    try {
      const store = await getStore(context.projectRoot);
      try {
        const result = renderFileStructure(store, filePath);
        if (!result || result.nodeCount === 0) return null;

        return {
          provider: "engram:structure",
          content: result.text,
          confidence: result.avgConfidence,
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
    return true; // Always available — it's local SQLite
  },
};
