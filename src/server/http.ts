/**
 * engram HTTP REST server — Node built-in http only, zero new deps.
 * Binds to 127.0.0.1 only (local privacy invariant).
 * Default port: 7337.
 *
 * Auth: fail-closed. Every request except /health and /favicon.ico requires
 *   either `Authorization: Bearer <token>` or `Cookie: engram_token=<token>`.
 *   Token is resolved from ENGRAM_API_TOKEN env var, then the persisted
 *   ~/.engram/http-server.token file (auto-generated on first start, 0600).
 *
 * CORS: no wildcard. Default is no CORS headers (same-origin dashboard only).
 *   Additional origins opt in via ENGRAM_ALLOWED_ORIGINS=a.com,b.com.
 *
 * Host/Origin: DNS-rebinding defense — rejects Host headers that aren't
 *   127.0.0.1|localhost|::1 on the bound port, and Origin values not in the
 *   same-origin or env allowlist.
 *
 * Content-Type: mutations (POST/PUT/DELETE) must be application/json. This
 *   forces CORS preflight for cross-origin writes as a belt-and-braces check.
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
import {
  getOrCreateToken,
  isHostValid,
  isOriginAllowed,
  parseCookies,
  safeEqual,
  type TokenInfo,
} from "./auth.js";

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
// Server-scoped state — resolved once per createHttpServer() call.
// ---------------------------------------------------------------------------

let serverToken = "";
let serverPort = 0;

/**
 * Snapshotted auth token resolved once at server start. Never returns
 * empty — `createHttpServer` populates `serverToken` from
 * `getOrCreateToken()` before accepting connections. We deliberately do
 * NOT re-read `process.env.ENGRAM_API_TOKEN` at request time: a downstream
 * plugin or test helper that mutates the env var mid-session could silently
 * downgrade auth, and `getOrCreateToken`'s length gate wouldn't apply.
 * Tests that need a specific token set the env BEFORE calling
 * `createHttpServer`.
 */
function currentToken(): string {
  return serverToken;
}

/**
 * Build the auth cookie string. Tokens are URL-safe (hex or env-supplied
 * >=32-char), so no percent-encoding is needed — keeping the cookie value
 * raw means `parseCookies` round-trips exactly without asymmetric decode.
 */
function authCookie(token: string): string {
  return `engram_token=${token}; HttpOnly; SameSite=Strict; Path=/`;
}

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

/**
 * Build CORS headers for a response. By default emits nothing — same-origin
 * dashboard doesn't need them. Echoes Origin only when the request's Origin
 * header is in the allowlist (same-origin or ENGRAM_ALLOWED_ORIGINS).
 */
function corsHeaders(req: IncomingMessage): Record<string, string> {
  const origin = req.headers.origin;
  if (!origin || !isOriginAllowed(origin, serverPort)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  };
}

function json(
  res: ServerResponse,
  status: number,
  data: unknown,
  extraHeaders: Record<string, string> = {}
): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...extraHeaders,
  });
  res.end(JSON.stringify(data));
}

/**
 * Fail-closed auth. Accepts `Authorization: Bearer <token>` (CLI/curl) or
 * `Cookie: engram_token=<token>` (same-origin dashboard). Returns 401 on
 * miss with no CORS headers so cross-origin attackers learn nothing.
 */
function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
  const expected = currentToken();

  const auth = req.headers.authorization ?? "";
  if (auth.startsWith("Bearer ")) {
    const presented = auth.slice(7).trim();
    if (safeEqual(presented, expected)) return true;
  }

  const cookies = parseCookies(req.headers.cookie);
  if (cookies.engram_token && safeEqual(cookies.engram_token, expected)) {
    return true;
  }

  json(res, 401, { error: "Unauthorized" });
  return false;
}

/**
 * Enforce application/json on mutations. Forces CORS preflight for any
 * cross-origin writer and blocks the text/plain CSRF vector used by the
 * issue #7 PoC against /learn.
 */
