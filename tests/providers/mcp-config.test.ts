/**
 * Tests for MCP provider config loading + validation + arg templating.
 *
 * These tests exercise the config layer only — no MCP server spawning.
 * Integration tests that connect to a real MCP server (and therefore
 * require external binaries like `uvx` + Serena) live separately so CI
 * doesn't need those available for every run.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadMcpConfigs,
  validateProviderConfig,
  applyArgTemplate,
  type McpProviderConfig,
} from "../../src/providers/mcp-config.js";

describe("mcp-config: loadMcpConfigs", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "engram-mcp-config-"));
    configPath = join(tmpDir, "mcp-providers.json");
    process.env.ENGRAM_MCP_CONFIG_PATH = configPath;
  });

  afterEach(() => {
    delete process.env.ENGRAM_MCP_CONFIG_PATH;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty configs + no failures when file does not exist", () => {
    const result = loadMcpConfigs(configPath);
    expect(result.configs).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it("loads a minimal valid stdio provider", () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        providers: [
          {
            name: "mcp:test",
            label: "TEST",
            transport: "stdio",
            command: "echo",
            tools: [{ name: "foo" }],
          },
        ],
      })
    );
    const result = loadMcpConfigs(configPath);
    expect(result.configs).toHaveLength(1);
    expect(result.configs[0].name).toBe("mcp:test");
    expect(result.failed).toEqual([]);
  });

  it("loads a valid http provider with env-backed auth", () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        providers: [
          {
            name: "mcp:remote",
            label: "REMOTE",
            transport: "http",
            url: "https://mcp.example.com/v1",
            envHeader: "MY_API_KEY",
            tools: [{ name: "search" }],
            tokenBudget: 150,
            timeoutMs: 3000,
          },
        ],
      })
    );
    const result = loadMcpConfigs(configPath);
    expect(result.configs).toHaveLength(1);
    expect(result.failed).toEqual([]);
  });

  it("reports invalid JSON as a single failure", () => {
    writeFileSync(configPath, "{ not valid json");
    const result = loadMcpConfigs(configPath);
    expect(result.configs).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toMatch(/invalid JSON/);
  });

  it("reports wrong top-level shape", () => {
    writeFileSync(configPath, JSON.stringify({ wrongKey: [] }));
    const result = loadMcpConfigs(configPath);
    expect(result.configs).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toMatch(/providers/);
  });

  it("skips bad entries but keeps good ones", () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        providers: [
          {
            name: "mcp:good",
            label: "Good",
            transport: "stdio",
            command: "echo",
            tools: [{ name: "foo" }],
          },
          {
            // missing command
            name: "mcp:bad-stdio",
            label: "Bad",
            transport: "stdio",
            tools: [{ name: "foo" }],
          },
          {
            // bad url
            name: "mcp:bad-http",
            label: "Bad HTTP",
            transport: "http",
            url: "not-a-url",
            tools: [{ name: "foo" }],
          },
          {
            name: "mcp:good2",
            label: "Good 2",
            transport: "stdio",
            command: "bash",
            tools: [{ name: "bar" }],
          },
        ],
      })
    );
    const result = loadMcpConfigs(configPath);
    expect(result.configs).toHaveLength(2);
    expect(result.configs.map((c) => c.name)).toEqual([
      "mcp:good",
      "mcp:good2",
    ]);
    expect(result.failed).toHaveLength(2);
  });

  it("deduplicates provider names — first wins", () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        providers: [
          {
            name: "mcp:dup",
            label: "First",
            transport: "stdio",
            command: "echo",
            tools: [{ name: "a" }],
          },
          {
            name: "mcp:dup",
            label: "Second",
            transport: "stdio",
            command: "ls",
            tools: [{ name: "b" }],
          },
        ],
      })
    );
    const result = loadMcpConfigs(configPath);
    expect(result.configs).toHaveLength(1);
    expect(result.configs[0].label).toBe("First");
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toMatch(/duplicate/);
  });
});

describe("mcp-config: validateProviderConfig", () => {
  function makeValid(): Record<string, unknown> {
    return {
      name: "mcp:x",
      label: "X",
      transport: "stdio",
      command: "echo",
      tools: [{ name: "t" }],
    };
  }

  it("accepts a minimal valid config", () => {
    const result = validateProviderConfig(makeValid());
    expect(result.ok).toBe(true);
  });

  it("rejects entries that are not objects", () => {
    expect(validateProviderConfig(null).ok).toBe(false);
    expect(validateProviderConfig("string").ok).toBe(false);
    expect(validateProviderConfig(123).ok).toBe(false);
  });

  it("rejects empty name / label", () => {
    const r1 = validateProviderConfig({ ...makeValid(), name: "" });
    expect(r1.ok).toBe(false);
    const r2 = validateProviderConfig({ ...makeValid(), label: "" });
    expect(r2.ok).toBe(false);
  });

  it("rejects unknown transport", () => {
    const result = validateProviderConfig({ ...makeValid(), transport: "carrier-pigeon" });
    expect(result.ok).toBe(false);
  });

  it("rejects confidence outside [0, 1]", () => {
    const r1 = validateProviderConfig({
      ...makeValid(),
      tools: [{ name: "t", confidence: 1.5 }],
    });
    expect(r1.ok).toBe(false);
    const r2 = validateProviderConfig({
      ...makeValid(),
      tools: [{ name: "t", confidence: -0.1 }],
    });
    expect(r2.ok).toBe(false);
  });

  it("rejects negative tokenBudget / timeoutMs / priority", () => {
    const fields = ["tokenBudget", "timeoutMs", "cacheTtlSec", "priority"];
    for (const f of fields) {
      const result = validateProviderConfig({ ...makeValid(), [f]: -1 });
      expect(result.ok, `${f} should reject negative`).toBe(false);
    }
  });

  it("rejects stdio config missing command", () => {
    const v = makeValid();
    delete (v as Record<string, unknown>).command;
    const result = validateProviderConfig(v);
    expect(result.ok).toBe(false);
  });

  it("rejects http config missing url", () => {
    const result = validateProviderConfig({
      name: "mcp:x",
      label: "X",
      transport: "http",
      tools: [{ name: "t" }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects http config with invalid url", () => {
    const result = validateProviderConfig({
      name: "mcp:x",
      label: "X",
      transport: "http",
      url: "not a url",
      tools: [{ name: "t" }],
    });
    expect(result.ok).toBe(false);
  });

  it("accepts empty tools array (staged-rollout case)", () => {
    const result = validateProviderConfig({ ...makeValid(), tools: [] });
    expect(result.ok).toBe(true);
  });
});

describe("mcp-config: applyArgTemplate", () => {
  const ctx = {
    filePath: "src/auth/login.ts",
    projectRoot: "/home/nick/project",
    imports: ["jsonwebtoken", "express"],
  };

  it("applies default template { path: '{filePath}' } when none provided", () => {
    const result = applyArgTemplate(undefined, ctx);
    expect(result).toEqual({ path: "src/auth/login.ts" });
  });

  it("substitutes all known tokens", () => {
    const result = applyArgTemplate(
      {
        file: "{filePath}",
        root: "{projectRoot}",
        deps: "{imports}",
        bn: "{fileBasename}",
      },
      ctx
    );
    expect(result).toEqual({
      file: "src/auth/login.ts",
      root: "/home/nick/project",
      deps: "jsonwebtoken,express",
      bn: "login.ts",
    });
  });

  it("leaves unknown tokens as-is (server gets to decide)", () => {
    const result = applyArgTemplate({ weird: "{madeUpToken}" }, ctx);
    expect(result).toEqual({ weird: "{madeUpToken}" });
  });

  it("passes non-string values through unchanged", () => {
    const result = applyArgTemplate(
      { flag: true, limit: 10, name: "{fileBasename}" },
      ctx
    );
    expect(result).toEqual({ flag: true, limit: 10, name: "login.ts" });
  });

  it("handles a file path with no directory (basename fallback)", () => {
    const result = applyArgTemplate(
      { bn: "{fileBasename}" },
      { ...ctx, filePath: "README.md" }
    );
    expect(result).toEqual({ bn: "README.md" });
  });

  it("handles a Windows-style native path defensively (regression for CI Windows failure)", () => {
    // Defence-in-depth: NodeContext.filePath is contract-POSIX, but a
    // plugin author passing a raw Windows path through the helper used
    // to crash basename extraction. Fixed by splitting on either separator.
    // Regression check: if this starts failing locally, whoever reverted
    // the split(/[\\/]/) broke Windows CI silently.
    const result = applyArgTemplate(
      { bn: "{fileBasename}" },
      { ...ctx, filePath: "C:\\Users\\alice\\proj\\src\\auth.ts" }
    );
    expect(result).toEqual({ bn: "auth.ts" });
  });

  it("does not mutate the input template", () => {
    const template = { x: "{filePath}" };
    const frozen = Object.freeze(template);
    expect(() => applyArgTemplate(frozen, ctx)).not.toThrow();
    expect(template).toEqual({ x: "{filePath}" });
  });
});

describe("mcp-config: provider shape integration", () => {
  it("preserves optional numeric fields through validation + load", () => {
    const entry: McpProviderConfig = {
      name: "mcp:full",
      label: "Full",
      transport: "stdio",
      command: "echo",
      args: ["--foo"],
      tools: [{ name: "t", confidence: 0.9 }],
      tokenBudget: 123,
      timeoutMs: 4567,
      cacheTtlSec: 9999,
      priority: 50,
      enabled: false,
    };
    const result = validateProviderConfig(entry);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tokenBudget).toBe(123);
      expect(result.value.timeoutMs).toBe(4567);
      expect(result.value.priority).toBe(50);
      expect(result.value.enabled).toBe(false);
    }
  });
});
