/**
 * engram HTTP REST server — Node built-in http only, zero new deps.
 * Binds to 127.0.0.1 only (local privacy invariant).
 * Default port: 7337.
 *
 * Auth: if ENGRAM_API_TOKEN env var is set, all requests require
 *   Authorization: Bearer <token>. If not set, no auth required.
 *
 * PID file: <projectRoot>/.engram/http-server.pid — written on start,
 *   removed on shutdown. Checked by component-status.ts for HUD display.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { writeFileSync, unlinkSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { query, stats, learn, getStore } from "../core.js";
import { readHookLog } from "../intelligence/hook-log.js";
import { summarizeHookLog } from "../intercept/stats.js";
import { getCumulativeStats } from "../intelligence/token-tracker.js";
import { getContextCache, ContextCache } from "../intelligence/cache.js";
import { getComponentStatus } from "../intercept/component-status.js";
import { buildDashboardHtml } from "./ui.js";

// Read version — try both paths (works from src/ in dev and dist/ when built).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const PKG_VERSION = (() => {
  for (const p of ["../package.json", "../../package.json"]) {
    try { return (require(p) as { version: string }).version; } catch { /* next */ }
  }
  return "0.0.0";
})();

const PROVIDERS = [
  "structure",
  "mistakes",
  "git",
  "mempalace",
  "context7",
  "obsidian",
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  });
  res.end(JSON.stringify(data));
}

function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
  const token = process.env.ENGRAM_API_TOKEN;
  if (!token) return true;
  const header = req.headers.authorization ?? "";
  if (header === `Bearer ${token}`) return true;
  json(res, 401, { error: "Unauthorized" });
  return false;
}

// ---------------------------------------------------------------------------
// Route handlers — each <50 lines
// ---------------------------------------------------------------------------

function handleHealth(
  _req: IncomingMessage,
  res: ServerResponse,
  startedAt: number
): void {
  json(res, 200, {
    ok: true,
    version: PKG_VERSION,
    uptime: Math.floor((Date.now() - startedAt) / 1000),
  });
}

async function handleQuery(
  req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string
): Promise<void> {
  const url = parseUrl(req);
  const q = url.searchParams.get("q");
  if (!q) {
    json(res, 400, { error: "Missing query parameter 'q'" });
    return;
  }
  const budget = parseInt(url.searchParams.get("budget") ?? "2000", 10);
  try {
    const result = await query(projectRoot, q, { tokenBudget: isNaN(budget) ? 2000 : budget });
    json(res, 200, {
      text: result.text,
      estimatedTokens: result.estimatedTokens,
      providers: [...PROVIDERS],
    });
  } catch (err) {
    json(res, 500, { error: "Query failed", detail: String(err) });
  }
}

async function handleStats(
  _req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string
): Promise<void> {
  try {
    const result = await stats(projectRoot);
    json(res, 200, result);
  } catch (err) {
    json(res, 500, { error: "Stats failed", detail: String(err) });
  }
}

function handleProviders(_req: IncomingMessage, res: ServerResponse): void {
  const list = PROVIDERS.map((name) => ({ name, available: true }));
  json(res, 200, list);
}

