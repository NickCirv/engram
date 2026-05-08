/**
 * PI integration helpers — minimal client to call the local engram HTTP
 * server. Designed for simple integrations from external tooling (like
 * pi). This is intentionally tiny and dependency-free: it uses the
 * platform fetch API (Node 20+) and reads the local token file at
 * ~/.engram/http-server.token when a token is not supplied.
 *
 * Usage:
 *   import { postHook, postLearn, query } from "../integrations/pi.js";
 *   await postHook({ hook_event_name: 'SessionStart', cwd: '/path', source: 'startup' });
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Node 20+ provides a global `fetch`, but TypeScript's lib config
// may not include DOM types in all environments. Declare the symbol
// loosely here so this helper compiles under the repo's strict tsconfig.
declare const fetch: any;

const DEFAULT_PORT = 7337;
const TOKEN_MIN_LEN = 32;

function tokenPath(): string {
  return join(homedir(), ".engram", "http-server.token");
}

function readTokenFromFile(): string | null {
  const p = tokenPath();
  if (!existsSync(p)) return null;
  try {
    const s = readFileSync(p, "utf-8").trim();
    return s.length >= TOKEN_MIN_LEN ? s : null;
  } catch {
    return null;
  }
}

async function fetchWithAuth(
  path: string,
  opts: { method?: string; body?: unknown; port?: number; token?: string } = {}
): Promise<any> {
  const port = opts.port ?? DEFAULT_PORT;
  const token = opts.token ?? readTokenFromFile();
  if (!token) throw new Error("No engram HTTP server token found; start the server or pass a token.");

  const url = `http://127.0.0.1:${port}${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  const res = await fetch(url, { method: opts.method ?? "GET", headers, body });
  if (res.status === 204) return null;
  if (res.status >= 400) {
    const txt = await res.text();
    throw new Error(`engram HTTP ${res.status}: ${txt}`);
  }
  return await res.json();
}

export async function postHook(
  payload: unknown,
  port?: number,
  token?: string
): Promise<any | null> {
  return await fetchWithAuth("/hook", { method: "POST", body: payload, port, token });
}

export async function postLearn(
  content: string,
  file?: string,
  port?: number,
  token?: string
): Promise<any> {
  return await fetchWithAuth("/learn", { method: "POST", body: { content, file }, port, token });
}

export async function query(
  q: string,
  port?: number,
  token?: string
): Promise<any> {
  const portToUse = port ?? DEFAULT_PORT;
  const tokenToUse = token ?? readTokenFromFile();
  if (!tokenToUse) throw new Error("No engram HTTP server token found; start the server or pass a token.");
  const url = `http://127.0.0.1:${portToUse}/query?q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${tokenToUse}` } });
  if (res.status >= 400) {
    const txt = await res.text();
    throw new Error(`engram HTTP ${res.status}: ${txt}`);
  }
  return await res.json();
}

export default { postHook, postLearn, query };
