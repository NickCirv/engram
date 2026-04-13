/**
 * MemPalace provider — resolves decisions, learnings, and project
 * context from MemPalace's ChromaDB semantic memory.
 *
 * Tier 2: external, cached in SQLite. Warm at SessionStart via bulk
 * search, per-Read via cache lookup (<5ms).
 *
 * Resolution: execFile("mcp-mempalace", ["mempalace-search", ...])
 * MemPalace is a local Python process — no network needed, but Python
 * startup is ~300-500ms. Hence the cache.
 */
import { execFile } from "node:child_process";
import { getStore } from "../core.js";
import { DEFAULT_CACHE_TTL_SEC } from "./types.js";
import type {
  ContextProvider,
  NodeContext,
  ProviderResult,
  WarmupResult,
} from "./types.js";

/** Max output tokens from a single MemPalace search. */
const MAX_SEARCH_RESULTS = 3;

export const mempalaceProvider: ContextProvider = {
  name: "mempalace",
  label: "DECISIONS",
  tier: 2,
  tokenBudget: 100,
  timeoutMs: 200,

  async resolve(
    filePath: string,
    context: NodeContext
  ): Promise<ProviderResult | null> {
    try {
      // Check cache first
      const store = await getStore(context.projectRoot);
      try {
        const cached = store.getCachedContextForProvider(
          "mempalace",
          filePath
        );
        if (cached) {
          return {
            provider: "mempalace",
            content: cached.content,
            confidence: 0.8,
            cached: true,
          };
        }
      } finally {
        store.close();
      }

      // Cache miss — live resolve with timeout
      const query = buildQuery(filePath, context);
      const raw = await searchMempalace(query);
      if (!raw) return null;

      const content = formatResults(raw);
      if (!content) return null;

      // Cache the result
      const store2 = await getStore(context.projectRoot);
      try {
        store2.setCachedContext(
          "mempalace",
          filePath,
          content,
          DEFAULT_CACHE_TTL_SEC,
          query
        );
        store2.save();
      } finally {
        store2.close();
      }

      return {
        provider: "mempalace",
        content,
        confidence: 0.8,
        cached: false,
      };
    } catch {
      return null;
    }
  },

  async warmup(projectRoot: string): Promise<WarmupResult> {
    const start = Date.now();
    const entries: Array<{ filePath: string; content: string }> = [];

    try {
      // Get the project name for a broad search
      const store = await getStore(projectRoot);
      let projectName: string;
      try {
        projectName =
          store.getStat("project_name") ??
          projectRoot.split("/").pop() ??
          "";
      } finally {
        store.close();
      }

      if (!projectName) {
        return { provider: "mempalace", entries, durationMs: Date.now() - start };
      }

      // Bulk search for project-level decisions
      const raw = await searchMempalace(
        `${projectName} decisions architecture patterns`
      );
      if (!raw) {
        return { provider: "mempalace", entries, durationMs: Date.now() - start };
      }

      // Parse results and map to files where possible
      const content = formatResults(raw);
      if (content) {
        // For bulk warmup, we cache under the project root as a fallback
        entries.push({ filePath: "__project__", content });
      }
    } catch {
      // Warmup failures are silent
    }

    return { provider: "mempalace", entries, durationMs: Date.now() - start };
  },

  async isAvailable(): Promise<boolean> {
    try {
      const result = await execFilePromise("mcp-mempalace", [
        "mempalace-status",
      ]);
      return result.includes("palace") || result.includes("drawers");
    } catch {
      return false;
    }
  },
};

function buildQuery(filePath: string, context: NodeContext): string {
  // Use file name + imports as search terms
  const fileName = filePath.split("/").pop()?.replace(/\.\w+$/, "") ?? "";
  const importTerms = context.imports.slice(0, 3).join(" ");
  return `${fileName} ${importTerms}`.trim();
}

function searchMempalace(query: string): Promise<string | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 3000);
    execFile(
      "mcp-mempalace",
      ["mempalace-search", "--query", query],
      { encoding: "utf-8", timeout: 3000, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        clearTimeout(timeout);
        if (err || !stdout.trim()) {
          resolve(null);
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}

function formatResults(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw);
    const results = Array.isArray(parsed)
      ? parsed
      : parsed?.results ?? parsed?.drawers ?? [];

    if (results.length === 0) return null;

    const lines = results
      .slice(0, MAX_SEARCH_RESULTS)
      .map((r: Record<string, unknown>) => {
        const content = (r.content ?? r.text ?? r.summary ?? "") as string;
        // Truncate to ~30 words
        const truncated = content.split(/\s+/).slice(0, 30).join(" ");
        return `  - ${truncated}`;
      })
      .filter((l: string) => l.length > 4);

    return lines.length > 0 ? lines.join("\n") : null;
  } catch {
    // Not JSON — treat as plain text
    const lines = raw
      .split("\n")
      .filter((l) => l.trim())
      .slice(0, MAX_SEARCH_RESULTS)
      .map((l) => `  - ${l.trim().slice(0, 120)}`);
    return lines.length > 0 ? lines.join("\n") : null;
  }
}

function execFilePromise(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { encoding: "utf-8", timeout: 3000 },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout.trim());
      }
    );
  });
}
