#!/usr/bin/env node
/**
 * MCP stdio server — exposes engram knowledge graph to Claude Code and other MCP clients.
 * Tools: query_graph, god_nodes, graph_stats, shortest_path, benchmark
 */
import { query, path, godNodes, stats, benchmark, mistakes } from "./core.js";
import { truncateGraphemeSafe, formatThousands } from "./graph/render-utils.js";
import { MAX_MISTAKE_LABEL_CHARS } from "./graph/query.js";

// ─── Numeric arg coercion ───────────────────────────────────────────────────
// MCP tool arguments arrive as `unknown` from JSON. `args.limit as number`
// only satisfies the TypeScript compiler; at runtime the value can be NaN,
// Infinity, a string, or missing entirely. This helper clamps untrusted
// numeric input to a safe range so a malicious/buggy client can't DOS the
// server with `depth: Infinity` on an unbounded BFS traversal.
function clampInt(
  value: unknown,
  defaultValue: number,
  min: number,
  max: number
): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return defaultValue;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface McpRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface McpResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

const PROJECT_ROOT = process.argv[2] || process.cwd();

const TOOLS: McpTool[] = [
  {
    name: "query_graph",
    description: "Search the knowledge graph using natural language. Returns relevant code structure as compact context.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "Natural language question or keywords" },
        mode: { type: "string", enum: ["bfs", "dfs"], default: "bfs" },
        depth: { type: "integer", default: 3, description: "Traversal depth (1-6)" },
        token_budget: { type: "integer", default: 2000, description: "Max output tokens" },
      },
      required: ["question"],
    },
  },
  {
    name: "god_nodes",
    description: "Return the most connected entities — the core abstractions of the codebase.",
    inputSchema: { type: "object", properties: { top_n: { type: "integer", default: 10 } } },
  },
  {
    name: "graph_stats",
    description: "Return summary: node/edge counts, confidence breakdown, token savings.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "shortest_path",
    description: "Find the shortest path between two concepts in the graph.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "Source concept" },
        target: { type: "string", description: "Target concept" },
      },
      required: ["source", "target"],
    },
  },
  {
    name: "benchmark",
    description: "Compare token cost of graph queries vs reading raw files.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_mistakes",
    description:
      "List known mistakes from the knowledge graph — prior bugs, failure modes, and wrong approaches extracted from past session documents. Use this before making changes to check if the codebase has hit similar problems before.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          default: 20,
          description: "Maximum number of mistakes to return",
        },
        since_days: {
          type: "integer",
          description: "Only return mistakes verified in the last N days",
        },
      },
    },
  },
];

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "query_graph": {
      const question = typeof args.question === "string" ? args.question : "";
      const result = await query(PROJECT_ROOT, question, {
        mode: args.mode === "dfs" ? "dfs" : "bfs",
        depth: clampInt(args.depth, 3, 1, 6),
        tokenBudget: clampInt(args.token_budget, 2000, 100, 10000),
      });
      return `${result.nodesFound} nodes found (~${result.estimatedTokens} tokens)\n\n${result.text}`;
    }
    case "god_nodes": {
      const gods = await godNodes(PROJECT_ROOT, clampInt(args.top_n, 10, 1, 100));
      return gods.map((g, i) => `${i + 1}. ${g.label} [${g.kind}] — ${g.degree} edges (${g.sourceFile})`).join("\n");
    }
    case "graph_stats": {
      const s = await stats(PROJECT_ROOT);
      return `Nodes: ${s.nodes}\nEdges: ${s.edges}\nEXTRACTED: ${s.extractedPct}%\nINFERRED: ${s.inferredPct}%\nAMBIGUOUS: ${s.ambiguousPct}%`;
    }
    case "shortest_path": {
      const result = await path(PROJECT_ROOT, args.source as string, args.target as string);
      return result.text;
    }
    case "benchmark": {
      const b = await benchmark(PROJECT_ROOT);
      return [
        `Full corpus: ~${formatThousands(b.naiveFullCorpus)} tokens`,
        `Avg graph query: ~${formatThousands(b.avgQueryTokens)} tokens`,
        `Reduction vs full corpus: ${b.reductionVsFull}x`,
        `Reduction vs relevant files: ${b.reductionVsRelevant}x`,
        "",
        ...b.perQuestion.map((pq) => `[${pq.reductionFull}x full / ${pq.reductionRelevant}x relevant] ${pq.question}`),
      ].join("\n");
    }
    case "list_mistakes": {
      const result = await mistakes(PROJECT_ROOT, {
        limit: clampInt(args.limit, 20, 1, 100),
        sinceDays:
          args.since_days !== undefined
            ? clampInt(args.since_days, 0, 0, 3650)
            : undefined,
      });
      if (result.length === 0) return "No mistakes recorded.";
      return result
        .map((m, i) => {
          // Truncate long labels surrogate-safely so emoji in mistake text
          // doesn't corrupt the MCP JSON-RPC response.
          const label = truncateGraphemeSafe(m.label, MAX_MISTAKE_LABEL_CHARS);
          return `${i + 1}. ${label} (confidence: ${m.confidence} ${m.confidenceScore}, from ${m.sourceFile})`;
        })
        .join("\n");
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

// MCP stdio protocol

let buffer = "";

process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.trim()) continue;
    let req: McpRequest;
    try {
      req = JSON.parse(line);
    } catch {
      // Malformed JSON — respond with JSON-RPC -32700 parse error.
      // id is null per spec when we can't determine it.
      const errResp: McpResponse = {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      };
      process.stdout.write(JSON.stringify(errResp) + "\n");
      continue;
    }
    // Fire-and-forget, but CATCH any downstream rejection so a tool
    // implementation throwing doesn't become an unhandled promise
    // rejection (which crashes the process under Node's strict mode).
    // Do NOT relay err.message to the client — sql.js / better-sqlite3
    // error strings can contain absolute filesystem paths.
    handleRequest(req)
      .then((res) => {
        process.stdout.write(JSON.stringify(res) + "\n");
      })
      .catch(() => {
        const errResp: McpResponse = {
          jsonrpc: "2.0",
          id: req.id,
          error: { code: -32000, message: "Internal server error" },
        };
        process.stdout.write(JSON.stringify(errResp) + "\n");
      });
  }
});

async function handleRequest(req: McpRequest): Promise<McpResponse> {
  switch (req.method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "engram", version: "0.2.1" },
        },
      };

    case "tools/list":
      return { jsonrpc: "2.0", id: req.id, result: { tools: TOOLS } };

    case "tools/call": {
      const params = req.params as { name: string; arguments: Record<string, unknown> };
      const text = await handleToolCall(params.name, params.arguments ?? {});
      return { jsonrpc: "2.0", id: req.id, result: { content: [{ type: "text", text }] } };
    }

    default:
      return { jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `Unknown method: ${req.method}` } };
  }
}
