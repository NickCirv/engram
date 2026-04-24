import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  validatePlugin,
  _resetPluginCache,
} from "../../src/providers/plugin-loader.js";
import type { ContextProviderPlugin } from "../../src/providers/types.js";

describe("validatePlugin", () => {
  function makeValidPlugin(): ContextProviderPlugin {
    return {
      name: "test-provider",
      label: "TEST",
      tier: 2,
      tokenBudget: 100,
      timeoutMs: 1000,
      version: "1.0.0",
      description: "Test",
      async resolve() {
        return null;
      },
      async isAvailable() {
        return true;
      },
    };
  }

  it("accepts a valid plugin as default export", () => {
    const p = makeValidPlugin();
    const result = validatePlugin({ default: p });
    expect(result.plugin).toBe(p);
    expect(result.reason).toBe("");
  });

  it("accepts a valid plugin as direct module", () => {
    const p = makeValidPlugin();
    const result = validatePlugin(p);
    expect(result.plugin).toBe(p);
  });

  it("rejects null", () => {
    const result = validatePlugin(null);
    expect(result.plugin).toBeNull();
    expect(result.reason).toContain("object");
  });

  it("rejects non-object", () => {
    const result = validatePlugin("not an object");
    expect(result.plugin).toBeNull();
  });

  it("rejects missing required field", () => {
    const p = makeValidPlugin();
    const { name: _discarded, ...bad } = p;
    const result = validatePlugin({ default: bad });
    expect(result.plugin).toBeNull();
    expect(result.reason).toContain("name");
  });

  it("rejects invalid tier", () => {
    const p = makeValidPlugin();
    const result = validatePlugin({ default: { ...p, tier: 3 } });
    expect(result.plugin).toBeNull();
    expect(result.reason).toContain("tier");
  });

  it("rejects non-function resolve", () => {
    const p = makeValidPlugin();
    const result = validatePlugin({ default: { ...p, resolve: "not a function" } });
    expect(result.plugin).toBeNull();
    expect(result.reason).toContain("resolve");
  });

  it("rejects empty name", () => {
    const p = makeValidPlugin();
    const result = validatePlugin({ default: { ...p, name: "" } });
    expect(result.plugin).toBeNull();
    expect(result.reason).toContain("name");
  });
});

describe("validatePlugin — v3.0 mcpConfig auto-wrap", () => {
  function makeMcpBackedPlugin(): Record<string, unknown> {
    return {
      name: "mcp:fake",
      label: "FAKE MCP",
      version: "0.1.0",
      description: "An MCP-backed plugin with no custom resolve()",
      mcpConfig: {
        transport: "stdio",
        command: "echo",
        args: ["fake"],
        tools: [{ name: "fake_tool" }],
      },
    };
  }

  it("accepts a plugin with only mcpConfig and auto-wraps resolve/isAvailable", () => {
    const result = validatePlugin({ default: makeMcpBackedPlugin() });
    expect(result.plugin).not.toBeNull();
    expect(result.reason).toBe("");
    if (result.plugin) {
      expect(result.plugin.name).toBe("mcp:fake");
      expect(result.plugin.label).toBe("FAKE MCP");
      expect(typeof result.plugin.resolve).toBe("function");
      expect(typeof result.plugin.isAvailable).toBe("function");
      expect(result.plugin.tier).toBe(2);
      expect(result.plugin.mcpConfig).toBeDefined();
    }
  });

  it("rejects a plugin with neither resolve() nor mcpConfig", () => {
    const result = validatePlugin({
      default: {
        name: "mcp:empty",
        label: "EMPTY",
        version: "0.1.0",
      },
    });
    expect(result.plugin).toBeNull();
    expect(result.reason).toContain("resolve");
    expect(result.reason).toContain("mcpConfig");
  });

  it("rejects a plugin with an invalid mcpConfig (missing command)", () => {
    const bad = makeMcpBackedPlugin();
    delete (bad.mcpConfig as Record<string, unknown>).command;
    const result = validatePlugin({ default: bad });
    expect(result.plugin).toBeNull();
    expect(result.reason).toContain("invalid mcpConfig");
  });

  it("rejects a plugin with an invalid mcpConfig (bad http URL)", () => {
    const bad = {
      name: "mcp:bad-http",
      label: "BAD",
      version: "0.1.0",
      mcpConfig: {
        transport: "http",
        url: "not-a-url",
        tools: [{ name: "t" }],
      },
    };
    const result = validatePlugin({ default: bad });
    expect(result.plugin).toBeNull();
    expect(result.reason).toContain("invalid mcpConfig");
  });

  it("custom resolve() wins when both resolve() AND mcpConfig are present", () => {
    const customResolveMarker = Symbol("custom-resolve-fn");
    const customResolve = async () => null;
    (customResolve as unknown as { marker: symbol }).marker = customResolveMarker;

    const plugin = {
      ...makeMcpBackedPlugin(),
      tier: 2 as const,
      tokenBudget: 50,
      timeoutMs: 500,
      resolve: customResolve,
      isAvailable: async () => true,
    };
    const result = validatePlugin({ default: plugin });
    expect(result.plugin).not.toBeNull();
    if (result.plugin) {
      // Should have kept the author's custom resolve — verify by reference
      expect(result.plugin.resolve).toBe(customResolve);
    }
  });

  it("plugin tokenBudget override wins over mcpConfig-factory default", () => {
    const plugin = {
      ...makeMcpBackedPlugin(),
      tokenBudget: 999,
    };
    const result = validatePlugin({ default: plugin });
    expect(result.plugin).not.toBeNull();
    if (result.plugin) {
      expect(result.plugin.tokenBudget).toBe(999);
    }
  });

  it("missing version is rejected even for mcpConfig plugins", () => {
    const bad = makeMcpBackedPlugin();
    delete bad.version;
    const result = validatePlugin({ default: bad });
    expect(result.plugin).toBeNull();
    expect(result.reason).toContain("version");
  });
});

