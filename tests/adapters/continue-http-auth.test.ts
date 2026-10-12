import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  queryViaHttp,
  resolveHttpAuthToken,
} from "../../adapters/continue/src/index";

/**
 * Regression test: Continue adapter HTTP fallback auth.
 *
 * Defect: the adapter's HTTP fallback sent no Authorization header, while
 * engram's /query route is fail-closed (401 without a valid token, see
 * src/server/http.ts + src/server/auth.ts). The fallback therefore always
 * failed against a real server. The adapter must resolve the token the same
 * way the server documents for external callers (ENGRAM_API_TOKEN env, then
 * ~/.engram/http-server.token) and present `Authorization: Bearer <token>`.
 */

const FIXTURE_TOKEN = "f".repeat(64); // 64-char hex, like the server generates
const SHORT_TOKEN = "too-short"; // below the 32-char server minimum

let server: Server;
let baseUrl: string;

// Env snapshot/restore so the suite never leaks into other test files.
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ["ENGRAM_API_TOKEN", "HOME", "USERPROFILE"];

beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

  // Minimal stand-in for engram's fail-closed /query route: 401 unless the
  // request carries the exact Bearer token, mirroring src/server/http.ts.
  server = createServer((req, res) => {
    const auth = req.headers.authorization ?? "";
    if (auth !== `Bearer ${FIXTURE_TOKEN}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ text: "fixture-context" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Point homedir() at a throwaway dir (POSIX reads HOME, Windows USERPROFILE). */
function useTempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "engram-continue-auth-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return home;
}

describe("continue adapter: HTTP fallback auth", () => {
  it("sends Bearer auth from ENGRAM_API_TOKEN and gets context back", async () => {
    useTempHome(); // ensure no real token file interferes
    process.env.ENGRAM_API_TOKEN = FIXTURE_TOKEN;

    const result = await queryViaHttp("auth flow", baseUrl);
    expect(result).toBe("fixture-context");
  });

  it("sends Bearer auth from ~/.engram/http-server.token", async () => {
    const home = useTempHome();
    delete process.env.ENGRAM_API_TOKEN;
    mkdirSync(join(home, ".engram"), { recursive: true });
    writeFileSync(join(home, ".engram", "http-server.token"), FIXTURE_TOKEN + "\n");

    const result = await queryViaHttp("auth flow", baseUrl);
    expect(result).toBe("fixture-context");

    rmSync(home, { recursive: true, force: true });
  });

  it("degrades to null (no throw) when no token is resolvable and the server 401s", async () => {
    useTempHome();
    delete process.env.ENGRAM_API_TOKEN;

    expect(resolveHttpAuthToken()).toBeNull();
    const result = await queryViaHttp("auth flow", baseUrl);
    expect(result).toBeNull();
  });

  it("rejects tokens below the server's 32-char minimum", () => {
    useTempHome();
    process.env.ENGRAM_API_TOKEN = SHORT_TOKEN;
    expect(resolveHttpAuthToken()).toBeNull();
  });
});
