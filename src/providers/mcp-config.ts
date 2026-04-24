/**
 * MCP provider configuration — loader + validator for
 * `~/.engram/mcp-providers.json`.
 *
 * Each entry in the file declares an external MCP server that engramx
 * will wrap as a context provider. The aggregator spawns (stdio) or
 * connects (HTTP) to each configured server, calls declared tools on
 * every Read interception, and merges results into the rich context
 * packet.
 *
 * Validation is strict by construction: a malformed entry is skipped
 * (with a stderr warning) rather than throwing — one bad plugin must
 * never break engramx.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Transport choice. `stdio` spawns the command as a child process and
 * talks JSON-RPC over stdin/stdout — the most common shape. `http`
 * connects to a running server via the MCP Streamable HTTP transport.
 */
export type McpTransport = "stdio" | "http";

/**
 * Argument template for a tool call. Values are substituted from the
 * NodeContext at resolve time. Known tokens:
 *
 * - `{filePath}`      — relative POSIX path of the file being read
 * - `{projectRoot}`   — absolute path to the project root
 * - `{imports}`       — comma-separated list of detected import names
 * - `{fileBasename}`  — basename of the file (no directory)
 *
 * Unknown tokens are left as-is. Non-string values pass through.
 */
export type ArgTemplate = Record<string, string | number | boolean>;

/**
 * Declaration of a single tool call. Every declared tool is invoked
 * once per Read interception (in parallel within a single McpProvider).
 */
export interface McpToolCall {
  /** MCP tool name (must match a tool advertised by the server). */
  readonly name: string;
  /**
   * Argument template. See `ArgTemplate` for token syntax. If omitted,
   * the default `{ path: "{filePath}" }` is used — the most common
   * file-context tool argument shape.
   */
  readonly args?: ArgTemplate;
  /**
   * Relevance confidence (0-1) assigned to results from this tool.
   * Defaults to 0.75. Used by the resolver to rank against other
   * providers when the combined packet exceeds the total token budget.
   */
  readonly confidence?: number;
}

/** Stdio transport config. */
export interface McpStdioConfig {
  readonly transport: "stdio";
  /** Executable to spawn (e.g. `"uvx"`, `"node"`, `"./my-server"`). */
  readonly command: string;
  /** Command-line arguments. */
  readonly args?: readonly string[];
  /** Environment variables (merged with `getDefaultEnvironment()`). */
  readonly env?: Readonly<Record<string, string>>;
  /** Working directory (defaults to engramx's cwd). */
  readonly cwd?: string;
}

/** HTTP transport config. */
export interface McpHttpConfig {
  readonly transport: "http";
  /** Full URL to the MCP endpoint (e.g. `https://mcp.example.com/v1`). */
  readonly url: string;
  /**
   * Static headers sent on every request. Do NOT put secrets here in
   * checked-in configs — use `envHeader` + an environment variable
   * referenced below for authorization.
   */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * Env-var-backed Authorization header. If set, the value of
   * `process.env[envHeader]` is sent as `Authorization: Bearer <value>`.
   * Example: `envHeader: "OPENAI_API_KEY"` → reads from env at request time.
   */
  readonly envHeader?: string;
}

/**
 * Full provider config. Shared shape across transports — the transport
 * discriminator selects stdio- or http-specific fields.
 */
export type McpProviderConfig = (McpStdioConfig | McpHttpConfig) & {
  /**
   * Provider identifier. Appears in context packets, `engram plugin list`,
   * and the resolver's `enabledProviders` filter. Convention: namespace
   * with your tool (e.g. `"mcp:serena"`, `"mcp:github"`).
   */
  readonly name: string;
  /** Display label shown in the context packet section header. */
  readonly label: string;
  /**
   * Tool calls to invoke on every Read. Running zero tools is legal —
   * it makes the provider inert until the user adds tools, useful for
   * staged rollouts.
   */
  readonly tools: readonly McpToolCall[];
  /** Max tokens this provider may emit per file. Default 200. */
  readonly tokenBudget?: number;
  /** Live-resolution timeout in ms. Default 2000. */
  readonly timeoutMs?: number;
  /** Cache TTL in seconds. Default 3600. */
  readonly cacheTtlSec?: number;
  /**
   * Priority (inserted into `PROVIDER_PRIORITY` by the resolver).
   * Higher values sort first when the combined packet exceeds total
   * budget. Conventional range 0-100; built-ins sit at 0-8.
   * Default: the array index position, so order in config matters.
   */
  readonly priority?: number;
  /** Disabled providers are loaded + reported but never resolve. Default true. */
  readonly enabled?: boolean;
};

/** Top-level file shape. */
export interface McpProvidersFile {
  readonly $schema?: string;
  readonly providers: readonly McpProviderConfig[];
}

/** Resolution result from loadMcpConfigs. */
export interface McpConfigLoadResult {
  readonly configs: readonly McpProviderConfig[];
  readonly failed: readonly { index: number; reason: string }[];
}

/**
 * Resolve the config file path. Overridable via `ENGRAM_MCP_CONFIG_PATH`
 * for tests and advanced users.
 */
export function getMcpConfigPath(): string {
  const override = process.env.ENGRAM_MCP_CONFIG_PATH;
  if (override && override.length > 0) return override;
  return join(homedir(), ".engram", "mcp-providers.json");
}

/**
 * Load and validate `~/.engram/mcp-providers.json`. Returns empty
 * configs + no failures if the file doesn't exist. Individual entries
 * that fail validation are skipped and reported in `failed` — one bad
 * entry must never prevent the rest from loading.
 */
