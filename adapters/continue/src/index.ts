import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Continue.dev interface definitions (peer dependency — not installed)
interface ContextProviderDescription {
  title: string;
  displayTitle: string;
  description: string;
  type: "normal" | "query" | "submenu";
}

interface ContextItem {
  content: string;
  name: string;
  description: string;
  uri?: { type: "url" | "file"; value: string };
}

interface IDE {
  getWorkspaceDirs(): string[];
}

interface RangeInFile {
  filepath: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
}

interface ContextProviderExtras {
  fullInput: string;
  ide: IDE;
  selectedCode: RangeInFile[];
}

interface IContextProvider {
  get description(): ContextProviderDescription;
  getContextItems(query: string, extras: ContextProviderExtras): Promise<ContextItem[]>;
}

const ENGRAM_HTTP_URL = "http://127.0.0.1:7337";
const CLI_TIMEOUT_MS = 5000;
const HTTP_TIMEOUT_MS = 3000;
const DEFAULT_BUDGET = 2000;

async function queryViaCli(query: string, workspaceRoot: string): Promise<string | null> {
  // Use execFile (array args) instead of exec (shell string) — avoids
  // shell injection and works cross-platform (no shell escaping needed).
  const { stdout } = await execFileAsync(
    "engram",
    ["query", query, "-p", workspaceRoot, "--budget", String(DEFAULT_BUDGET)],
    { timeout: CLI_TIMEOUT_MS }
  );

  const trimmed = stdout.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function queryViaHttp(query: string): Promise<string | null> {
  const url = `${ENGRAM_HTTP_URL}/query?q=${encodeURIComponent(query)}&budget=${DEFAULT_BUDGET}`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });

  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as { text?: string } | unknown;
  if (data && typeof data === "object" && "text" in data && typeof (data as { text: unknown }).text === "string") {
    return (data as { text: string }).text || null;
  }

  const serialized = JSON.stringify(data);
  return serialized.length > 2 ? serialized : null;
}

class EngramContextProvider implements IContextProvider {
  get description(): ContextProviderDescription {
    return {
      title: "engram",
      displayTitle: "Engram Memory",
      description:
        "Knowledge graph context: architecture, decisions, patterns, and known issues",
      type: "query",
    };
  }

  async getContextItems(
    query: string,
    extras: ContextProviderExtras
  ): Promise<ContextItem[]> {
    if (!query.trim()) {
      return [];
    }

    const workspaceRoot =
      extras?.ide?.getWorkspaceDirs?.()[0] ?? process.cwd();

    // Strategy 1: CLI subprocess
    try {
      const cliResult = await queryViaCli(query, workspaceRoot);
      if (cliResult !== null) {
        return [
          {
            content: cliResult,
            name: "engram",
            description: `Engram knowledge graph context for: ${query}`,
          },
        ];
      }
    } catch {
      // CLI not available or project not initialized — fall through to HTTP
    }

    // Strategy 2: HTTP server (Sprint 2 / remote mode)
    try {
      const httpResult = await queryViaHttp(query);
      if (httpResult !== null) {
        return [
          {
            content: httpResult,
            name: "engram",
            description: `Engram knowledge graph context for: ${query}`,
          },
        ];
      }
    } catch {
      // HTTP server not running — graceful degradation
    }

    return [];
  }
}

export default EngramContextProvider;
export type { IContextProvider, ContextProviderDescription, ContextItem, ContextProviderExtras };
