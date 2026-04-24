/**
 * Generic MCP-client subsystem — wraps `@modelcontextprotocol/sdk` so
 * any MCP server becomes an engramx Context Spine provider via
 * `~/.engram/mcp-providers.json` declaration.
 *
 * Design contract (MUST preserve in all edits):
 *   1. Lazy connect — no process spawned / HTTP call made until first resolve
 *   2. Connection reused for the session lifetime
 *   3. Tool calls are parallel + bounded by provider.timeoutMs
 *   4. Any error path returns null — we never throw into the resolver
 *   5. SIGTERM / process.exit triggers clean disconnect
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  ContextProvider,
  NodeContext,
  ProviderResult,
} from "./types.js";
import {
  applyArgTemplate,
  type McpProviderConfig,
  type McpToolCall,
} from "./mcp-config.js";

/** Rough token estimate — shared with resolver.ts. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Thin wrapper around the MCP SDK's `Client`. Holds the single
 * connection for one configured provider across the engramx session.
 */
class McpClientWrapper {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private connectingPromise: Promise<void> | null = null;
  private shutdownRegistered = false;
  private lastErrorAt = 0;
  private readonly errorBackoffMs = 30_000;

  constructor(private readonly config: McpProviderConfig) {}

  /**
   * Connect once (idempotent). Concurrent callers share one promise so
   * we never spawn the server twice. On failure we set a backoff window
   * so the next Read doesn't re-try spawn immediately.
   */
  async connect(): Promise<void> {
    if (this.client) return;
    if (this.connectingPromise) return this.connectingPromise;
    if (Date.now() - this.lastErrorAt < this.errorBackoffMs) {
      throw new Error(
        `[mcp] ${this.config.name}: in error backoff (last failure ${Math.round(
          (Date.now() - this.lastErrorAt) / 1000
        )}s ago)`
      );
    }

    this.connectingPromise = this.doConnect()
      .catch((err) => {
        this.lastErrorAt = Date.now();
        // Clear partial state so the next connect attempts fresh
        this.client = null;
        this.transport = null;
        throw err;
      })
      .finally(() => {
        this.connectingPromise = null;
      });

    return this.connectingPromise;
  }

  private async doConnect(): Promise<void> {
    if (this.config.transport !== "stdio") {
      // HTTP transport is deferred to a follow-up commit — declare the
      // config but don't connect until Streamable HTTP + Host/Origin
      // hardening from item #5 land. Fail-soft: the provider reports
      // unavailable rather than blocking a Read.
      throw new Error(
        `[mcp] ${this.config.name}: http transport not yet implemented`
      );
    }

    const transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args ? [...this.config.args] : undefined,
      env: this.config.env ? { ...this.config.env } : undefined,
      cwd: this.config.cwd,
      // Pipe stderr so a chatty server doesn't spam the parent's stderr
      // during normal operation. Re-enable "inherit" for debugging.
      stderr: "pipe",
    });

    const client = new Client(
      { name: "engramx", version: "3.0.0" },
      { capabilities: {} }
    );

    await client.connect(transport);

    this.transport = transport;
    this.client = client;

    if (!this.shutdownRegistered) {
      this.registerShutdown();
      this.shutdownRegistered = true;
    }
  }

  /**
   * Call a single tool with a timeout. Returns null on error (never
   * throws). Caller is responsible for aggregating multiple tool results.
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs: number
  ): Promise<{ content: string } | null> {
    try {
      await this.connect();
    } catch {
      return null;
    }
    if (!this.client) return null;

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);

    try {
      const result = await this.client.callTool(
        { name: toolName, arguments: args },
        undefined,
        { signal: abort.signal, timeout: timeoutMs }
      );
      clearTimeout(timer);

      // Response shape: { content: [{type: "text", text: "..."}] | [...] }
      // — coalesce all text blocks into a single string. Non-text blocks
      // are described with a marker so the user sees something wasn't
      // plain text rather than silently dropping it.
      const blocks = Array.isArray(result?.content) ? result.content : [];
      const text = blocks
        .map((b: unknown) => {
          const block = b as { type?: string; text?: string };
          if (block.type === "text" && typeof block.text === "string") {
            return block.text;
          }
          return `[${block.type ?? "unknown"} block]`;
        })
        .join("\n")
        .trim();

      if (text.length === 0) return null;
      return { content: text };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Close the connection. Safe to call on an unconnected client. */
  async disconnect(): Promise<void> {
    const client = this.client;
    const transport = this.transport;
    this.client = null;
    this.transport = null;
    try {
      await client?.close();
    } catch {
      // Ignore — connection may already be dead
    }
    try {
      await transport?.close();
    } catch {
      // Ignore
    }
  }

  private registerShutdown(): void {
    const shutdown = () => {
      void this.disconnect();
    };
    // Parent process lifecycle — ignore if already registered
    // (multiple clients share the listener list, which is fine).
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
    process.once("beforeExit", shutdown);
  }
}

