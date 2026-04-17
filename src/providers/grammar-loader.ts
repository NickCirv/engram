/**
 * grammar-loader — lazy-load web-tree-sitter WASM grammars.
 *
 * Parses are cached by language so Parser.init() is only called once.
 * Returns null on any error — callers must handle unavailability gracefully.
 */
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { Parser as ParserType } from "web-tree-sitter";

const require = createRequire(import.meta.url);

const parserCache = new Map<string, ParserType>();
let tsParserInit = false;

/** File extension → tree-sitter language name. */
const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  go: "go",
  rs: "rust",
  rb: "ruby",
  java: "java",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  php: "php",
};

/** npm package name that ships the WASM for a given language. */
const LANG_TO_PKG: Record<string, string> = {
  typescript: "tree-sitter-typescript",
  tsx: "tree-sitter-typescript",
  javascript: "tree-sitter-javascript",
  python: "tree-sitter-python",
  go: "tree-sitter-go",
  rust: "tree-sitter-rust",
};

export function getSupportedLang(filePath: string): string | null {
  const ext = filePath.split(".").pop()?.toLowerCase();
  return ext ? (EXT_TO_LANG[ext] ?? null) : null;
}

/** Locate the WASM file for a language, checking multiple candidate paths. */
function findGrammarWasm(lang: string): string | null {
  const pkg = LANG_TO_PKG[lang];
  if (!pkg) return null;

  // The WASM filename matches the language name for most packages,
  // except tsx which lives inside tree-sitter-typescript.
  const wasmName = lang === "tsx" ? "tree-sitter-tsx.wasm" : `tree-sitter-${lang}.wasm`;

  const candidates: string[] = [];

  // 1. Bundled grammars in dist/grammars/ (shipped with npm package)
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // From dist/providers/ → dist/grammars/
    candidates.push(join(here, "..", "grammars", wasmName));
    // From dist/ (flat) → dist/grammars/
    candidates.push(join(here, "grammars", wasmName));
  } catch {
    // import.meta.url may not be available in all contexts
  }

  // 2. node_modules (development / local install)
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    candidates.push(join(here, "..", "..", "node_modules", pkg, wasmName));
  } catch {
    // fallthrough
  }

  // 3. Resolve via require (follows node_modules resolution)
  try {
    const pkgMain = require.resolve(`${pkg}/package.json`);
    const pkgDir = dirname(pkgMain);
    candidates.push(join(pkgDir, wasmName));
  } catch {
    // package not installed
  }

  return candidates.find((c) => existsSync(c)) ?? null;
}

/**
 * Get (or create) a Parser for the given language.
 * Returns null if the grammar WASM is unavailable or fails to load.
 */
export async function getParser(lang: string): Promise<ParserType | null> {
  const cached = parserCache.get(lang);
  if (cached) return cached;

  try {
    // Dynamic import keeps web-tree-sitter out of the hot path when unused.
    // The module exports Parser and Language as separate named exports.
    const { Parser, Language } = await import("web-tree-sitter");

    if (!tsParserInit) {
      await Parser.init();
      tsParserInit = true;
    }

    const wasmPath = findGrammarWasm(lang);
    if (!wasmPath) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const language = await (Language as any).load(wasmPath);
    const parser = new Parser();
    parser.setLanguage(language);
    parserCache.set(lang, parser);
    return parser;
  } catch {
    return null;
  }
}

/** Reset parser cache. Used in tests. */
export function _resetParserCache(): void {
  parserCache.clear();
  tsParserInit = false;
}
