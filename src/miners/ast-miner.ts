/**
 * AST Miner — deterministic code structure extraction via tree-sitter.
 * Zero LLM cost. Extracts classes, functions, imports, call graphs.
 * Supports: TypeScript, JavaScript, Python, Go, Rust, Java, C, C++, Ruby, PHP
 */
import { readFileSync, existsSync, readdirSync, realpathSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import type { GraphEdge, GraphNode } from "../graph/schema.js";
import { toPosixPath } from "../graph/path-utils.js";

// tree-sitter query patterns per language
interface LangConfig {
  extensions: string[];
  classTypes: string[];
  functionTypes: string[];
  importTypes: string[];
  callTypes: string[];
  nameField: string;
  bodyField: string;
}

const LANG_CONFIGS: Record<string, LangConfig> = {
  typescript: {
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
    classTypes: ["class_declaration"],
    functionTypes: [
      "function_declaration",
      "method_definition",
      "arrow_function",
    ],
    importTypes: ["import_statement"],
    callTypes: ["call_expression"],
    nameField: "name",
    bodyField: "body",
  },
  python: {
    extensions: [".py"],
    classTypes: ["class_definition"],
    functionTypes: ["function_definition"],
    importTypes: ["import_statement", "import_from_statement"],
    callTypes: ["call"],
    nameField: "name",
    bodyField: "body",
  },
  go: {
    extensions: [".go"],
    classTypes: ["type_declaration"],
    functionTypes: ["function_declaration", "method_declaration"],
    importTypes: ["import_declaration"],
    callTypes: ["call_expression"],
    nameField: "name",
    bodyField: "body",
  },
  rust: {
    extensions: [".rs"],
    classTypes: ["struct_item", "enum_item", "trait_item"],
    functionTypes: ["function_item"],
    importTypes: ["use_declaration"],
    callTypes: ["call_expression"],
    nameField: "name",
    bodyField: "body",
  },
  java: {
    extensions: [".java"],
    classTypes: ["class_declaration", "interface_declaration"],
    functionTypes: ["method_declaration", "constructor_declaration"],
    importTypes: ["import_declaration"],
    callTypes: ["method_invocation"],
    nameField: "name",
    bodyField: "body",
  },
  ruby: {
    extensions: [".rb"],
    classTypes: ["class", "module"],
    functionTypes: ["method"],
    importTypes: ["call"], // require/include are calls in Ruby
    callTypes: ["call"],
    nameField: "name",
    bodyField: "body",
  },
  php: {
    extensions: [".php"],
    classTypes: ["class_declaration", "interface_declaration"],
    functionTypes: ["function_definition", "method_declaration"],
    importTypes: ["namespace_use_declaration"],
    callTypes: ["function_call_expression"],
    nameField: "name",
    bodyField: "body",
  },
};

const EXT_TO_LANG: Record<string, string> = {};
for (const [lang, config] of Object.entries(LANG_CONFIGS)) {
  for (const ext of config.extensions) {
    EXT_TO_LANG[ext] = lang;
  }
}

export const SUPPORTED_EXTENSIONS = new Set(Object.keys(EXT_TO_LANG));

function makeId(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join("_")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase()
    .slice(0, 120);
}

interface ExtractionResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  fileCount: number;
  totalLines: number;
}

/**
 * Lightweight AST extraction without tree-sitter WASM dependency.
 * Uses regex-based heuristics for the initial version — accurate enough
 * for structural extraction of functions, classes, imports, and exports.
 * Tree-sitter WASM integration is Phase 2 (adds call-graph precision).
 */
export function extractFile(
  filePath: string,
  rootDir: string
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const ext = extname(filePath).toLowerCase();
  const lang = EXT_TO_LANG[ext];
  if (!lang) return { nodes: [], edges: [] };

  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  // Always store POSIX paths in the graph for portability and consistent
  // lookups on Windows (where path.relative returns native `\` separators).
  const relPath = toPosixPath(relative(rootDir, filePath));
  const stem = basename(filePath, ext);
  const now = Date.now();

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seenIds = new Set<string>();

  const addNode = (
    id: string,
    label: string,
    kind: GraphNode["kind"],
    line: number | null
  ): void => {
    if (seenIds.has(id)) return;
    seenIds.add(id);
    nodes.push({
      id,
      label,
      kind,
      sourceFile: relPath,
      sourceLocation: line ? `L${line}` : null,
      confidence: "EXTRACTED",
      confidenceScore: 0.85, // Regex heuristic — reserve 1.0 for tree-sitter
      lastVerified: now,
      queryCount: 0,
      metadata: { lang },
    });
  };

  const addEdge = (
    source: string,
    target: string,
    relation: GraphEdge["relation"],
    line: number | null
  ): void => {
    edges.push({
      source,
      target,
      relation,
      confidence: "EXTRACTED",
      confidenceScore: 0.85, // Regex heuristic — reserve 1.0 for tree-sitter
      sourceFile: relPath,
      sourceLocation: line ? `L${line}` : null,
      lastVerified: now,
      metadata: {},
    });
  };

  // File node
  const fileId = makeId(stem);
  addNode(fileId, basename(filePath), "file", 1);

  // Language-specific extraction
  if (lang === "typescript" || lang === "python" || lang === "java") {
    extractWithPatterns(
      content,
      lines,
      lang,
      fileId,
      stem,
      relPath,
      addNode,
      addEdge
    );
  } else if (lang === "go") {
    extractGo(content, lines, fileId, stem, relPath, addNode, addEdge);
  } else if (lang === "rust") {
    extractRust(content, lines, fileId, stem, relPath, addNode, addEdge);
  } else {
    // Fallback: generic pattern extraction
    extractWithPatterns(
      content,
      lines,
      lang,
      fileId,
      stem,
      relPath,
      addNode,
      addEdge
    );
  }

  return { nodes, edges };
}

