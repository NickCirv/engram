#!/usr/bin/env tsx
/**
 * engram Zed Context Server
 *
 * Implements the Zed context server protocol (JSON-RPC over stdio).
 * Invoked via: engram context-server
 *
 * Protocol:
 *   context/list   → advertise the "engram" slash command
 *   context/fetch  → run engram query, return text
 */

import { createInterface } from "node:readline";
import { execFileSync } from "node:child_process";

interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: number | string;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: number | string;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}

function respond(id: number | string, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function respondError(
  id: number | string,
  code: number,
  message: string
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function handleList(id: number | string): JsonRpcResponse {
  return respond(id, {
    contexts: [
      {
        name: "engram",
        description:
          "Knowledge graph context: architecture, decisions, patterns, known issues",
      },
    ],
  });
}

function handleFetch(
  id: number | string,
  params: Record<string, unknown>
): JsonRpcResponse {
  const queryText = typeof params.query === "string" ? params.query.trim() : "";
  const projectRoot =
    typeof params.project === "string" ? params.project : process.cwd();

  if (!queryText) {
    return respond(id, { text: "Provide a query to search the engram graph." });
  }

  try {
    const output = execFileSync(
      "engram",
      ["query", queryText, "-p", projectRoot, "--budget", "2000"],
      { encoding: "utf-8", timeout: 8000 }
    );
    return respond(id, { text: output.trim() || "No matching context found." });
  } catch {
    return respond(id, {
      text: "engram query failed — is the project indexed? Run: engram init",
    });
  }
}

function handleRequest(req: JsonRpcRequest): JsonRpcResponse {
  switch (req.method) {
    case "context/list":
      return handleList(req.id);

    case "context/fetch": {
      const params = req.params ?? {};
      return handleFetch(req.id, params);
    }

    default:
      return respondError(
        req.id,
        -32601,
        `Method not found: ${req.method}`
      );
  }
}

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let req: JsonRpcRequest;
  try {
    req = JSON.parse(trimmed) as JsonRpcRequest;
  } catch {
    // Malformed JSON — skip silently per JSON-RPC spec
    return;
  }

  const res = handleRequest(req);
  process.stdout.write(JSON.stringify(res) + "\n");
});