/**
 * Factory: turn an `McpProviderConfig` into a `ContextProvider` that
 * the engramx resolver can merge into its provider list unchanged.
 */
export function createMcpProvider(config: McpProviderConfig): ContextProvider {
  const wrapper = new McpClientWrapper(config);
  const tokenBudget = config.tokenBudget ?? 200;
  const timeoutMs = config.timeoutMs ?? 2_000;
  const enabled = config.enabled ?? true;

  return {
    name: config.name,
    label: config.label,
    // Tier 2 — external process/HTTP with cache support. Matches
    // context7/obsidian tier semantics in the existing resolver.
    tier: 2,
    tokenBudget,
    timeoutMs,

    async isAvailable(): Promise<boolean> {
      if (!enabled) return false;
      if (config.tools.length === 0) return false;
      // We do NOT connect here. Connection is lazy inside callTool.
      // Availability check is cheap so it runs on every Read —
      // spawning a child process in availability would be catastrophic.
      return true;
    },

    async resolve(
      filePath: string,
      context: NodeContext
    ): Promise<ProviderResult | null> {
      try {
        const results = await Promise.allSettled(
          config.tools.map((tool) => callSingleTool(wrapper, tool, filePath, context, timeoutMs))
        );

        const sections: string[] = [];
        let highestConfidence = 0;
        for (const outcome of results) {
          if (outcome.status === "fulfilled" && outcome.value) {
            sections.push(outcome.value.content);
            highestConfidence = Math.max(
              highestConfidence,
              outcome.value.confidence
            );
          }
        }

        if (sections.length === 0) return null;

        // Trim to tokenBudget — providers MUST respect their own budget
        // (resolver enforces total budget on top of this).
        let combined = sections.join("\n\n");
        const budget = tokenBudget;
        if (estimateTokens(combined) > budget) {
          // Keep whole lines to avoid cutting mid-word/token.
          const lines = combined.split("\n");
          const kept: string[] = [];
          let used = 0;
          for (const line of lines) {
            const lineTokens = estimateTokens(line) + 1; // +1 for newline
            if (used + lineTokens > budget) break;
            kept.push(line);
            used += lineTokens;
          }
          combined = kept.join("\n") + "\n… [truncated to fit budget]";
        }

        return {
          provider: config.name,
          content: combined,
          confidence: highestConfidence,
          cached: false,
        };
      } catch {
        return null;
      }
    },
  };
}

async function callSingleTool(
  wrapper: McpClientWrapper,
  tool: McpToolCall,
  filePath: string,
  context: NodeContext,
  timeoutMs: number
): Promise<{ content: string; confidence: number } | null> {
  const args = applyArgTemplate(tool.args, {
    filePath,
    projectRoot: context.projectRoot,
    imports: context.imports,
  });
  const result = await wrapper.callTool(tool.name, args, timeoutMs);
  if (!result) return null;
  return {
    content: result.content,
    confidence: tool.confidence ?? 0.75,
  };
}

// ── Exports for testing ─────────────────────────────────────────────
// The class itself is intentionally NOT exported from the module's
// public API — the only entry point is createMcpProvider. The wrapper
// is exposed here solely so integration tests can reach in without
// duplicating setup code.
export const __internalsForTesting = {
  McpClientWrapper,
};
