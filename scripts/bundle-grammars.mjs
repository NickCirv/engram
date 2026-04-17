#!/usr/bin/env node
/**
 * bundle-grammars — copies tree-sitter WASM files into dist/grammars/
 * so they ship with the npm package.
 *
 * Pure Node ESM — no tsx / no TypeScript dependency. Runs in any install,
 * including pnpm / npm ci fresh clones where devDependencies aren't present.
 *
 * Invoked automatically by `npm run build`.
 */
import { cpSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, "dist", "grammars");

const require = createRequire(import.meta.url);

/** Grammar WASM files to bundle: [packageName, wasmFilename] */
const GRAMMARS = [
  ["tree-sitter-typescript", "tree-sitter-typescript.wasm"],
  ["tree-sitter-typescript", "tree-sitter-tsx.wasm"],
  ["tree-sitter-javascript", "tree-sitter-javascript.wasm"],
  ["tree-sitter-python", "tree-sitter-python.wasm"],
  ["tree-sitter-go", "tree-sitter-go.wasm"],
  ["tree-sitter-rust", "tree-sitter-rust.wasm"],
];

mkdirSync(outDir, { recursive: true });

let copied = 0;
let skipped = 0;

for (const [pkg, wasmFile] of GRAMMARS) {
  try {
    const pkgMain = require.resolve(`${pkg}/package.json`);
    const src = join(dirname(pkgMain), wasmFile);
    const dest = join(outDir, wasmFile);

    if (!existsSync(src)) {
      console.warn(`  skip: ${wasmFile} (not found in ${pkg})`);
      skipped++;
      continue;
    }

    cpSync(src, dest);
    console.log(`  copy: ${wasmFile}`);
    copied++;
  } catch {
    console.warn(`  skip: ${wasmFile} (${pkg} not installed)`);
    skipped++;
  }
}

console.log(`\n  ${copied} grammars bundled, ${skipped} skipped → dist/grammars/`);

if (copied === 0) {
  console.error("ERROR: No grammars were bundled!");
  process.exit(1);
}
