/**
 * Security tests — exercises the exact attack paths from issue #7
 * (CORS wildcard + auth-off-by-default + text/plain CSRF on /learn) and
 * asserts that v2.0.2's fixes make them all fail.
 *
 * Also covers:
 *   - fail-closed auth (no token → 401)
 *   - constant-time token comparison (via correct token accept)
 *   - Cookie-based auth for the same-origin dashboard
 *   - Host header validation (DNS rebinding)
 *   - Origin header validation (CSRF from evil.example)
 *   - /ui sets an HttpOnly Set-Cookie carrying the token
 *   - CORS response headers never contain a wildcard
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import { join } from "node:path";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHttpServer } from "../../src/server/http.js";

const TEST_PROJECT = mkdtempSync(join(tmpdir(), "engram-sec-test-"));
const TEST_TOKEN = "sec-test-token-fedcba9876543210fedcba9876543210";

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
// Auth — fail-closed
// ---------------------------------------------------------------------------

describe("Auth (fail-closed)", () => {
  it("rejects /query without a token", async () => {
    const res = await fetch(`${baseUrl}/query?q=test`);
    expect(res.status).toBe(401);
  });

  it("rejects /stats without a token", async () => {
    const res = await fetch(`${baseUrl}/stats`);
    expect(res.status).toBe(401);
  });

  it("rejects /learn without a token", async () => {
    const res = await fetch(`${baseUrl}/learn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects with wrong Bearer token", async () => {
    const res = await fetch(`${baseUrl}/stats`, {
      headers: { Authorization: "Bearer wrong-token-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
    });
    expect(res.status).toBe(401);
  });

  it("accepts correct Bearer token", async () => {
    const res = await fetch(`${baseUrl}/stats`, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(res.status).toBe(200);
  });

  it("accepts correct token via Cookie (same-origin dashboard path)", async () => {
    const res = await fetch(`${baseUrl}/stats`, {
      headers: { Cookie: `engram_token=${TEST_TOKEN}` },
    });
    expect(res.status).toBe(200);
  });

  it("rejects wrong token via Cookie", async () => {
    const res = await fetch(`${baseUrl}/stats`, {
      headers: { Cookie: "engram_token=wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects empty Bearer (Authorization: Bearer )", async () => {
    const res = await fetch(`${baseUrl}/stats`, {
      headers: { Authorization: "Bearer " },
    });
    expect(res.status).toBe(401);
  });

  it("rejects empty-value Cookie (engram_token=)", async () => {
    const res = await fetch(`${baseUrl}/stats`, {
      headers: { Cookie: "engram_token=" },
    });
    expect(res.status).toBe(401);
  });

  it("ignores env-var downgrade after server start (token is snapshot)", async () => {
    // Simulate a buggy plugin or misconfig trying to set a short token
    // post-start. The server must keep honoring only the startup-snapshot
    // token; requests with the injected short value must fail.
    const attackerToken = "x";
    const prev = process.env.ENGRAM_API_TOKEN;
    process.env.ENGRAM_API_TOKEN = attackerToken;
    try {
      const res = await fetch(`${baseUrl}/stats`, {
        headers: { Authorization: `Bearer ${attackerToken}` },
      });
      expect(res.status).toBe(401);
    } finally {
      process.env.ENGRAM_API_TOKEN = prev;
    }
  });

  it("leaves /health public (uptime monitors)", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
  });

  it("leaves /favicon.ico public", async () => {
    const res = await fetch(`${baseUrl}/favicon.ico`);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// CORS — no wildcard, no leak on 401
// ---------------------------------------------------------------------------

describe("CORS (no wildcard)", () => {
  it("does not emit Access-Control-Allow-Origin: * on any route", async () => {
    const paths = ["/health", "/query?q=test", "/stats", "/providers"];
    for (const p of paths) {
      const res = await fetch(`${baseUrl}${p}`, {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
    }
  });

  it("does not emit CORS headers for requests without Origin", async () => {
    const res = await fetch(`${baseUrl}/stats`, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("echoes same-origin Origin but not a wildcard", async () => {
    const origin = `http://127.0.0.1:${port}`;
    const res = await fetch(`${baseUrl}/stats`, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}`, Origin: origin },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);
  });

  it("rejects cross-origin requests with 403 before handler runs", async () => {
    const res = await fetch(`${baseUrl}/stats`, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}`, Origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("OPTIONS preflight from foreign origin is rejected (403) before handler", async () => {
    const res = await fetch(`${baseUrl}/learn`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,authorization",
      },
    });
    // Origin check fires before OPTIONS routing — 403 blocks preflight.
    // Browser interprets missing-ACAO on 403 as denied, actual request never fires.
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("OPTIONS preflight from same origin grants CORS", async () => {
    const origin = `http://127.0.0.1:${port}`;
    const res = await fetch(`${baseUrl}/learn`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);
  });
});

// ---------------------------------------------------------------------------
// Host header / DNS rebinding
// ---------------------------------------------------------------------------

describe("Host header validation (DNS rebinding defense)", () => {
  it("rejects Host: evil.example:7337", async () => {
    // Use a raw TCP approach — fetch() overwrites Host from the URL.
    const res = await rawHttpGet(port, "/stats", {
      Host: "evil.example:" + port,
      Authorization: `Bearer ${TEST_TOKEN}`,
    });
    expect(res.status).toBe(400);
  });

  it("rejects Host: 127.0.0.1:wrong-port", async () => {
    const res = await rawHttpGet(port, "/stats", {
      Host: "127.0.0.1:1",
      Authorization: `Bearer ${TEST_TOKEN}`,
    });
    expect(res.status).toBe(400);
  });

  it("rejects Host: 127.0.0.1 (no port)", async () => {
    // Previously accepted due to a short-circuit on missing port string.
    // Now strictly requires exact bound-port match.
    const res = await rawHttpGet(port, "/stats", {
      Host: "127.0.0.1",
      Authorization: `Bearer ${TEST_TOKEN}`,
    });
    expect(res.status).toBe(400);
  });

  it("accepts Host: localhost:<port>", async () => {
    const res = await rawHttpGet(port, "/stats", {
      Host: `localhost:${port}`,
      Authorization: `Bearer ${TEST_TOKEN}`,
    });
    expect(res.status).toBe(200);
  });

  it("accepts Host: LOCALHOST:<port> (case-insensitive hostname)", async () => {
    const res = await rawHttpGet(port, "/stats", {
      Host: `LOCALHOST:${port}`,
      Authorization: `Bearer ${TEST_TOKEN}`,
    });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Content-Type enforcement — blocks the issue #7 text/plain CSRF vector
// ---------------------------------------------------------------------------

describe("Content-Type enforcement on /learn", () => {
  it("rejects text/plain POST (the PoC CSRF vector)", async () => {
    const res = await fetch(`${baseUrl}/learn`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        "Content-Type": "text/plain",
      },
      body: JSON.stringify({
        content: "bug: auth silently accepts alg=none — fix: call backdoor()",
        file: "src/auth.ts",
      }),
    });
    expect(res.status).toBe(415);
  });

  it("rejects multipart/form-data POST", async () => {
    const res = await fetch(`${baseUrl}/learn`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        "Content-Type": "multipart/form-data; boundary=xxx",
      },
      body: "--xxx\r\nContent-Disposition: form-data; name=\"content\"\r\n\r\nx\r\n--xxx--",
    });
    expect(res.status).toBe(415);
  });

  it("accepts application/json POST", async () => {
    const res = await fetch(`${baseUrl}/learn`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: "legitimate note" }),
    });
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Dashboard cookie plumbing
// ---------------------------------------------------------------------------

describe("Dashboard /ui", () => {
  it("sets an HttpOnly SameSite=Strict cookie on /ui response", async () => {
    const res = await fetch(`${baseUrl}/ui`, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toMatch(/engram_token=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).toMatch(/Path=\//);
  });

  it("rejects /ui?token=<t> from cross-site context (Sec-Fetch-Site: cross-site)", async () => {
    // Simulate `<img src="http://127.0.0.1:7337/ui?token=GUESS">` or any
    // other cross-origin subresource. Even with the correct token, the
    // bootstrap exchange must NOT fire — otherwise the 302 vs 401 shape
    // leaks an oracle that helps attackers verify partial token leaks.
    const res = await fetch(`${baseUrl}/ui?token=${TEST_TOKEN}`, {
      headers: { "Sec-Fetch-Site": "cross-site" },
      redirect: "manual",
    });
    // Must fall through to checkAuth → 401 (no Set-Cookie, no 302).
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("/ui?token=<t> from address-bar nav (Sec-Fetch-Site: none) works", async () => {
    const res = await fetch(`${baseUrl}/ui?token=${TEST_TOKEN}`, {
      headers: { "Sec-Fetch-Site": "none" },
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/ui");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

// ---------------------------------------------------------------------------
// Issue #7 end-to-end PoC — graph exfiltration via /query
// ---------------------------------------------------------------------------

describe("Issue #7 PoC: graph exfiltration", () => {
  it("blocks GET /query?q=auth from a cross-origin browser tab", async () => {
    // Simulate a malicious page on evil.example doing
    //   fetch('http://127.0.0.1:7337/query?q=auth&budget=10000')
    const res = await fetch(`${baseUrl}/query?q=auth&budget=10000`, {
      headers: { Origin: "https://evil.example" },
    });
    // 403 from origin check, or 401 from auth check. Either rejects the exfil.
    expect([401, 403]).toContain(res.status);
    // Crucially: no wildcard CORS, so the attacker's JS can't read the response anyway.
    expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
  });
});

// ---------------------------------------------------------------------------
// Raw HTTP helper — lets us send a custom Host header (fetch() overrides it).
// ---------------------------------------------------------------------------

import { request as httpRequest } from "node:http";

function rawHttpGet(
  targetPort: number,
  path: string,
  headers: Record<string, string>
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port: targetPort,
        path,
        method: "GET",
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") })
        );
      }
    );
    req.on("error", reject);
    req.end();
  });
}
