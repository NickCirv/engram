/**
 * Obsidian provider — surfaces project notes and architecture docs
 * from an Obsidian vault via the Local REST API plugin.
 *
 * Tier 2: external, cached in SQLite. Only available when Obsidian
 * is running with the Local REST API plugin enabled (port 27124).
 *
 * Resolution: HTTP GET to localhost:27124. Fastest external provider
 * (~30-50ms) because it's local HTTP, no process spawn.
 */
import { getStore } from "../core.js";
import { DEFAULT_CACHE_TTL_SEC } from "./types.js";
import type {
  ContextProvider,
  NodeContext,
  ProviderResult,
  WarmupResult,
} from "./types.js";

const OBSIDIAN_PORT = 27124;
const OBSIDIAN_BASE = `http://127.0.0.1:${OBSIDIAN_PORT}`;

export const obsidianProvider: ContextProvider = {
  name: "obsidian",
  label: "PROJECT NOTES",
  tier: 2,
  tokenBudget: 50,
  timeoutMs: 200,

  async resolve(
    filePath: string,
    context: NodeContext
  ): Promise<ProviderResult | null> {
    try {
      // Check cache first
      const store = await getStore(context.projectRoot);
      try {
        const cached = store.getCachedContextForProvider("obsidian", filePath);
        if (cached) {
          return {
            provider: "obsidian",
            content: cached.content,
            confidence: 0.7,
            cached: true,
          };
        }
      } finally {
        store.close();
      }

      // Cache miss — search Obsidian
      const projectName =
        context.projectRoot.split("/").pop() ?? "";
      const fileName = filePath.split("/").pop()?.replace(/\.\w+$/, "") ?? "";
      const query = `${projectName} ${fileName}`;

      const results = await searchObsidian(query);
      if (!results) return null;

      const content = formatResults(results);
      if (!content) return null;

      // Cache
      const store2 = await getStore(context.projectRoot);
      try {
        store2.setCachedContext(
          "obsidian",
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
        provider: "obsidian",
        content,
        confidence: 0.7,
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
      const projectName = projectRoot.split("/").pop() ?? "";
      if (!projectName) {
        return { provider: "obsidian", entries, durationMs: Date.now() - start };
      }

      const results = await searchObsidian(
        `${projectName} architecture design decisions`
      );
      if (results) {
        const content = formatResults(results);
        if (content) {
          entries.push({ filePath: "__project__", content });
        }
      }
    } catch {
      // Silent failure
    }

    return { provider: "obsidian", entries, durationMs: Date.now() - start };
  },

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetchWithTimeout(
        `${OBSIDIAN_BASE}/`,
        1000
      );
      return response.ok;
    } catch {
      return false;
    }
  },
};

async function searchObsidian(
  query: string
): Promise<Array<{ filename: string; score: number }> | null> {
  try {
    const response = await fetchWithTimeout(
      `${OBSIDIAN_BASE}/search/simple/?query=${encodeURIComponent(query)}`,
      2000
    );
    if (!response.ok) return null;
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return data.slice(0, 3) as Array<{ filename: string; score: number }>;
  } catch {
    return null;
  }
}

function formatResults(
  results: Array<{ filename: string; score?: number }>
): string | null {
  if (results.length === 0) return null;

  const lines = results
    .slice(0, 3)
    .map((r) => {
      const name = r.filename.replace(/\.md$/, "");
      return `  Related: ${name}`;
    });

  return lines.join("\n");
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