export function loadMcpConfigs(
  path: string = getMcpConfigPath()
): McpConfigLoadResult {
  if (!existsSync(path)) {
    return { configs: [], failed: [] };
  }

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    return {
      configs: [],
      failed: [
        {
          index: -1,
          reason: `failed to read config file: ${(err as Error).message}`,
        },
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      configs: [],
      failed: [
        {
          index: -1,
          reason: `invalid JSON in ${path}: ${(err as Error).message}`,
        },
      ],
    };
  }

  if (!isMcpProvidersFile(parsed)) {
    return {
      configs: [],
      failed: [
        {
          index: -1,
          reason: `expected { providers: [...] } shape in ${path}`,
        },
      ],
    };
  }

  const valid: McpProviderConfig[] = [];
  const failed: { index: number; reason: string }[] = [];
  const seenNames = new Set<string>();

  for (let i = 0; i < parsed.providers.length; i++) {
    const entry = parsed.providers[i];
    const validation = validateProviderConfig(entry);
    if (validation.ok) {
      if (seenNames.has(validation.value.name)) {
        failed.push({
          index: i,
          reason: `duplicate provider name '${validation.value.name}' — first occurrence wins`,
        });
        continue;
      }
      seenNames.add(validation.value.name);
      valid.push(validation.value);
    } else {
      failed.push({ index: i, reason: validation.reason });
    }
  }

  return { configs: valid, failed };
}

/**
 * Structural type guard for the file root. Kept separate from entry
 * validation so that a bad TYPE returns a clear message without
 * iterating `providers`.
 */
function isMcpProvidersFile(v: unknown): v is McpProvidersFile {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  return Array.isArray(obj.providers);
}

/**
 * Full shape validation for a single provider. Returns a discriminated
 * result so callers can fail-open (collect failures) rather than throw.
 */
export function validateProviderConfig(
  raw: unknown
): { ok: true; value: McpProviderConfig } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "entry is not an object" };
  }
  const o = raw as Record<string, unknown>;

  if (typeof o.name !== "string" || o.name.length === 0) {
    return { ok: false, reason: "`name` must be a non-empty string" };
  }
  if (typeof o.label !== "string" || o.label.length === 0) {
    return { ok: false, reason: `[${o.name}] 'label' must be a non-empty string` };
  }
  if (o.transport !== "stdio" && o.transport !== "http") {
    return {
      ok: false,
      reason: `[${o.name}] 'transport' must be 'stdio' or 'http'`,
    };
  }
  if (!Array.isArray(o.tools)) {
    return { ok: false, reason: `[${o.name}] 'tools' must be an array` };
  }

  for (let i = 0; i < o.tools.length; i++) {
    const t = o.tools[i] as Record<string, unknown>;
    if (!t || typeof t.name !== "string" || t.name.length === 0) {
      return {
        ok: false,
        reason: `[${o.name}] tools[${i}].name must be a non-empty string`,
      };
    }
    if (t.args !== undefined && (typeof t.args !== "object" || t.args === null)) {
      return { ok: false, reason: `[${o.name}] tools[${i}].args must be an object` };
    }
    if (t.confidence !== undefined) {
      if (
        typeof t.confidence !== "number" ||
        t.confidence < 0 ||
        t.confidence > 1
      ) {
        return {
          ok: false,
          reason: `[${o.name}] tools[${i}].confidence must be in [0, 1]`,
        };
      }
    }
  }

  // Transport-specific fields
  if (o.transport === "stdio") {
    if (typeof o.command !== "string" || o.command.length === 0) {
      return { ok: false, reason: `[${o.name}] 'command' required for stdio transport` };
    }
    if (o.args !== undefined && !Array.isArray(o.args)) {
      return { ok: false, reason: `[${o.name}] 'args' must be an array of strings` };
    }
  } else {
    if (typeof o.url !== "string" || o.url.length === 0) {
      return { ok: false, reason: `[${o.name}] 'url' required for http transport` };
    }
    try {
      new URL(o.url as string);
    } catch {
      return { ok: false, reason: `[${o.name}] 'url' is not a valid URL` };
    }
  }

  // Optional numeric fields — reject if present but negative / zero
  for (const field of ["tokenBudget", "timeoutMs", "cacheTtlSec", "priority"] as const) {
    if (o[field] !== undefined) {
      if (typeof o[field] !== "number" || (o[field] as number) < 0) {
        return {
          ok: false,
          reason: `[${o.name}] '${field}' must be a non-negative number`,
        };
      }
    }
  }

  return { ok: true, value: raw as McpProviderConfig };
}

/**
 * Substitute template tokens in an args object. Returns a new object —
 * the input is not mutated. Unknown tokens pass through as-is (so the
 * server sees them verbatim and can report a helpful error).
 */
export function applyArgTemplate(
  template: ArgTemplate | undefined,
  ctx: {
    filePath: string;
    projectRoot: string;
    imports: readonly string[];
    fileBasename?: string;
  }
): Record<string, unknown> {
  const defaults: ArgTemplate = { path: "{filePath}" };
  const src = template ?? defaults;
  const out: Record<string, unknown> = {};

  const basename = ctx.fileBasename ?? ctx.filePath.split("/").pop() ?? ctx.filePath;
  const tokens: Record<string, string> = {
    filePath: ctx.filePath,
    projectRoot: ctx.projectRoot,
    imports: ctx.imports.join(","),
    fileBasename: basename,
  };

  for (const [key, value] of Object.entries(src)) {
    if (typeof value === "string") {
      out[key] = value.replace(/\{(\w+)\}/g, (match, token: string) =>
        Object.prototype.hasOwnProperty.call(tokens, token)
          ? tokens[token]
          : match
      );
    } else {
      out[key] = value;
    }
  }

  return out;
}