async function handleLearn(
  req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string
): Promise<void> {
  let body: string;
  try {
    body = await readBody(req);
  } catch {
    json(res, 400, { error: "Failed to read request body" });
    return;
  }

  let parsed: { content?: string; kind?: string; file?: string };
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    json(res, 400, { error: "Invalid JSON body" });
    return;
  }

  if (!parsed.content || typeof parsed.content !== "string") {
    json(res, 400, { error: "Missing 'content' in request body" });
    return;
  }

  try {
    await learn(projectRoot, parsed.content, parsed.file ?? "http-api");
    json(res, 201, { ok: true });
  } catch (err) {
    json(res, 500, { error: "Learn failed", detail: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Dashboard API handlers
// ---------------------------------------------------------------------------

async function handleHookLog(
  req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string
): Promise<void> {
  try {
    const url = parseUrl(req);
    const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
    const entries = readHookLog(projectRoot);
    const paginated = entries.slice(offset, offset + limit);
    json(res, 200, { entries: paginated, total: entries.length });
  } catch (err) {
    json(res, 500, { error: "Hook log read failed", detail: String(err) });
  }
}

function handleHookLogSummary(
  _req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string
): void {
  try {
    const entries = readHookLog(projectRoot);
    const summary = summarizeHookLog(entries);
    json(res, 200, summary);
  } catch (err) {
    json(res, 500, { error: "Summary failed", detail: String(err) });
  }
}

async function handleTokens(
  _req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string
): Promise<void> {
  try {
    const store = await getStore(projectRoot);
    try {
      const tokenStats = getCumulativeStats(store);
      json(res, 200, tokenStats);
    } finally {
      store.close();
    }
  } catch (err) {
    json(res, 500, { error: "Token stats failed", detail: String(err) });
  }
}

async function handleFilesHeatmap(
  req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string
): Promise<void> {
  try {
    const url = parseUrl(req);
    const limit = parseInt(url.searchParams.get("limit") ?? "20", 10);
    const entries = readHookLog(projectRoot);

    // Aggregate by file path
    const fileMap = new Map<string, { count: number; tokensSaved: number }>();
    for (const entry of entries) {
      if (!entry.path) continue;
      const existing = fileMap.get(entry.path) ?? { count: 0, tokensSaved: 0 };
      fileMap.set(entry.path, {
        count: existing.count + 1,
        tokensSaved: existing.tokensSaved + (entry.tokensSaved ?? 0),
      });
    }

    // Sort by count descending, take top N
    const sorted = [...fileMap.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, limit)
      .map(([path, data]) => ({ path, ...data }));

    json(res, 200, sorted);
  } catch (err) {
    json(res, 500, { error: "Heatmap failed", detail: String(err) });
  }
}

function handleProvidersHealth(
  _req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string
): void {
  try {
    const status = getComponentStatus(projectRoot);
    json(res, 200, status);
  } catch (err) {
    json(res, 500, { error: "Provider health failed", detail: String(err) });
  }
}

async function handleCacheStats(
  _req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string
): Promise<void> {
  try {
    const store = await getStore(projectRoot);
    try {
      ContextCache.ensureTables(store);
      const cache = getContextCache();
      const cacheStats = cache.getStats(store);
      json(res, 200, cacheStats);
    } finally {
      store.close();
    }
  } catch (err) {
    json(res, 500, { error: "Cache stats failed", detail: String(err) });
  }
}

async function handleGraphNodes(
  req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string
): Promise<void> {
  try {
    const url = parseUrl(req);
    const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
    const store = await getStore(projectRoot);
    try {
      const allNodes = store.getAllNodes();
      const paginated = allNodes.slice(offset, offset + limit);
      json(res, 200, { nodes: paginated, total: allNodes.length });
    } finally {
      store.close();
    }
  } catch (err) {
    json(res, 500, { error: "Graph nodes failed", detail: String(err) });
  }
}

async function handleGraphGodNodes(
  _req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string
): Promise<void> {
  try {
    const store = await getStore(projectRoot);
    try {
      const godNodes = store.getGodNodes(10);
      json(res, 200, godNodes);
    } finally {
      store.close();
    }
  } catch (err) {
    json(res, 500, { error: "God nodes failed", detail: String(err) });
  }
}

// ---------------------------------------------------------------------------
// SSE (Server-Sent Events) for real-time dashboard updates
// ---------------------------------------------------------------------------

const sseClients = new Set<ServerResponse>();
let hookLogWatcher: (() => void) | null = null;

function handleSSE(
  _req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string
): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  // Send initial keepalive
  res.write("data: {\"type\":\"connected\"}\n\n");
  sseClients.add(res);

  // Start watching hook log if not already
  if (!hookLogWatcher) {
    const logPath = join(projectRoot, ".engram", "hook-log.jsonl");
    if (existsSync(logPath)) {
      let lastSize = statSync(logPath).size;

      const checkFile = (): void => {
        try {
          const currentSize = statSync(logPath).size;
          if (currentSize > lastSize) {
            lastSize = currentSize;
            // Broadcast to all SSE clients
            const msg = JSON.stringify({ type: "hook-event", timestamp: Date.now() });
            for (const client of sseClients) {
              try {
                client.write(`data: ${msg}\n\n`);
              } catch {
                sseClients.delete(client);
              }
            }
          }
        } catch {
          // Log file gone or unreadable
        }
      };

      const interval = setInterval(checkFile, 1000);
      hookLogWatcher = () => clearInterval(interval);
    }
  }

  // Cleanup on disconnect
  res.on("close", () => {
    sseClients.delete(res);
    if (sseClients.size === 0 && hookLogWatcher) {
      hookLogWatcher();
      hookLogWatcher = null;
    }
  });
}

// ---------------------------------------------------------------------------
// PID file management
// ---------------------------------------------------------------------------

function writePid(projectRoot: string): void {
  const dir = join(projectRoot, ".engram");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "http-server.pid"), String(process.pid), "utf-8");
}

