/**
 * LSP context provider — surfaces language-server availability signal.
 *
 * Tier 1 (internal): no cache needed, resolution is socket-existence check
 * (~1ms). Only produces content when an LSP server is actually reachable,
 * which is rare outside IDE environments.
 *
 * BEST-EFFORT: null return on no socket is the expected common case.
 * The provider never throws. A 100ms timeout prevents any stalls.
 */
import type { ContextProvider, NodeContext, ProviderResult } from "./types.js";
import { LspConnection } from "./lsp-connection.js";

/**
 * Module-level connection cache. `undefined` = not yet attempted.
 * `null` = tried and no socket found. `LspConnection` = live connection.
 *
 * We re-use one connection across all resolve() calls within a session.
 * If the socket drops, the connected getter returns false and we reset.
 */
let cachedConnection: LspConnection | null | undefined = undefined;

async function getConnection(): Promise<LspConnection | null> {
  // If we have a live connection, reuse it
  if (cachedConnection instanceof LspConnection) {
    if (cachedConnection.connected) return cachedConnection;
    // Socket dropped — reset and retry
    cachedConnection.close();
    cachedConnection = undefined;
  }

  // Already tried and found nothing
  if (cachedConnection === null) return null;

  // First attempt
  cachedConnection = await LspConnection.tryConnect();
  return cachedConnection;
}

export const lspProvider: ContextProvider = {
  name: "engram:lsp",
  label: "LSP CONTEXT",
  tier: 1,
  tokenBudget: 100,
  timeoutMs: 100,

  async resolve(
    filePath: string,
    _context: NodeContext
  ): Promise<ProviderResult | null> {
    try {
      const conn = await getConnection();
      if (!conn) return null;

      const hover = await conn.hover(filePath, 0, 0);
      if (!hover?.contents) return null;

      const content =
        typeof hover.contents === "string"
          ? hover.contents
          : JSON.stringify(hover.contents);

      // Truncate to token budget (~4 chars per token)
      const charBudget = this.tokenBudget * 4;
      const truncated =
        content.length > charBudget
          ? content.slice(0, charBudget) + "..."
          : content;

      return {
        provider: "engram:lsp",
        content: truncated,
        confidence: 0.95,
        cached: false,
      };
    } catch {
      return null;
    }
  },

  async isAvailable(): Promise<boolean> {
    try {
      const conn = await getConnection();
      return conn !== null;
    } catch {
      return false;
    }
  },
};

/** Reset the connection cache. Used in tests and when projects change. */
export function _resetLspCache(): void {
  cachedConnection?.close();
  cachedConnection = undefined;
}
