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

describe("loadPlugins (end-to-end)", () => {
  let testPluginsDir: string;
  let origHome: string | undefined;

  beforeEach(() => {
    _resetPluginCache();
    // Redirect HOME so the loader reads from our test dir
    testPluginsDir = join(tmpdir(), `engram-plugins-${Date.now()}`);
    mkdirSync(join(testPluginsDir, ".engram", "plugins"), { recursive: true });
    origHome = process.env.HOME;
    process.env.HOME = testPluginsDir;
  });

  afterEach(() => {
    _resetPluginCache();
    if (origHome !== undefined) process.env.HOME = origHome;
    rmSync(testPluginsDir, { recursive: true, force: true });
  });

  it("returns empty when no plugins installed", async () => {
    // Fresh module with updated HOME — dynamic re-import
    const mod = await import(
      "../../src/providers/plugin-loader.js?cb=" + Date.now()
    );
    const { loaded, failed } = await mod.loadPlugins();
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
    writeFileSync(
      join(testPluginsDir, ".engram", "plugins", "test-e2e.mjs"),
      pluginCode
    );

    const mod = await import(
      "../../src/providers/plugin-loader.js?cb=" + Date.now()
    );
    const { loaded, failed } = await mod.loadPlugins();
    expect(loaded.length).toBe(1);
    expect(loaded[0].name).toBe("test-e2e");
    expect(loaded[0].version).toBe("0.1.0");
    expect(failed.length).toBe(0);
  });

  it("records failures for malformed plugins without throwing", async () => {
    writeFileSync(
      join(testPluginsDir, ".engram", "plugins", "broken.mjs"),
      `export default { name: "broken" };` // missing fields
    );

    const mod = await import(
      "../../src/providers/plugin-loader.js?cb=" + Date.now()
    );
    const { loaded, failed } = await mod.loadPlugins();
    expect(loaded.length).toBe(0);
    expect(failed.length).toBe(1);
    expect(failed[0].file).toBe("broken.mjs");
  });
});