function removePid(projectRoot: string): void {
  try {
    unlinkSync(join(projectRoot, ".engram", "http-server.pid"));
  } catch {
    // Ignore — already gone or never written
  }
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export function createHttpServer(
  projectRoot: string,
  port: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      // CORS preflight
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
        });
        res.end();
        return;
      }

      if (!checkAuth(req, res)) return;

      const url = parseUrl(req);
      const path = url.pathname;

      try {
        if (req.method === "GET" && path === "/health") {
          handleHealth(req, res, startedAt);
        } else if (req.method === "GET" && path === "/query") {
          await handleQuery(req, res, projectRoot);
        } else if (req.method === "GET" && path === "/stats") {
          await handleStats(req, res, projectRoot);
        } else if (req.method === "GET" && path === "/providers") {
          handleProviders(req, res);
        } else if (req.method === "POST" && path === "/learn") {
          await handleLearn(req, res, projectRoot);
        // Dashboard API routes
        } else if (req.method === "GET" && path === "/api/hook-log") {
          await handleHookLog(req, res, projectRoot);
        } else if (req.method === "GET" && path === "/api/hook-log/summary") {
          handleHookLogSummary(req, res, projectRoot);
        } else if (req.method === "GET" && path === "/api/tokens") {
          await handleTokens(req, res, projectRoot);
        } else if (req.method === "GET" && path === "/api/files/heatmap") {
          await handleFilesHeatmap(req, res, projectRoot);
        } else if (req.method === "GET" && path === "/api/providers/health") {
          handleProvidersHealth(req, res, projectRoot);
        } else if (req.method === "GET" && path === "/api/cache/stats") {
          await handleCacheStats(req, res, projectRoot);
        } else if (req.method === "GET" && path === "/api/graph/nodes") {
          await handleGraphNodes(req, res, projectRoot);
        } else if (req.method === "GET" && path === "/api/graph/god-nodes") {
          await handleGraphGodNodes(req, res, projectRoot);
        } else if (req.method === "GET" && path === "/api/sse") {
          handleSSE(req, res, projectRoot);
        } else if (req.method === "GET" && (path === "/ui" || path === "/ui/")) {
          // Serve the dashboard SPA
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-cache",
          });
          res.end(buildDashboardHtml());
        } else {
          json(res, 404, { error: "Not found" });
        }
      } catch (err) {
        json(res, 500, { error: "Internal server error", detail: String(err) });
      }
    });

    server.on("error", (err) => {
      removePid(projectRoot);
      reject(err);
    });

    server.listen(port, "127.0.0.1", () => {
      writePid(projectRoot);

      const cleanup = (): void => {
        removePid(projectRoot);
        server.close(() => process.exit(0));
      };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);

      resolve();
      // Keep the process alive — the Promise resolves once the server is
      // listening, but the server continues running until a signal arrives.
    });
  });
}