function requireJsonContentType(req: IncomingMessage, res: ServerResponse): boolean {
  const ct = (req.headers["content-type"] ?? "").toLowerCase();
  if (ct.startsWith("application/json")) return true;
  json(res, 415, { error: "Content-Type must be application/json" });
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
    // Flat, dashboard-friendly shape. The HTTP server we're responding
    // from is definitionally running — short-circuit httpRunning to true
    // even if the PID file hasn't been written yet in this session.
    const httpComp = status.components.find((c) => c.name === "http");
    const lspComp = status.components.find((c) => c.name === "lsp");
    const astComp = status.components.find((c) => c.name === "ast");
    json(res, 200, {
      httpRunning: true, // we're literally responding — it's up
      lspAvailable: !!lspComp?.available,
      astAvailable: !!astComp?.available,
      ideCount: status.ideCount,
      // Also expose the raw report for advanced consumers
      components: status.components,
      generatedAt: status.generatedAt,
      // Expose the httpComp flag separately in case callers want to know
      // whether the PID file was found (vs inferred from this response)
      httpPidDetected: !!httpComp?.available,
    });
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
  req: IncomingMessage,
  res: ServerResponse,
  projectRoot: string
): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    ...corsHeaders(req),
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
): Promise<TokenInfo> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const tokenInfo = getOrCreateToken();
    serverToken = tokenInfo.token;
    serverPort = port;

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      // 1. Host header validation — reject DNS rebinding and Host spoofing.
      if (!isHostValid(req.headers.host, port)) {
        res.writeHead(400);
        res.end();
        return;
      }

      // 2. Origin validation — if the request has an Origin header it must
      //    be same-origin or in ENGRAM_ALLOWED_ORIGINS. Missing Origin is
      //    fine (non-browser clients like curl don't send it).
      const origin = req.headers.origin;
      if (origin && !isOriginAllowed(origin, port)) {
        res.writeHead(403);
        res.end();
        return;
      }

      // Set CORS response headers early for allowed origins; writeHead()
      // calls downstream merge these in automatically.
      if (origin && isOriginAllowed(origin, port)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Vary", "Origin");
      }

      // 3. CORS preflight — origin check above already rejected foreign
      //    origins, so any OPTIONS reaching here is same-origin or allowlisted.
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
        });
        res.end();
        return;
      }

      const url = parseUrl(req);
      const path = url.pathname;

      // 4. Unauthenticated public routes — /health for monitors, favicon
      //    for browsers that don't honor <link rel="icon">. Both return no
      //    sensitive data.
      if (req.method === "GET" && path === "/health") {
        handleHealth(req, res, startedAt);
        return;
      }
      if (req.method === "GET" && path === "/favicon.ico") {
        const svg =
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
          '<rect width="100" height="100" rx="20" fill="#0a0a0b"/>' +
          '<text x="50" y="62" font-size="56" text-anchor="middle" ' +
          'fill="#10b981" font-family="Menlo,monospace">&#9670;</text>' +
          '</svg>';
        res.writeHead(200, {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "public, max-age=86400",
        });
        res.end(svg);
        return;
      }

      // 4b. Dashboard bootstrap — browsers can't send Authorization headers
      //     on top-level navigation, so GET /ui?token=<t> exchanges the
      //     token for an HttpOnly cookie and redirects to clean /ui.
      //
      //     Defence-in-depth: gate on Sec-Fetch-Site. Legitimate top-level
      //     navigation from the CLI-launched browser sends `none` (address
      //     bar); same-origin reload/link sends `same-origin`. Any
      //     `cross-site` / `same-site` value means the request came from a
      //     different origin (img/iframe/link from evil.example) and must
      //     not be able to probe tokens. Browsers that don't send the header
      //     fall through to the token-equality check (no regression for
      //     older clients, tokens remain random 256-bit values).
      if (req.method === "GET" && (path === "/ui" || path === "/ui/")) {
        const queryToken = url.searchParams.get("token");
        if (queryToken) {
          const fetchSite = req.headers["sec-fetch-site"];
          const siteOk =
            fetchSite === undefined ||
            fetchSite === "none" ||
            fetchSite === "same-origin";
          if (siteOk && safeEqual(queryToken, currentToken())) {
            res.writeHead(302, {
              Location: "/ui",
              "Set-Cookie": authCookie(currentToken()),
              "Referrer-Policy": "no-referrer",
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
            });
            res.end();
            return;
          }
        }
      }

      // 5. Auth — every remaining route requires a valid token.
      if (!checkAuth(req, res)) return;

      // 6. Content-Type enforcement on mutations. Blocks the text/plain
      //    CSRF vector from issue #7 and forces CORS preflight for any
      //    cross-origin writer.
      if (req.method === "POST" || req.method === "PUT" || req.method === "DELETE") {
        if (!requireJsonContentType(req, res)) return;
      }

      try {
        if (req.method === "GET" && path === "/query") {
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
          // Serve the dashboard SPA + refresh the HttpOnly cookie so
          // same-origin fetches from the dashboard carry auth automatically.
          // See also the /ui?token= bootstrap branch above L589 — this path
          // assumes auth already succeeded (via Bearer header or existing
          // cookie); the bootstrap branch handles the first-visit case.
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-cache",
            "Set-Cookie": authCookie(currentToken()),
            "X-Content-Type-Options": "nosniff",
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

      resolve(tokenInfo);
      // Keep the process alive — the Promise resolves once the server is
      // listening, but the server continues running until a signal arrives.
    });
  });
}