describe("loadPlugins (end-to-end)", () => {
  let testPluginsDir: string;

  beforeEach(() => {
    _resetPluginCache();
    testPluginsDir = join(tmpdir(), `engram-plugins-${Date.now()}`);
    mkdirSync(testPluginsDir, { recursive: true });
  });

  afterEach(() => {
    _resetPluginCache();
    rmSync(testPluginsDir, { recursive: true, force: true });
  });

  it("returns empty when no plugins installed", async () => {
    const { loadPlugins } = await import("../../src/providers/plugin-loader.js");
    const { loaded, failed } = await loadPlugins(testPluginsDir);
    expect(loaded.length).toBe(0);
    expect(failed.length).toBe(0);
  });

  it("loads a valid plugin .mjs file", async () => {
    const pluginCode = `
export default {
  name: "test-e2e",
  label: "E2E",
  tier: 2,
  tokenBudget: 50,
  timeoutMs: 500,
  version: "0.1.0",
  description: "End-to-end test plugin",
  async resolve() { return null; },
  async isAvailable() { return true; },
};
`;
    writeFileSync(join(testPluginsDir, "test-e2e.mjs"), pluginCode);

    const { loadPlugins } = await import("../../src/providers/plugin-loader.js");
    const { loaded, failed } = await loadPlugins(testPluginsDir);
    expect(loaded.length).toBe(1);
    expect(loaded[0].name).toBe("test-e2e");
    expect(loaded[0].version).toBe("0.1.0");
    expect(failed.length).toBe(0);
  });

  it("records failures for malformed plugins without throwing", async () => {
    writeFileSync(
      join(testPluginsDir, "broken.mjs"),
      `export default { name: "broken" };` // missing fields
    );

    const { loadPlugins } = await import("../../src/providers/plugin-loader.js");
    const { loaded, failed } = await loadPlugins(testPluginsDir);
    expect(loaded.length).toBe(0);
    expect(failed.length).toBe(1);
    expect(failed[0].file).toBe("broken.mjs");
  });

  it("returns empty when directory does not exist", async () => {
    const { loadPlugins } = await import("../../src/providers/plugin-loader.js");
    const { loaded, failed } = await loadPlugins(
      join(testPluginsDir, "does-not-exist")
    );
    expect(loaded.length).toBe(0);
    expect(failed.length).toBe(0);
  });
});