function extractWithPatterns(
  content: string,
  lines: string[],
  lang: string,
  fileId: string,
  stem: string,
  relPath: string,
  addNode: (
    id: string,
    label: string,
    kind: GraphNode["kind"],
    line: number | null
  ) => void,
  addEdge: (
    source: string,
    target: string,
    relation: GraphEdge["relation"],
    line: number | null
  ) => void
): void {
  const patterns = getPatterns(lang);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip commented-out lines (single-line comments and block comment continuations)
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    // Classes
    for (const pat of patterns.classes) {
      const match = line.match(pat);
      if (match?.[1]) {
        const name = match[1];
        const id = makeId(stem, name);
        addNode(id, name, "class", lineNum);
        addEdge(fileId, id, "contains", lineNum);
      }
    }

    // Functions
    for (const pat of patterns.functions) {
      const match = line.match(pat);
      if (match?.[1]) {
        // Arrow function pattern: require `=>` on the same line to avoid
        // matching plain assignments like `const result = (someValue)`
        if (pat.source.includes("const|let") && !line.includes("=>")) continue;
        const name = match[1];
        const id = makeId(stem, name);
        addNode(id, `${name}()`, "function", lineNum);
        addEdge(fileId, id, "contains", lineNum);
      }
    }

    // Imports
    for (const pat of patterns.imports) {
      const match = line.match(pat);
      if (match?.[1]) {
        const module = match[1]
          .replace(/['"]/g, "")
          .split("/")
          .pop()!
          .replace(/\.\w+$/, "");
        if (module && !module.startsWith(".")) {
          const id = makeId(module);
          addEdge(fileId, id, "imports", lineNum);
        }
      }
    }

    // Exports
    for (const pat of patterns.exports) {
      const match = line.match(pat);
      if (match?.[1]) {
        const name = match[1];
        const id = makeId(stem, name);
        addEdge(fileId, id, "exports", lineNum);
      }
    }
  }
}

function extractGo(
  content: string,
  lines: string[],
  fileId: string,
  stem: string,
  relPath: string,
  addNode: (
    id: string,
    label: string,
    kind: GraphNode["kind"],
    line: number | null
  ) => void,
  addEdge: (
    source: string,
    target: string,
    relation: GraphEdge["relation"],
    line: number | null
  ) => void
): void {
  let inImportBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Skip commented-out lines
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    // Track Go import block boundaries: `import ( ... )`
    if (/^import\s*\(/.test(line)) {
      inImportBlock = true;
      continue;
    }
    if (inImportBlock && trimmed === ")") {
      inImportBlock = false;
      continue;
    }
    // Single-line import: `import "fmt"`
    const singleImport = line.match(/^import\s+"([^"]+)"/);
    if (singleImport?.[1]) {
      const module = singleImport[1].split("/").pop()!;
      addEdge(fileId, makeId(module), "imports", lineNum);
      continue;
    }

    // func declarations
    const funcMatch = line.match(
      /^func\s+(?:\([\w\s*]+\)\s+)?(\w+)\s*\(/
    );
    if (funcMatch?.[1]) {
      const name = funcMatch[1];
      const id = makeId(stem, name);
      addNode(id, `${name}()`, "function", lineNum);
      addEdge(fileId, id, "contains", lineNum);
    }

    // type declarations (struct, interface)
    const typeMatch = line.match(/^type\s+(\w+)\s+(struct|interface)\s*\{/);
    if (typeMatch?.[1]) {
      const name = typeMatch[1];
      const kind = typeMatch[2] === "interface" ? "interface" : "class";
      const id = makeId(stem, name);
      addNode(id, name, kind, lineNum);
      addEdge(fileId, id, "contains", lineNum);
    }

    // imports — only match inside import block
    if (inImportBlock) {
      const importMatch = line.match(/^\s*"([^"]+)"/);
      if (importMatch?.[1]) {
        const module = importMatch[1].split("/").pop()!;
        addEdge(fileId, makeId(module), "imports", lineNum);
      }
    }
  }
}

function extractRust(
  content: string,
  lines: string[],
  fileId: string,
  stem: string,
  relPath: string,
  addNode: (
    id: string,
    label: string,
    kind: GraphNode["kind"],
    line: number | null
  ) => void,
  addEdge: (
    source: string,
    target: string,
    relation: GraphEdge["relation"],
    line: number | null
  ) => void
): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // fn declarations
    const fnMatch = line.match(
      /^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/
    );
    if (fnMatch?.[1]) {
      const name = fnMatch[1];
      const id = makeId(stem, name);
      addNode(id, `${name}()`, "function", lineNum);
      addEdge(fileId, id, "contains", lineNum);
    }

    // struct/enum/trait
    const structMatch = line.match(
      /^\s*(?:pub\s+)?(?:struct|enum|trait)\s+(\w+)/
    );
    if (structMatch?.[1]) {
      const name = structMatch[1];
      const id = makeId(stem, name);
      addNode(id, name, "class", lineNum);
      addEdge(fileId, id, "contains", lineNum);
    }

    // use declarations
    const useMatch = line.match(/^\s*use\s+([\w:]+)/);
    if (useMatch?.[1]) {
      const parts = useMatch[1].split("::");
      const module = parts[parts.length - 1];
      addEdge(fileId, makeId(module), "imports", lineNum);
    }
  }
}

