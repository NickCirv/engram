/**
 * Tests for the engram HTTP REST server.
 * Starts a real server on a random port in beforeAll, closes in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import { resolve as pathResolve } from "node:path";
import { mkdirSync } from "node:fs";
import { createHttpServer } from "../../src/server/http.js";

// Use a temp project dir so the test doesn't pollute the real graph
const TEST_PROJECT = pathResolve("/tmp/engram-http-test");

/** Pick a free port by binding to :0 then immediately closing. */
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

async function get(path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, { headers });
  const body = await res.json();
  return { status: res.status, body };
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const responseBody = await res.json();
  return { status: res.status, body: responseBody };
}

beforeAll(async () => {
  mkdirSync(TEST_PROJECT, { recursive: true });
  port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  // createHttpServer resolves once listening — no await needed on the outer
  // start since we handle the promise ourselves to avoid blocking the test.
  await createHttpServer(TEST_PROJECT, port);
});

afterAll(() => {
  // PID file cleanup — server will be torn down when the process exits.
  // No explicit server.close() since createHttpServer doesn't expose the handle
  // (the server lives for the test process lifetime, which vitest controls).
});

// ---------------------------------------------------------------------------
// /health
// ---------------------------------------------------------------------------

describe("GET /health", () => {
  it("returns 200 with ok:true and version", async () => {
    const { status, body } = await get("/health");
    expect(status).toBe(200);
    expect((body as { ok: boolean }).ok).toBe(true);
    expect(typeof (body as { version: string }).version).toBe("string");
    expect(typeof (body as { uptime: number }).uptime).toBe("number");
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
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe("Auth (ENGRAM_API_TOKEN)", () => {
  const TOKEN = "test-secret-token-xyz";

  beforeAll(() => {
    process.env.ENGRAM_API_TOKEN = TOKEN;
  });

  afterAll(() => {
    delete process.env.ENGRAM_API_TOKEN;
  });

  it("returns 401 when token is not provided", async () => {
    const { status } = await get("/health");
    expect(status).toBe(401);
  });

  it("returns 200 when correct Bearer token is provided", async () => {
    const { status } = await get("/health", { Authorization: `Bearer ${TOKEN}` });
    expect(status).toBe(200);
  });

  it("returns 401 when wrong token is provided", async () => {
    const { status } = await get("/health", { Authorization: "Bearer wrong-token" });
    expect(status).toBe(401);
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
