/**
 * Context7 provider — resolves library documentation for detected
 * imports via the Context7 MCP CLI wrapper.
 *
 * Tier 2: external, cached in SQLite. Warm at SessionStart by
 * bulk-fetching docs for all detected package imports. Per-Read
 * resolution via cache lookup (<5ms).
 *
 * Resolution: execFile("mcp-context7", ["query-docs", ...])
 */
import { execFile } from "node:child_process";
import { getStore } from "../core.js";
import { DEFAULT_CACHE_TTL_SEC } from "./types.js";
import type {
  ContextProvider,
  NodeContext,
  ProviderResult,
  WarmupResult,
  WarmupEntry,
} from "./types.js";

/** Cache library docs for 4 hours (they change less often). */
const LIBRARY_CACHE_TTL = 4 * 3600;

export const context7Provider: ContextProvider = {
  name: "context7",
  label: "LIBRARY",
  tier: 2,
  tokenBudget: 100,
  timeoutMs: 200,

  async resolve(
    filePath: string,
    context: NodeContext
  ): Promise<ProviderResult | null> {
    if (context.imports.length === 0) return null;

    try {
      // Check cache for each import, return first hit
      const store = await getStore(context.projectRoot);
      try {
        const cached = store.getCachedContextForProvider("context7", filePath);
        if (cached) {
          return {
            provider: "context7",
            content: cached.content,
            confidence: 0.85,
            cached: true,
          };
        }
      } finally {
        store.close();
      }

      // Cache miss — try live resolution for the first import
      const primaryImport = context.imports[0];
      const docs = await queryContext7(primaryImport);
      if (!docs) return null;

      const content = formatDocs(primaryImport, docs);
      if (!content) return null;

      // Cache
      const store2 = await getStore(context.projectRoot);
      try {
        store2.setCachedContext(
          "context7",
          filePath,
          content,
          LIBRARY_CACHE_TTL,
          primaryImport
        );
        store2.save();
      } finally {
        store2.close();
      }

      return {
        provider: "context7",
        content,
        confidence: 0.85,
        cached: false,
      };
    } catch {
      return null;
    }
  },

  async warmup(projectRoot: string): Promise<WarmupResult> {
    const start = Date.now();
    const entries: WarmupEntry[] = [];

    try {
      // Collect all unique imports across the project
      const store = await getStore(projectRoot);
      let importEdges: Array<{ source: string; target: string }>;
      try {
        const allEdges = store.getAllEdges();
        importEdges = allEdges
          .filter((e) => e.relation === "imports")
          .map((e) => ({ source: e.sourceFile, target: e.target }));
      } finally {
        store.close();
      }

      // Dedupe packages (target is the package name in import edges)
      const packages = [
        ...new Set(
          importEdges
            .map((e) => {
              // Extract package name from target ID
              // e.g., "src/auth.ts::jsonwebtoken" -> "jsonwebtoken"
              const parts = e.target.split("::");
              return parts[parts.length - 1];
            })
            .filter(isExternalPackage)
        ),
      ].slice(0, 10); // Cap at 10 packages to limit warmup time

      // Resolve docs for each package (sequential to avoid overwhelming Context7)
      for (const pkg of packages) {
        const docs = await queryContext7(pkg);
        if (docs) {
          const content = formatDocs(pkg, docs);
          if (content) {
            // Map this package back to files that import it
            const files = importEdges
              .filter((e) => e.target.includes(pkg))
              .map((e) => e.source);
            for (const file of [...new Set(files)]) {
              entries.push({ filePath: file, content });
            }
          }
        }
      }
    } catch {
      // Warmup failures are silent
    }

    return { provider: "context7", entries, durationMs: Date.now() - start };
  },

  async isAvailable(): Promise<boolean> {
    try {
      // Check if mcp-context7 CLI is available
      const result = await execFilePromise("mcp-context7", ["--list"]);
      return result.includes("resolve-library-id");
    } catch {
      return false;
    }
  },
};

/** Filter out relative imports and Node builtins. */
function isExternalPackage(name: string): boolean {
  if (!name) return false;
  if (name.startsWith(".") || name.startsWith("/")) return false;
  if (
    [
      "fs",
      "path",
      "os",
      "url",
      "http",
      "https",
      "crypto",
      "stream",
      "util",
      "events",
      "child_process",
      "node:fs",
      "node:path",
      "node:os",
      "node:url",
      "node:http",
      "node:https",
      "node:crypto",
      "node:stream",
      "node:util",
      "node:events",
      "node:child_process",
    ].includes(name)
  )
    return false;
  return true;
}

function queryContext7(packageName: string): Promise<string | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 5000);
    execFile(
      "mcp-context7",
      [
        "query-docs",
        "--context7CompatibleLibraryID",
        packageName,
        "--topic",
        "API reference quick start",
      ],
      { encoding: "utf-8", timeout: 5000, maxBuffer: 2 * 1024 * 1024 },
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

function formatDocs(pkg: string, raw: string): string | null {
  // Truncate to ~100 tokens worth (~400 chars)
  const truncated = raw.slice(0, 400);
  const lines = truncated
    .split("\n")
    .filter((l) => l.trim())
    .slice(0, 5)
    .map((l) => `  ${l.trim()}`);

  if (lines.length === 0) return null;
  return `  ${pkg}:\n${lines.join("\n")}`;
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
