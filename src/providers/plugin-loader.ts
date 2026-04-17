/**
 * Dynamic loader for third-party context provider plugins.
 *
 * Plugins live at `~/.engram/plugins/*.mjs`. Each must default-export
 * an object matching `ContextProviderPlugin`. The loader validates the
 * shape, skips anything malformed (with a stderr warning), and returns
 * a deduped list of valid plugins.
 *
 * Load failures NEVER throw into the resolver path — a broken plugin
 * must not break engram itself. Worst case: the plugin is silently
 * skipped and noted in `engram plugin list`.
 */
import { existsSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import type { ContextProviderPlugin } from "./types.js";

/** Root directory for user-installed plugins. */
export const PLUGINS_DIR = join(homedir(), ".engram", "plugins");

export interface PluginLoadResult {
  readonly loaded: readonly ContextProviderPlugin[];
  readonly failed: readonly { file: string; reason: string }[];
}

/** Ensure the plugins directory exists. Safe to call repeatedly. */
export function ensurePluginsDir(): void {
  if (!existsSync(PLUGINS_DIR)) {
    mkdirSync(PLUGINS_DIR, { recursive: true });
  }
}

/**
 * Validate a loaded module exports a ContextProviderPlugin-shaped object.
 * Returns null + reason if invalid, the plugin object if valid.
 */
export function validatePlugin(mod: unknown): { plugin: ContextProviderPlugin | null; reason: string } {
  if (!mod || typeof mod !== "object") {
    return { plugin: null, reason: "module did not export an object" };
  }
  const m = mod as { default?: unknown };
  const candidate = m.default !== undefined ? m.default : mod;

  if (!candidate || typeof candidate !== "object") {
    return { plugin: null, reason: "default export is not an object" };
  }

  const p = candidate as Partial<ContextProviderPlugin>;
  const required: (keyof ContextProviderPlugin)[] = [
    "name",
    "label",
    "tier",
    "tokenBudget",
    "timeoutMs",
    "version",
    "resolve",
    "isAvailable",
  ];

  for (const field of required) {
    if (p[field] === undefined || p[field] === null) {
      return { plugin: null, reason: `missing required field: ${field}` };
    }
  }

  if (typeof p.resolve !== "function") {
    return { plugin: null, reason: "resolve must be a function" };
  }
  if (typeof p.isAvailable !== "function") {
    return { plugin: null, reason: "isAvailable must be a function" };
  }
  if (p.tier !== 1 && p.tier !== 2) {
    return { plugin: null, reason: `tier must be 1 or 2 (got ${String(p.tier)})` };
  }
  if (typeof p.name !== "string" || p.name.length === 0) {
    return { plugin: null, reason: "name must be a non-empty string" };
  }

  // Sanity: plugin names must not collide with built-in provider names.
  // The resolver applies that check separately — here we just accept
  // anything that passes shape validation.
  return { plugin: candidate as ContextProviderPlugin, reason: "" };
}

/**
 * Discover and load all plugins from `~/.engram/plugins/`.
 * Returns loaded plugins + reasons for any that failed to load.
 * Never throws.
 */
export async function loadPlugins(): Promise<PluginLoadResult> {
  const loaded: ContextProviderPlugin[] = [];
  const failed: { file: string; reason: string }[] = [];

  if (!existsSync(PLUGINS_DIR)) {
    return { loaded, failed };
  }

  let files: string[];
  try {
    files = readdirSync(PLUGINS_DIR).filter((f) => f.endsWith(".mjs") || f.endsWith(".js"));
  } catch {
    return { loaded, failed };
  }

  for (const file of files) {
    const fullPath = join(PLUGINS_DIR, file);
    try {
      // Dynamic ESM import from absolute path — must be a file:// URL on Windows
      const mod = (await import(pathToFileURL(fullPath).href)) as unknown;
      const { plugin, reason } = validatePlugin(mod);
      if (plugin) {
        // Drop duplicate names — first one wins
        if (!loaded.some((p) => p.name === plugin.name)) {
          loaded.push(plugin);
        } else {
          failed.push({ file, reason: `duplicate name: ${plugin.name}` });
        }
      } else {
        failed.push({ file, reason });
      }
    } catch (e) {
      failed.push({ file, reason: (e as Error).message });
    }
  }

  return { loaded, failed };
}

/**
 * Cached plugin list — loaded once per process. Subsequent calls return
 * the memoized result to avoid re-importing files on every resolve().
 */
let _cache: PluginLoadResult | null = null;

export async function getLoadedPlugins(): Promise<PluginLoadResult> {
  if (_cache === null) {
    _cache = await loadPlugins();
  }
  return _cache;
}

/** Reset plugin cache (for tests and CLI reload). */
export function _resetPluginCache(): void {
  _cache = null;
}
