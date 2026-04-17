/**
 * Per-project engram configuration — overrides hardcoded defaults for
 * token budgets, provider settings, and confidence thresholds.
 *
 * Stored at `.engram/config.json` inside each project root. Falls back
 * to DEFAULTS if the file is absent or malformed. All mutations produce
 * new objects (immutable patterns).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Per-provider overrides applied on top of provider-level defaults. */
export interface ProviderOverride {
  readonly enabled?: boolean;
  readonly tokenBudget?: number;
  readonly timeoutMs?: number;
}

/** Project-level engram configuration schema. */
export interface EngramConfig {
  readonly confidenceThreshold: number;
  readonly totalTokenBudget: number;
  readonly providers: Readonly<Record<string, ProviderOverride>>;
}

/** Baseline defaults. Must match the hard-coded values in resolver.ts. */
const DEFAULTS: EngramConfig = {
  confidenceThreshold: 0.7,
  totalTokenBudget: 600,
  providers: {},
};

/**
 * Read project config from `.engram/config.json`.
 * Returns DEFAULTS if the file does not exist or cannot be parsed.
 */
export function readConfig(projectRoot: string): EngramConfig {
  const configPath = join(projectRoot, ".engram", "config.json");
  if (!existsSync(configPath)) return DEFAULTS;
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8")) as Partial<EngramConfig>;
    return {
      ...DEFAULTS,
      ...raw,
      providers: { ...DEFAULTS.providers, ...(raw.providers ?? {}) },
    };
  } catch {
    return DEFAULTS;
  }
}

/**
 * Write project config to `.engram/config.json`.
 * Overwrites any existing file — callers are responsible for merging
 * with the current config before writing.
 */
export function writeConfig(projectRoot: string, config: EngramConfig): void {
  const configPath = join(projectRoot, ".engram", "config.json");
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}
