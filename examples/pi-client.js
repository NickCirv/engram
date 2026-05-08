#!/usr/bin/env node
/**
 * Example PI client that demonstrates calling engram's /hook and /learn endpoints.
 *
 * Usage: node examples/pi-client.js /path/to/project
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PORT = process.env.ENGRAM_HTTP_PORT ?? 7337;
const TOKEN_PATH = join(homedir(), ".engram", "http-server.token");

function readToken() {
  try {
    const t = readFileSync(TOKEN_PATH, "utf-8").trim();
    return t;
  } catch (err) {
    console.error("Failed to read token at", TOKEN_PATH, err?.message ?? err);
    process.exit(1);
  }
}

async function postHook(payload) {
  const resp = await fetch(`http://127.0.0.1:${PORT}/hook`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${readToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (resp.status === 204) return null;
  return await resp.json();
}

async function postLearn(content, file) {
  const resp = await fetch(`http://127.0.0.1:${PORT}/learn`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${readToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content, file }),
  });
  if (resp.status >= 400) {
    const txt = await resp.text();
    throw new Error(`learn failed: ${txt}`);
  }
  return await resp.json();
}

const projectRootArg = process.argv[2] ?? process.cwd();

(async () => {
  console.log("Project root:", projectRootArg);
  console.log("Calling SessionStart...");
  const session = await postHook({ hook_event_name: "SessionStart", cwd: projectRootArg, source: "startup" });
  console.log("SessionStart result:", session);

  console.log("Calling UserPromptSubmit...");
  const prompt = await postHook({ hook_event_name: "UserPromptSubmit", cwd: projectRootArg, prompt: "How does authentication work?" });
  console.log("UserPromptSubmit result:", prompt);

  console.log("Posting a summary to /learn...");
  const learn = await postLearn("Session summary: example decision to prefer JWT tokens", "pi-example");
  console.log("Learn result:", learn);
})().catch((err) => {
  console.error("Error", err);
  process.exit(1);
});
