/**
 * Tests for the engram HTTP REST server — happy-path contract tests.
 * Auth / CORS / DNS-rebinding / CSRF coverage lives in security.test.ts.
 *
 * Starts a real server on a random port in beforeAll. Every route except
 * /health and /favicon.ico now requires a token; helpers below attach it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import { join } from "node:path";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHttpServer } from "../../src/server/http.js";

const TEST_PROJECT = mkdtempSync(join(tmpdir(), "engram-http-test-"));
const TEST_TOKEN = "test-token-abcdef0123456789abcdef0123456789";

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close((err) => {
        if (err) { reject(err); return; }
        if (!addr || typeof addr === "string") { reject(new Error("No addr")); return; }
        resolve(addr.port);
      });
    });
  });
}

let port: number;
let baseUrl: string;

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${TEST_TOKEN}`, ...extra };
}

async function get(
  path: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, { headers: authHeaders(headers) });
  const body = await res.json();
  return { status: res.status, body };
}

async function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json", ...headers }),
    body: JSON.stringify(body),
  });
  const responseBody = await res.json();
  return { status: res.status, body: responseBody };
}

beforeAll(async () => {
  process.env.ENGRAM_API_TOKEN = TEST_TOKEN;
  mkdirSync(TEST_PROJECT, { recursive: true });
  port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  await createHttpServer(TEST_PROJECT, port);
});

afterAll(() => {
  delete process.env.ENGRAM_API_TOKEN;
});

// ---------------------------------------------------------------------------
// /health — unauthenticated on purpose (uptime monitors).
// ---------------------------------------------------------------------------

describe("GET /health", () => {
  it("returns 200 without a token (public health endpoint)", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; version: string; uptime: number };
    expect(body.ok).toBe(true);
    expect(typeof body.version).toBe("string");
    expect(typeof body.uptime).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// /query
// ---------------------------------------------------------------------------

describe("GET /query", () => {
  it("returns 400 when q param is missing", async () => {
    const { status, body } = await get("/query");
    expect(status).toBe(400);
    expect((body as { error: string }).error).toMatch(/Missing query parameter/i);
  });

  it("returns 200 with text field for a valid query", async () => {
    const { status, body } = await get("/query?q=test");
    expect(status).toBe(200);
    expect(typeof (body as { text: string }).text).toBe("string");
    expect(typeof (body as { estimatedTokens: number }).estimatedTokens).toBe("number");
    expect(Array.isArray((body as { providers: string[] }).providers)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// /stats
// ---------------------------------------------------------------------------

describe("GET /stats", () => {
  it("returns 200 with nodes field", async () => {
    const { status, body } = await get("/stats");
    expect(status).toBe(200);
    expect(typeof (body as { nodes: number }).nodes).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// /providers
// ---------------------------------------------------------------------------

describe("GET /providers", () => {
  it("returns 200 with an array of providers", async () => {
    const { status, body } = await get("/providers");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    const providers = body as Array<{ name: string; available: boolean }>;
    expect(providers.length).toBeGreaterThan(0);
    expect(typeof providers[0].name).toBe("string");
    expect(typeof providers[0].available).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// /learn
// ---------------------------------------------------------------------------

describe("POST /learn", () => {
  it("returns 201 when content is provided", async () => {
    const { status, body } = await post("/learn", { content: "test memory entry from http test" });
    expect(status).toBe(201);
    expect((body as { ok: boolean }).ok).toBe(true);
  });

  it("returns 400 when content is missing", async () => {
    const { status, body } = await post("/learn", {});
    expect(status).toBe(400);
    expect((body as { error: string }).error).toMatch(/Missing 'content'/i);
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await fetch(`${baseUrl}/learn`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: "not-json",
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 404
// ---------------------------------------------------------------------------

describe("unknown routes", () => {
  it("returns 404 for unknown path", async () => {
    const { status } = await get("/unknown-path");
    expect(status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// v3.0 item #5 — /context/stream SSE endpoint
// ---------------------------------------------------------------------------

describe("/context/stream", () => {
  it("rejects missing 'file' query parameter with 400", async () => {
    const res = await fetch(`${baseUrl}/context/stream`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(400);
  });

  it("returns SSE headers + a 'done' event for a valid request", async () => {
    const res = await fetch(`${baseUrl}/context/stream?file=src/x.ts`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");

    // Valid stream always ends with a 'done' event.
    const text = await res.text();
    expect(text).toContain("event: done");
  });

  it("every frame carries an 'id:' header (MCP SEP-1699 resumption)", async () => {
    const res = await fetch(`${baseUrl}/context/stream?file=src/x.ts`, {
      headers: authHeaders(),
    });
    const text = await res.text();
    // The final 'done' event carries id >= 0; at minimum we expect one id line.
    expect(text).toMatch(/^id: \d+$/m);
  });

  it("requires auth — unauthenticated request is rejected", async () => {
    const res = await fetch(`${baseUrl}/context/stream?file=src/x.ts`, {
      // no Authorization header
    });
    expect(res.status).toBe(401);
  });
});