interface LangPatterns {
  classes: RegExp[];
  functions: RegExp[];
  imports: RegExp[];
  exports: RegExp[];
}

function getPatterns(lang: string): LangPatterns {
  switch (lang) {
    case "typescript":
      return {
        classes: [/^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/],
        functions: [
          /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
          /^\s*(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(/,
          /^\s*(?:public|private|protected)\s+(?:async\s+)?(\w+)\s*\(/,
        ],
        imports: [
          /^\s*import\s+.*from\s+['"]([^'"]+)['"]/,
          /^\s*import\s+['"]([^'"]+)['"]/,
          /require\(\s*['"]([^'"]+)['"]\s*\)/,
        ],
        exports: [
          /^\s*export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type|enum)\s+(\w+)/,
        ],
      };
    case "python":
      return {
        classes: [/^\s*class\s+(\w+)/],
        functions: [/^\s*(?:async\s+)?def\s+(\w+)/],
        imports: [
          /^\s*import\s+(\w[\w.]*)/,
          /^\s*from\s+(\w[\w.]*)\s+import/,
        ],
        exports: [], // Python doesn't have explicit exports
      };
    case "java":
      return {
        classes: [
          /^\s*(?:public\s+)?(?:abstract\s+)?(?:class|interface|enum)\s+(\w+)/,
        ],
        functions: [
          /^\s*(?:public|private|protected)\s+(?:static\s+)?(?:\w+\s+)?(\w+)\s*\(/,
        ],
        imports: [/^\s*import\s+[\w.]+\.(\w+)\s*;/],
        exports: [],
      };
    case "ruby":
      return {
        classes: [/^\s*(?:class|module)\s+(\w+)/],
        functions: [/^\s*def\s+(\w+)/],
        imports: [/^\s*require\s+['"]([^'"]+)['"]/],
        exports: [],
      };
    case "php":
      return {
        classes: [
          /^\s*(?:abstract\s+)?(?:class|interface|trait)\s+(\w+)/,
        ],
        functions: [/^\s*(?:public|private|protected)?\s*function\s+(\w+)/],
        imports: [/^\s*use\s+([\w\\]+)/],
        exports: [],
      };
    default:
      return { classes: [], functions: [], imports: [], exports: [] };
  }
}

/**
 * Scan a directory recursively and extract all supported code files.
 */
export function extractDirectory(
  dirPath: string,
  rootDir?: string
): ExtractionResult {
  const root = rootDir ?? dirPath;
  const allNodes: GraphNode[] = [];
  const allEdges: GraphEdge[] = [];
  let fileCount = 0;
  let totalLines = 0;

  const visitedDirs = new Set<string>();

  function walk(dir: string): void {
    // Symlink loop protection
    let realDir: string;
    try {
      realDir = realpathSync(dir);
    } catch {
      return; // broken symlink
    }
    if (visitedDirs.has(realDir)) return;
    visitedDirs.add(realDir);

    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (
          entry.name.startsWith(".") ||
          entry.name === "node_modules" ||
          entry.name === "dist" ||
          entry.name === "build" ||
          entry.name === "__pycache__" ||
          entry.name === "vendor" ||
          entry.name === ".engram"
        ) {
          continue;
        }
        walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      const ext = extname(entry.name).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

      const { nodes, edges } = extractFile(fullPath, root);
      allNodes.push(...nodes);
      allEdges.push(...edges);
      fileCount++;

      try {
        const content = readFileSync(fullPath, "utf-8");
        totalLines += content.split("\n").length;
      } catch {
        // skip unreadable files
      }
    }
  }

  walk(dirPath);
  return { nodes: allNodes, edges: allEdges, fileCount, totalLines };
}
