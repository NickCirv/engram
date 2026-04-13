# Engram Phase 0 — Foundation Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace regex-based AST mining with tree-sitter WASM + oxc, add local vector search via LanceDB + transformers.js, implement hybrid graph+vector query, and ship a reproducible benchmark suite — all before any protocol or UI work begins.

**Architecture:** Three new subsystems slot in alongside the existing graphology + sql.js graph: (1) a tree-sitter/oxc AST miner replacing the regex miner, (2) a LanceDB vector store for semantic search, (3) a transformers.js local embedding pipeline. A hybrid query layer sits on top of both the graph and vector store. The existing hook layer and sentinel invariants are untouched.

**Tech Stack:** TypeScript (strict, ES2022), Node.js 20+, web-tree-sitter (WASM), oxc-parser (NAPI), @ast-grep/napi (NAPI), vectordb (LanceDB), @xenova/transformers (ONNX), @biomejs/biome, graphology (existing), vitest (existing)

**Spec reference:** `docs/superpowers/specs/2026-04-13-engram-founder-brief.md` — Part III, Phase 0

---

## File Map

```
src/
├── miners/
│   ├── types.ts                    MODIFY — add ASTNode, MinerResult, EngramMiner interfaces
│   ├── ast/
│   │   ├── treesitter.ts           CREATE — tree-sitter WASM miner (all langs except JS/TS)
│   │   ├── oxc.ts                  CREATE — oxc NAPI miner (JS/TS only, 10-50x faster)
│   │   ├── index.ts                MODIFY — route by extension: JS/TS→oxc, rest→tree-sitter
│   │   └── grammars/               CREATE DIR — .wasm files for each language
│   └── index.ts                    MODIFY — export new miners, deprecate regex miner
├── query/
│   ├── structural.ts               CREATE — ast-grep structural search
│   ├── hybrid.ts                   CREATE — graph + vector merged results
│   └── index.ts                    MODIFY — expose hybridSearch alongside existing graph queries
├── vector/
│   ├── store.ts                    CREATE — LanceDB VectorStore class
│   └── index.ts                    CREATE — export VectorStore
├── embeddings/
│   ├── pipeline.ts                 CREATE — transformers.js embed() and embedBatch()
│   └── index.ts                    CREATE — export embed, embedBatch
bench/
├── harness.ts                      CREATE — benchmark runner
├── METHODOLOGY.md                  CREATE — methodology documentation
├── fixtures/                       CREATE DIR — symlinks or git submodules to 3 public repos
│   ├── small/                      (1k files — e.g. fastify)
│   ├── medium/                     (10k files — e.g. vscode-extension-samples)
│   └── large/                      (50k files — e.g. TypeScript compiler)
└── results/                        CREATE DIR — output JSON files (gitignored)
biome.json                          CREATE — replaces .eslintrc + .prettierrc
scripts/
└── download-grammars.ts            CREATE — downloads tree-sitter WASM grammar files
```

**Tests live alongside source:**
```
src/miners/ast/__tests__/treesitter.test.ts
src/miners/ast/__tests__/oxc.test.ts
src/query/__tests__/structural.test.ts
src/query/__tests__/hybrid.test.ts
src/vector/__tests__/store.test.ts
src/embeddings/__tests__/pipeline.test.ts
bench/__tests__/harness.test.ts
```

---

## Task 1: Replace ESLint + Prettier with Biome

**Files:**
- Create: `biome.json`
- Delete: `.eslintrc*`, `.prettierrc*`, `.eslintignore`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Install Biome**

```bash
npm install --save-dev @biomejs/biome
```

- [ ] **Step 2: Run Biome init**

```bash
npx @biomejs/biome init
```

- [ ] **Step 3: Replace generated `biome.json` with this config**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": { "noUnusedVariables": "error" },
      "suspicious": { "noExplicitAny": "error" }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": { "quoteStyle": "single", "trailingCommas": "es5" }
  },
  "files": {
    "ignore": ["node_modules", "dist", ".engram", "bench/results", "src/miners/ast/grammars"]
  }
}
```

- [ ] **Step 4: Update `package.json` scripts**

Replace eslint/prettier scripts:
```json
{
  "scripts": {
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "format": "biome format --write ."
  }
}
```

- [ ] **Step 5: Remove old config files and uninstall old packages**

```bash
rm -f .eslintrc .eslintrc.js .eslintrc.json .eslintrc.yml .eslintignore
rm -f .prettierrc .prettierrc.js .prettierrc.json .prettierignore
npm uninstall eslint prettier @typescript-eslint/parser @typescript-eslint/eslint-plugin eslint-config-prettier
```

- [ ] **Step 6: Run Biome auto-fix**

```bash
npx @biomejs/biome check --write .
```

Expected: Auto-fixable violations corrected. Review any remaining manually.

- [ ] **Step 7: Verify all existing tests still pass**

```bash
npx vitest run
```

Expected: All 486 tests pass.

- [ ] **Step 8: Commit**

```bash
git add biome.json package.json
git commit -m "chore: replace eslint+prettier with biome"
```

---

## Task 2: Define Shared Miner Types

**Files:**
- Modify: `src/miners/types.ts`
- Create: `src/miners/ast/__tests__/types.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/miners/ast/__tests__/types.test.ts
import { describe, it, expectTypeOf } from 'vitest'
import type { ASTNode, MinerResult, EngramMiner } from '../../types'

describe('miner types', () => {
  it('ASTNode has required fields', () => {
    const node: ASTNode = {
      id: 'src/auth.ts::validateToken::10',
      type: 'function',
      name: 'validateToken',
      path: 'src/auth.ts',
      lines: [10, 25],
      confidence: 1.0,
      source: 'extracted',
    }
    expectTypeOf(node).toMatchTypeOf<ASTNode>()
  })

  it('MinerResult has nodes array and metadata', () => {
    const result: MinerResult = {
      nodes: [],
      confidence: 1.0,
      source: 'extracted',
    }
    expectTypeOf(result).toMatchTypeOf<MinerResult>()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/miners/ast/__tests__/types.test.ts
```

Expected: FAIL — `ASTNode` not found or missing fields.

- [ ] **Step 3: Add types to `src/miners/types.ts`**

Add these exports (preserve any existing types in the file):

```typescript
export type NodeType =
  | 'function'
  | 'class'
  | 'module'
  | 'interface'
  | 'variable'
  | 'file'

export type ConfidenceSource = 'extracted' | 'inferred' | 'ambiguous'

export interface ASTNode {
  id: string                    // "relative/path/to/file.ts::SymbolName::lineNumber"
  type: NodeType
  name: string
  path: string                  // relative, POSIX format always
  lines: [number, number]       // [startLine, endLine] — 1-indexed
  confidence: number            // 0.0–1.0
  source: ConfidenceSource
  edges?: Array<{
    to: string
    relation: 'calls' | 'imports' | 'extends' | 'uses'
  }>
  metadata?: {
    churn_rate?: number
    last_modified?: string
    known_issues?: string[]
    decisions?: string[]
  }
}

export interface MinerResult {
  nodes: ASTNode[]
  confidence: number            // overall confidence for this file's results
  source: ConfidenceSource
}

export interface EngramMiner {
  name: string
  version: string
  languages: string[]           // file extensions with dot: ['.py', '.pyw']
  mine(filepath: string, content: string): Promise<MinerResult>
  confidence(): number          // static confidence declaration for this miner type
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/miners/ast/__tests__/types.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/miners/types.ts src/miners/ast/__tests__/types.test.ts
git commit -m "feat: add shared miner type definitions (ASTNode, MinerResult, EngramMiner)"
```

---

## Task 3: Grammar Download Script

**Files:**
- Create: `scripts/download-grammars.ts`

The WASM grammar files are downloaded once and committed (or downloaded on first run). This script fetches them using Node's built-in `https` module — no shell commands or exec.

- [ ] **Step 1: Create `scripts/download-grammars.ts`**

```typescript
import { createWriteStream, mkdirSync } from 'fs'
import { get } from 'https'
import { join } from 'path'

const GRAMMARS_DIR = join(__dirname, '../src/miners/ast/grammars')
mkdirSync(GRAMMARS_DIR, { recursive: true })

const GRAMMARS: Array<[string, string]> = [
  ['python', 'https://github.com/tree-sitter/tree-sitter-python/releases/latest/download/tree-sitter-python.wasm'],
  ['go',     'https://github.com/tree-sitter/tree-sitter-go/releases/latest/download/tree-sitter-go.wasm'],
  ['rust',   'https://github.com/tree-sitter/tree-sitter-rust/releases/latest/download/tree-sitter-rust.wasm'],
  ['java',   'https://github.com/tree-sitter/tree-sitter-java/releases/latest/download/tree-sitter-java.wasm'],
  ['ruby',   'https://github.com/tree-sitter/tree-sitter-ruby/releases/latest/download/tree-sitter-ruby.wasm'],
  ['c',      'https://github.com/tree-sitter/tree-sitter-c/releases/latest/download/tree-sitter-c.wasm'],
  ['cpp',    'https://github.com/tree-sitter/tree-sitter-cpp/releases/latest/download/tree-sitter-cpp.wasm'],
]

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest)
    const request = get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        // Follow redirect
        file.close()
        downloadFile(response.headers.location!, dest).then(resolve, reject)
        return
      }
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode} for ${url}`))
        return
      }
      response.pipe(file)
      file.on('finish', () => { file.close(); resolve() })
    })
    request.on('error', reject)
    file.on('error', reject)
  })
}

async function main(): Promise<void> {
  for (const [name, url] of GRAMMARS) {
    const dest = join(GRAMMARS_DIR, `tree-sitter-${name}.wasm`)
    process.stdout.write(`Downloading tree-sitter-${name}.wasm ... `)
    await downloadFile(url, dest)
    process.stdout.write('done\n')
  }
  console.log('All grammars downloaded to', GRAMMARS_DIR)
}

main().catch(err => { console.error(err); process.exit(1) })
```

- [ ] **Step 2: Add download script to `package.json`**

```json
{
  "scripts": {
    "download-grammars": "tsx scripts/download-grammars.ts"
  }
}
```

- [ ] **Step 3: Run the download script**

```bash
npm run download-grammars
```

Expected: 7 WASM files appear in `src/miners/ast/grammars/`.

- [ ] **Step 4: Add grammars to `.gitignore` or commit them**

If WASM files are small enough to commit (each ~1-3MB): commit them so CI doesn't need to download on every run.
If too large: add to `.gitignore` and add `download-grammars` as a `prepare` script.

```bash
# Check sizes
ls -lh src/miners/ast/grammars/
```

- [ ] **Step 5: Commit**

```bash
git add scripts/download-grammars.ts package.json src/miners/ast/grammars/
git commit -m "feat: add grammar download script and tree-sitter WASM files"
```

---

## Task 4: Tree-sitter WASM Miner

**Files:**
- Create: `src/miners/ast/treesitter.ts`
- Create: `src/miners/ast/__tests__/treesitter.test.ts`

- [ ] **Step 1: Install web-tree-sitter**

```bash
npm install web-tree-sitter
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/miners/ast/__tests__/treesitter.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { TreeSitterMiner } from '../treesitter'
import { join } from 'path'

const GRAMMARS_DIR = join(__dirname, '../grammars')

describe('TreeSitterMiner', () => {
  let miner: TreeSitterMiner

  beforeAll(async () => {
    miner = new TreeSitterMiner()
    await miner.initialize(GRAMMARS_DIR)
  }, 30_000)

  it('extracts function definitions from Python with confidence 1.0', async () => {
    const content = `
def hello(name: str) -> str:
    return f"Hello, {name}"

def goodbye(name: str) -> str:
    return f"Goodbye, {name}"
`
    const result = await miner.mine('src/greet.py', content)
    expect(result.confidence).toBe(1.0)
    expect(result.source).toBe('extracted')
    expect(result.nodes.length).toBeGreaterThanOrEqual(2)
    expect(result.nodes.map(n => n.name)).toContain('hello')
    expect(result.nodes.map(n => n.name)).toContain('goodbye')
  })

  it('extracts class definitions from Python', async () => {
    const content = `
class UserService:
    def __init__(self, db):
        self.db = db

    def find_user(self, user_id: int):
        return self.db.get(user_id)
`
    const result = await miner.mine('src/user.py', content)
    expect(result.nodes.map(n => n.name)).toContain('UserService')
  })

  it('extracts functions from Go', async () => {
    const content = `
package main

func Add(a, b int) int {
    return a + b
}

func Subtract(a, b int) int {
    return a - b
}
`
    const result = await miner.mine('src/math.go', content)
    expect(result.confidence).toBe(1.0)
    expect(result.nodes.map(n => n.name)).toContain('Add')
  })

  it('returns ambiguous result for unsupported extensions', async () => {
    const result = await miner.mine('data.xyz', 'some content')
    expect(result.source).toBe('ambiguous')
    expect(result.confidence).toBe(0)
    expect(result.nodes).toHaveLength(0)
  })

  it('handles malformed code without throwing', async () => {
    const malformed = 'def incomplete('
    await expect(miner.mine('broken.py', malformed)).resolves.toBeDefined()
  })

  it('uses POSIX paths in node IDs (no backslashes)', async () => {
    const result = await miner.mine('src/auth/token.py', 'def validate(): pass')
    if (result.nodes.length > 0) {
      expect(result.nodes[0].id).toContain('src/auth/token.py')
      expect(result.nodes[0].id).not.toContain('\\')
    }
  })

  it('sets 1-indexed line numbers', async () => {
    const content = '\ndef first(): pass\n\ndef second(): pass\n'
    const result = await miner.mine('test.py', content)
    const first = result.nodes.find(n => n.name === 'first')
    expect(first?.lines[0]).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

```bash
npx vitest run src/miners/ast/__tests__/treesitter.test.ts
```

Expected: FAIL — `TreeSitterMiner` not found.

- [ ] **Step 4: Create `src/miners/ast/treesitter.ts`**

```typescript
import Parser from 'web-tree-sitter'
import { join } from 'path'
import type { ASTNode, EngramMiner, MinerResult, NodeType } from '../types'

const EXT_TO_LANG: Record<string, string> = {
  '.py': 'python', '.pyw': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.rb': 'ruby', '.rake': 'ruby',
  '.php': 'php',
  '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp',
}

const EXTRACTABLE_TYPES = new Set([
  'function_definition', 'function_declaration', 'method_definition',
  'method_declaration', 'function_item',
  'class_definition', 'class_declaration', 'class_item',
  'interface_declaration', 'trait_item', 'impl_item',
  'import_statement', 'import_from_statement', 'use_declaration',
])

const TYPE_MAP: Record<string, NodeType> = {
  function_definition: 'function', function_declaration: 'function',
  method_definition: 'function', method_declaration: 'function', function_item: 'function',
  class_definition: 'class', class_declaration: 'class', class_item: 'class',
  interface_declaration: 'interface', trait_item: 'interface',
  import_statement: 'module', import_from_statement: 'module', use_declaration: 'module',
}

export class TreeSitterMiner implements EngramMiner {
  name = 'tree-sitter'
  version = '1.0.0'
  languages = Object.keys(EXT_TO_LANG)

  private parsers = new Map<string, Parser>()
  private initialized = false

  async initialize(grammarsDir: string): Promise<void> {
    await Parser.init()
    await Promise.all(
      [...new Set(Object.values(EXT_TO_LANG))].map(async (lang) => {
        try {
          const wasmPath = join(grammarsDir, `tree-sitter-${lang}.wasm`)
          const language = await Parser.Language.load(wasmPath)
          const parser = new Parser()
          parser.setLanguage(language)
          this.parsers.set(lang, parser)
        } catch {
          // grammar file missing — skip this language silently
        }
      })
    )
    this.initialized = true
  }

  confidence(): number { return 1.0 }

  async mine(filepath: string, content: string): Promise<MinerResult> {
    if (!this.initialized) throw new Error('Call initialize() before mine()')

    const ext = '.' + (filepath.split('.').pop()?.toLowerCase() ?? '')
    const lang = EXT_TO_LANG[ext]
    const parser = lang ? this.parsers.get(lang) : undefined

    if (!parser) {
      return { nodes: [], confidence: 0, source: 'ambiguous' }
    }

    const posixPath = filepath.replace(/\\/g, '/')
    const tree = parser.parse(content)
    const nodes = this.extractNodes(tree.rootNode, posixPath)

    return { nodes, confidence: 1.0, source: 'extracted' }
  }

  private extractNodes(root: Parser.SyntaxNode, filepath: string): ASTNode[] {
    const nodes: ASTNode[] = []
    this.walk(root, nodes, filepath)
    return nodes
  }

  private walk(node: Parser.SyntaxNode, out: ASTNode[], filepath: string): void {
    if (EXTRACTABLE_TYPES.has(node.type)) {
      out.push(this.toASTNode(node, filepath))
    }
    for (const child of node.children) {
      this.walk(child, out, filepath)
    }
  }

  private toASTNode(node: Parser.SyntaxNode, filepath: string): ASTNode {
    const name = this.extractName(node)
    return {
      id: `${filepath}::${name}::${node.startPosition.row + 1}`,
      type: TYPE_MAP[node.type] ?? 'variable',
      name,
      path: filepath,
      lines: [node.startPosition.row + 1, node.endPosition.row + 1],
      confidence: 1.0,
      source: 'extracted',
    }
  }

  private extractName(node: Parser.SyntaxNode): string {
    const nameNode =
      node.childForFieldName('name') ??
      node.childForFieldName('identifier') ??
      node.children.find(c => c.type === 'identifier')
    return nameNode?.text ?? node.text.split('\n')[0].trim().slice(0, 60)
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run src/miners/ast/__tests__/treesitter.test.ts
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/miners/ast/treesitter.ts src/miners/ast/__tests__/treesitter.test.ts
git commit -m "feat: tree-sitter WASM AST miner for Python, Go, Rust, Java, Ruby, PHP, C, C++"
```

---

## Task 5: Oxc Miner for JavaScript and TypeScript

**Files:**
- Create: `src/miners/ast/oxc.ts`
- Create: `src/miners/ast/__tests__/oxc.test.ts`

- [ ] **Step 1: Install oxc-parser**

```bash
npm install oxc-parser
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/miners/ast/__tests__/oxc.test.ts
import { describe, it, expect } from 'vitest'
import { OxcMiner } from '../oxc'

describe('OxcMiner', () => {
  const miner = new OxcMiner()

  it('extracts functions from TypeScript', async () => {
    const content = `
export function validateToken(token: string): boolean {
  return token.length > 0
}

export async function fetchUser(id: number): Promise<unknown> {
  return { id }
}
`
    const result = await miner.mine('src/auth.ts', content)
    expect(result.confidence).toBe(1.0)
    expect(result.source).toBe('extracted')
    const names = result.nodes.map(n => n.name)
    expect(names).toContain('validateToken')
    expect(names).toContain('fetchUser')
  })

  it('extracts classes from TypeScript', async () => {
    const content = `
export class UserService {
  constructor(private id: number) {}
  getId(): number { return this.id }
}
`
    const result = await miner.mine('src/user.service.ts', content)
    expect(result.nodes.map(n => n.name)).toContain('UserService')
  })

  it('extracts interfaces from TypeScript', async () => {
    const content = `
export interface User {
  id: number
  email: string
}

export interface Database {
  find(id: number): Promise<unknown>
}
`
    const result = await miner.mine('src/types.ts', content)
    const names = result.nodes.map(n => n.name)
    expect(names).toContain('User')
    expect(names).toContain('Database')
  })

  it('extracts arrow functions assigned to const', async () => {
    const content = `
const handleRequest = async (req: unknown): Promise<string> => {
  return 'ok'
}

export { handleRequest }
`
    const result = await miner.mine('src/handler.ts', content)
    expect(result.nodes.map(n => n.name)).toContain('handleRequest')
  })

  it('handles JavaScript files (.js)', async () => {
    const content = `function greet(name) { return 'Hello ' + name }`
    const result = await miner.mine('src/greet.js', content)
    expect(result.nodes.map(n => n.name)).toContain('greet')
  })

  it('handles malformed TypeScript without throwing', async () => {
    await expect(miner.mine('broken.ts', 'export function broken(')).resolves.toBeDefined()
  })

  it('returns ambiguous for non-JS/TS extensions', async () => {
    const result = await miner.mine('data.py', 'def hello(): pass')
    expect(result.source).toBe('ambiguous')
  })

  it('uses POSIX paths in node IDs (no backslashes)', async () => {
    const result = await miner.mine('src/auth/token.ts', 'export function validate() {}')
    if (result.nodes.length > 0) {
      expect(result.nodes[0].id).not.toContain('\\')
    }
  })
})
```

- [ ] **Step 3: Run to verify it fails**

```bash
npx vitest run src/miners/ast/__tests__/oxc.test.ts
```

Expected: FAIL — `OxcMiner` not found.

- [ ] **Step 4: Create `src/miners/ast/oxc.ts`**

```typescript
import { parseSync } from 'oxc-parser'
import type { ASTNode, EngramMiner, MinerResult, NodeType } from '../types'

const JS_TS_EXTENSIONS = new Set([
  '.ts', '.tsx', '.mts', '.cts',
  '.js', '.jsx', '.mjs', '.cjs',
])

type OxcNode = Record<string, unknown>

export class OxcMiner implements EngramMiner {
  name = 'oxc'
  version = '1.0.0'
  languages = [...JS_TS_EXTENSIONS]

  confidence(): number { return 1.0 }

  async mine(filepath: string, content: string): Promise<MinerResult> {
    const ext = '.' + (filepath.split('.').pop()?.toLowerCase() ?? '')
    if (!JS_TS_EXTENSIONS.has(ext)) {
      return { nodes: [], confidence: 0, source: 'ambiguous' }
    }

    const posixPath = filepath.replace(/\\/g, '/')

    let result: ReturnType<typeof parseSync>
    try {
      result = parseSync(filepath, content, { sourceType: 'module' })
    } catch {
      return { nodes: [], confidence: 0.3, source: 'ambiguous' }
    }

    const nodes: ASTNode[] = []
    for (const stmt of result.program.body as OxcNode[]) {
      this.extractStatement(stmt, nodes, posixPath, content)
    }

    return { nodes, confidence: 1.0, source: 'extracted' }
  }

  private extractStatement(node: OxcNode, out: ASTNode[], filepath: string, src: string): void {
    switch (node.type) {
      case 'FunctionDeclaration':
      case 'FunctionExpression': {
        const id = node.id as OxcNode | null
        if (id?.name) out.push(this.makeNode(filepath, String(id.name), 'function', node, src))
        break
      }
      case 'ClassDeclaration':
      case 'ClassExpression': {
        const id = node.id as OxcNode | null
        if (id?.name) out.push(this.makeNode(filepath, String(id.name), 'class', node, src))
        break
      }
      case 'TSInterfaceDeclaration': {
        const id = node.id as OxcNode
        if (id?.name) out.push(this.makeNode(filepath, String(id.name), 'interface', node, src))
        break
      }
      case 'VariableDeclaration': {
        for (const decl of (node.declarations as OxcNode[])) {
          const init = decl.init as OxcNode | null
          if (init?.type === 'ArrowFunctionExpression' || init?.type === 'FunctionExpression') {
            const id = decl.id as OxcNode
            if (id?.name) out.push(this.makeNode(filepath, String(id.name), 'function', decl, src))
          }
        }
        break
      }
      case 'ExportNamedDeclaration':
      case 'ExportDefaultDeclaration': {
        const decl = node.declaration as OxcNode | null
        if (decl) this.extractStatement(decl, out, filepath, src)
        break
      }
      case 'ImportDeclaration': {
        const srcVal = (node.source as OxcNode).value
        out.push({
          id: `${filepath}::import::${srcVal}`,
          type: 'module',
          name: String(srcVal),
          path: filepath,
          lines: this.getLines(node, src),
          confidence: 1.0,
          source: 'extracted',
        })
        break
      }
    }
  }

  private makeNode(filepath: string, name: string, type: NodeType, node: OxcNode, src: string): ASTNode {
    const lines = this.getLines(node, src)
    return { id: `${filepath}::${name}::${lines[0]}`, type, name, path: filepath, lines, confidence: 1.0, source: 'extracted' }
  }

  private getLines(node: OxcNode, src: string): [number, number] {
    const span = node.span as { start: number; end: number } | undefined
    if (!span) return [1, 1]
    const before = src.slice(0, span.start)
    const startLine = (before.match(/\n/g) ?? []).length + 1
    const snippet = src.slice(span.start, span.end)
    const endLine = startLine + (snippet.match(/\n/g) ?? []).length
    return [startLine, endLine]
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run src/miners/ast/__tests__/oxc.test.ts
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/miners/ast/oxc.ts src/miners/ast/__tests__/oxc.test.ts
git commit -m "feat: oxc NAPI miner for JavaScript and TypeScript (10-50x faster for JS/TS)"
```

---

## Task 6: Route AST Miner by Extension

**Files:**
- Modify: `src/miners/ast/index.ts`
- Create: `src/miners/ast/__tests__/router.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/miners/ast/__tests__/router.test.ts
import { describe, it, expect } from 'vitest'
import { mineFile } from '../index'

describe('mineFile router', () => {
  it('routes .ts files to oxc (confidence 1.0, source extracted)', async () => {
    const result = await mineFile('src/auth.ts', 'export function validate(): boolean { return true }')
    expect(result.confidence).toBe(1.0)
    expect(result.source).toBe('extracted')
  })

  it('routes .js files to oxc', async () => {
    const result = await mineFile('utils.js', 'function help() { return 1 }')
    expect(result.confidence).toBe(1.0)
  })

  it('routes .py files to tree-sitter', async () => {
    const result = await mineFile('app.py', 'def run(): pass')
    expect(result.confidence).toBe(1.0)
    expect(result.source).toBe('extracted')
  })

  it('routes .go files to tree-sitter', async () => {
    const result = await mineFile('main.go', 'package main\nfunc main() {}')
    expect(result.confidence).toBe(1.0)
  })

  it('returns ambiguous for unknown extensions', async () => {
    const result = await mineFile('data.xyz', 'random content')
    expect(result.source).toBe('ambiguous')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/miners/ast/__tests__/router.test.ts
```

Expected: FAIL — `mineFile` not found or wrong signature.

- [ ] **Step 3: Update `src/miners/ast/index.ts`**

```typescript
import { OxcMiner } from './oxc'
import { TreeSitterMiner } from './treesitter'
import type { MinerResult } from '../types'
import { join } from 'path'

const GRAMMARS_DIR = join(__dirname, 'grammars')

const oxc = new OxcMiner()

let _treeSitter: TreeSitterMiner | null = null
let _treeSitterReady: Promise<void> | null = null

function getTreeSitter(): Promise<TreeSitterMiner> {
  if (!_treeSitterReady) {
    const miner = new TreeSitterMiner()
    _treeSitter = miner
    _treeSitterReady = miner.initialize(GRAMMARS_DIR)
  }
  return _treeSitterReady.then(() => _treeSitter!)
}

const OXC_EXTENSIONS = new Set([
  '.ts', '.tsx', '.mts', '.cts',
  '.js', '.jsx', '.mjs', '.cjs',
])

export async function mineFile(filepath: string, content: string): Promise<MinerResult> {
  const ext = '.' + (filepath.split('.').pop()?.toLowerCase() ?? '')
  if (OXC_EXTENSIONS.has(ext)) {
    return oxc.mine(filepath, content)
  }
  const ts = await getTreeSitter()
  return ts.mine(filepath, content)
}

export { OxcMiner, TreeSitterMiner }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/miners/ast/__tests__/router.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run
```

Expected: All 486+ tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/miners/ast/index.ts src/miners/ast/__tests__/router.test.ts
git commit -m "feat: route JS/TS to oxc miner, all other languages to tree-sitter miner"
```

---

## Task 7: LanceDB Vector Store

**Files:**
- Create: `src/vector/store.ts`
- Create: `src/vector/index.ts`
- Create: `src/vector/__tests__/store.test.ts`

- [ ] **Step 1: Install LanceDB**

```bash
npm install vectordb
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/vector/__tests__/store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { VectorStore } from '../store'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const DIM = 384
const makeEmbedding = (seed: number): number[] =>
  Array.from({ length: DIM }, (_, i) => Math.sin(seed + i * 0.01))

describe('VectorStore', () => {
  let store: VectorStore
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'engram-vector-test-'))
    store = new VectorStore()
    await store.initialize(tempDir)
  }, 15_000)

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('upserts and retrieves a record by vector similarity', async () => {
    const embedding = makeEmbedding(1)
    await store.upsert([{ nodeId: 'src/auth.ts::validateToken::10', embedding, path: 'src/auth.ts', summary: 'Validates JWT tokens' }])
    const results = await store.search(embedding, 1)
    expect(results).toHaveLength(1)
    expect(results[0].nodeId).toBe('src/auth.ts::validateToken::10')
  })

  it('returns empty array for empty store', async () => {
    const results = await store.search(makeEmbedding(42), 5)
    expect(results).toHaveLength(0)
  })

  it('returns at most k results', async () => {
    await store.upsert([
      { nodeId: 'a::fn::1', embedding: makeEmbedding(1), path: 'a.ts', summary: 'A' },
      { nodeId: 'b::fn::1', embedding: makeEmbedding(2), path: 'b.ts', summary: 'B' },
      { nodeId: 'c::fn::1', embedding: makeEmbedding(3), path: 'c.ts', summary: 'C' },
    ])
    const results = await store.search(makeEmbedding(1), 2)
    expect(results.length).toBeLessThanOrEqual(2)
  })

  it('deletes records by path', async () => {
    await store.upsert([
      { nodeId: 'src/auth.ts::fn::1', embedding: makeEmbedding(1), path: 'src/auth.ts', summary: 'Auth' },
      { nodeId: 'src/user.ts::fn::1', embedding: makeEmbedding(2), path: 'src/user.ts', summary: 'User' },
    ])
    await store.deleteByPath('src/auth.ts')
    const results = await store.search(makeEmbedding(1), 10)
    expect(results.every(r => r.path !== 'src/auth.ts')).toBe(true)
  })

  it('persists data across VectorStore instances', async () => {
    const embedding = makeEmbedding(99)
    await store.upsert([{ nodeId: 'persist::fn::1', embedding, path: 'persist.ts', summary: 'Persisted' }])

    const store2 = new VectorStore()
    await store2.initialize(tempDir)
    const results = await store2.search(embedding, 1)
    expect(results[0].nodeId).toBe('persist::fn::1')
  })

  it('count() returns number of stored records', async () => {
    expect(await store.count()).toBe(0)
    await store.upsert([{ nodeId: 'x::fn::1', embedding: makeEmbedding(1), path: 'x.ts', summary: 'X' }])
    expect(await store.count()).toBe(1)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

```bash
npx vitest run src/vector/__tests__/store.test.ts
```

Expected: FAIL — `VectorStore` not found.

- [ ] **Step 4: Create `src/vector/store.ts`**

```typescript
import * as lancedb from 'vectordb'
import { join } from 'path'

export interface VectorRecord {
  nodeId: string
  embedding: number[]
  path: string
  summary: string
}

export class VectorStore {
  private db: lancedb.Connection | null = null
  private table: lancedb.Table<VectorRecord> | null = null

  async initialize(engram_dir: string): Promise<void> {
    this.db = await lancedb.connect(join(engram_dir, 'vectors'))
    const tables = await this.db.tableNames()

    if (tables.includes('nodes')) {
      this.table = await this.db.openTable('nodes') as lancedb.Table<VectorRecord>
    } else {
      // Establish schema via a sentinel row, then delete it immediately
      this.table = await this.db.createTable('nodes', [
        { nodeId: '__schema_init__', embedding: new Array(384).fill(0), path: '', summary: '' }
      ]) as lancedb.Table<VectorRecord>
      await this.table.delete('nodeId = "__schema_init__"')
    }
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    if (!this.table) throw new Error('VectorStore not initialized — call initialize() first')
    if (records.length === 0) return

    // Upsert semantics: delete existing records for affected paths, then insert fresh
    const paths = [...new Set(records.map(r => r.path))]
    for (const p of paths) {
      await this.table.delete(`path = "${p.replace(/\\/g, '/').replace(/"/g, '\\"')}"`)
    }
    await this.table.add(records)
  }

  async search(embedding: number[], k = 10): Promise<VectorRecord[]> {
    if (!this.table) throw new Error('VectorStore not initialized — call initialize() first')
    const total = await this.table.countRows()
    if (total === 0) return []
    return this.table.search(embedding).limit(Math.min(k, total)).execute() as Promise<VectorRecord[]>
  }

  async deleteByPath(path: string): Promise<void> {
    if (!this.table) throw new Error('VectorStore not initialized — call initialize() first')
    await this.table.delete(`path = "${path.replace(/\\/g, '/').replace(/"/g, '\\"')}"`)
  }

  async count(): Promise<number> {
    if (!this.table) return 0
    return this.table.countRows()
  }
}
```

- [ ] **Step 5: Create `src/vector/index.ts`**

```typescript
export { VectorStore } from './store'
export type { VectorRecord } from './store'
```

- [ ] **Step 6: Run test to verify it passes**

```bash
npx vitest run src/vector/__tests__/store.test.ts
```

Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/vector/
git commit -m "feat: LanceDB vector store for semantic search (local-first, zero infra)"
```

---

## Task 8: Local Embedding Pipeline

**Files:**
- Create: `src/embeddings/pipeline.ts`
- Create: `src/embeddings/index.ts`
- Create: `src/embeddings/__tests__/pipeline.test.ts`

- [ ] **Step 1: Install @xenova/transformers**

```bash
npm install @xenova/transformers
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/embeddings/__tests__/pipeline.test.ts
import { describe, it, expect } from 'vitest'
import { embed, embedBatch } from '../pipeline'

// First run downloads ~25MB model — allow up to 2 minutes
const TIMEOUT = 120_000

describe('embedding pipeline', () => {
  it('returns a 384-dimensional normalized embedding', async () => {
    const result = await embed('function validateToken checks JWT signature')
    expect(result).toHaveLength(384)
    expect(result.every(n => typeof n === 'number')).toBe(true)
    const norm = Math.sqrt(result.reduce((sum, v) => sum + v * v, 0))
    expect(norm).toBeCloseTo(1.0, 1)
  }, TIMEOUT)

  it('returns different embeddings for unrelated topics', async () => {
    const [authEmbed, dbEmbed] = await embedBatch([
      'JWT token validation and authentication',
      'database connection pool management',
    ])
    const dotProduct = authEmbed.reduce((sum, v, i) => sum + v * dbEmbed[i], 0)
    expect(dotProduct).toBeLessThan(0.95)
  }, TIMEOUT)

  it('returns similar embeddings for semantically related strings', async () => {
    const [a, b] = await embedBatch([
      'authenticate user with password',
      'user login with credentials',
    ])
    const similarity = a.reduce((sum, v, i) => sum + v * b[i], 0)
    expect(similarity).toBeGreaterThan(0.7)
  }, TIMEOUT)

  it('handles empty string without throwing', async () => {
    const result = await embed('')
    expect(result).toHaveLength(384)
  }, TIMEOUT)

  it('embedBatch single item matches embed', async () => {
    const single = await embed('test function')
    const batch = await embedBatch(['test function'])
    expect(batch[0].length).toBe(single.length)
    // Values should be identical
    batch[0].forEach((v, i) => expect(v).toBeCloseTo(single[i], 5))
  }, TIMEOUT)
})
```

- [ ] **Step 3: Run to verify it fails**

```bash
npx vitest run src/embeddings/__tests__/pipeline.test.ts
```

Expected: FAIL — `embed` not found.

- [ ] **Step 4: Create `src/embeddings/pipeline.ts`**

```typescript
import { pipeline, env } from '@xenova/transformers'
import { join } from 'path'

// Persist model in .engram/models/ so it's downloaded once
const ENGRAM_DIR = process.env.ENGRAM_DIR ?? join(process.cwd(), '.engram')
env.cacheDir = join(ENGRAM_DIR, 'models')
env.allowLocalModels = true

// all-MiniLM-L6-v2: 384 dimensions, ~25MB quantized, fast on CPU
const MODEL_ID = 'Xenova/all-MiniLM-L6-v2'

type FeaturePipeline = Awaited<ReturnType<typeof pipeline<'feature-extraction'>>>

let _pipe: FeaturePipeline | null = null
let _init: Promise<FeaturePipeline> | null = null

async function getPipeline(): Promise<FeaturePipeline> {
  if (_pipe) return _pipe
  if (!_init) {
    _init = pipeline('feature-extraction', MODEL_ID, { quantized: true })
      .then(p => { _pipe = p; return p })
  }
  return _init
}

export async function embed(text: string): Promise<number[]> {
  const pipe = await getPipeline()
  const out = await pipe(text || ' ', { pooling: 'mean', normalize: true })
  return Array.from(out.data as Float32Array)
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  const pipe = await getPipeline()
  const results = await Promise.all(
    texts.map(t => pipe(t || ' ', { pooling: 'mean', normalize: true }))
  )
  return results.map(r => Array.from(r.data as Float32Array))
}
```

- [ ] **Step 5: Create `src/embeddings/index.ts`**

```typescript
export { embed, embedBatch } from './pipeline'
```

- [ ] **Step 6: Run test to verify it passes**

```bash
npx vitest run src/embeddings/__tests__/pipeline.test.ts
```

Expected: All tests PASS. (First run downloads 25MB model — normal, takes up to 60s.)

- [ ] **Step 7: Commit**

```bash
git add src/embeddings/
git commit -m "feat: local embedding pipeline via transformers.js (all-MiniLM-L6-v2, no API calls)"
```

---

## Task 9: Hybrid Search

**Files:**
- Create: `src/query/hybrid.ts`
- Create: `src/query/__tests__/hybrid.test.ts`
- Modify: `src/query/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/query/__tests__/hybrid.test.ts
import { describe, it, expect, vi } from 'vitest'
import { hybridSearch } from '../hybrid'
import Graph from 'graphology'

vi.mock('../../embeddings/pipeline', () => ({
  embed: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
}))

function buildGraph(): Graph {
  const g = new Graph()
  g.addNode('src/auth.ts::validateToken::10', { name: 'validateToken', type: 'function', path: 'src/auth.ts', summary: 'Validates JWT tokens' })
  g.addNode('src/user.ts::getUser::5',        { name: 'getUser',       type: 'function', path: 'src/user.ts', summary: 'Fetches a user from database' })
  g.addNode('src/db.ts::connect::1',          { name: 'connect',       type: 'function', path: 'src/db.ts',  summary: 'Opens database connection' })
  return g
}

function mockStore(records: Array<{ nodeId: string; path: string; summary: string }>) {
  return {
    search: vi.fn().mockResolvedValue(records.map(r => ({ ...r, embedding: [] }))),
  }
}

describe('hybridSearch', () => {
  it('finds graph nodes matching a known symbol name', async () => {
    const results = await hybridSearch('validateToken', buildGraph(), mockStore([]) as any, 5)
    expect(results.some(r => r.nodeId === 'src/auth.ts::validateToken::10')).toBe(true)
  })

  it('includes vector results', async () => {
    const store = mockStore([{ nodeId: 'src/auth.ts::validateToken::10', path: 'src/auth.ts', summary: 'Auth' }])
    const results = await hybridSearch('authentication', buildGraph(), store as any, 5)
    expect(results.length).toBeGreaterThan(0)
  })

  it('deduplicates results from both sources (no duplicate nodeIds)', async () => {
    const store = mockStore([{ nodeId: 'src/auth.ts::validateToken::10', path: 'src/auth.ts', summary: 'Auth' }])
    const results = await hybridSearch('validateToken', buildGraph(), store as any, 10)
    const ids = results.map(r => r.nodeId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('marks results from both sources as "hybrid"', async () => {
    const store = mockStore([{ nodeId: 'src/auth.ts::validateToken::10', path: 'src/auth.ts', summary: 'Auth' }])
    const results = await hybridSearch('validateToken', buildGraph(), store as any, 10)
    const match = results.find(r => r.nodeId === 'src/auth.ts::validateToken::10')
    expect(match?.source).toBe('hybrid')
  })

  it('respects the k limit', async () => {
    const store = mockStore([
      { nodeId: 'src/auth.ts::validateToken::10', path: 'src/auth.ts', summary: 'Auth' },
      { nodeId: 'src/user.ts::getUser::5',        path: 'src/user.ts', summary: 'User' },
    ])
    const results = await hybridSearch('query', buildGraph(), store as any, 2)
    expect(results.length).toBeLessThanOrEqual(2)
  })

  it('returns results sorted by score descending', async () => {
    const results = await hybridSearch('validateToken', buildGraph(), mockStore([]) as any, 5)
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
    }
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/query/__tests__/hybrid.test.ts
```

Expected: FAIL — `hybridSearch` not found.

- [ ] **Step 3: Create `src/query/hybrid.ts`**

```typescript
import Graph from 'graphology'
import { embed } from '../embeddings/pipeline'
import type { VectorStore, VectorRecord } from '../vector/store'

export type HybridSource = 'graph' | 'vector' | 'hybrid'

export interface HybridResult {
  nodeId: string
  score: number
  source: HybridSource
  summary?: string
  path?: string
}

export async function hybridSearch(
  query: string,
  graph: Graph,
  vectorStore: VectorStore,
  k = 10
): Promise<HybridResult[]> {
  const [graphResults, vectorResults] = await Promise.all([
    Promise.resolve(searchGraph(query, graph, k)),
    searchVector(query, vectorStore, k),
  ])
  return mergeAndRank(graphResults, vectorResults, k)
}

function searchGraph(query: string, graph: Graph, k: number): HybridResult[] {
  const q = query.toLowerCase()
  const results: HybridResult[] = []

  graph.forEachNode((nodeId, attrs) => {
    const name    = String(attrs.name    ?? '').toLowerCase()
    const summary = String(attrs.summary ?? '').toLowerCase()

    let score = 0
    if (name === q)             score = 1.0
    else if (name.includes(q)) score = 0.8
    else if (summary.includes(q)) score = 0.4

    if (score > 0) {
      results.push({ nodeId, score, source: 'graph', summary: attrs.summary as string, path: attrs.path as string })
    }
  })

  return results.sort((a, b) => b.score - a.score).slice(0, k)
}

async function searchVector(query: string, store: VectorStore, k: number): Promise<HybridResult[]> {
  const embedding = await embed(query)
  const records: VectorRecord[] = await store.search(embedding, k)
  return records.map((r, i) => ({
    nodeId:  r.nodeId,
    score:   1 - i / (k + 1),
    source:  'vector' as const,
    summary: r.summary,
    path:    r.path,
  }))
}

function mergeAndRank(graph: HybridResult[], vector: HybridResult[], k: number): HybridResult[] {
  const merged = new Map<string, HybridResult>()

  for (const r of graph) merged.set(r.nodeId, r)

  for (const r of vector) {
    const existing = merged.get(r.nodeId)
    if (existing) {
      merged.set(r.nodeId, { ...existing, score: (existing.score + r.score) / 2, source: 'hybrid' })
    } else {
      merged.set(r.nodeId, r)
    }
  }

  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, k)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/query/__tests__/hybrid.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Export from `src/query/index.ts`**

Add to existing exports (do not remove anything already there):
```typescript
export { hybridSearch } from './hybrid'
export type { HybridResult, HybridSource } from './hybrid'
```

- [ ] **Step 6: Run full suite**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/query/hybrid.ts src/query/__tests__/hybrid.test.ts src/query/index.ts
git commit -m "feat: hybrid search — graph traversal + vector similarity, merged and ranked"
```

---

## Task 10: Wire Miners into Unified indexFile Pipeline

**Files:**
- Modify: `src/miners/index.ts`
- Create: `src/miners/__tests__/pipeline.integration.test.ts`

- [ ] **Step 1: Write the integration test**

```typescript
// src/miners/__tests__/pipeline.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { indexFile } from '../index'
import { VectorStore } from '../../vector/store'
import Graph from 'graphology'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const TIMEOUT = 120_000

describe('indexFile integration', () => {
  let tempDir: string
  let vectorStore: VectorStore
  let graph: Graph

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'engram-pipeline-'))
    vectorStore = new VectorStore()
    await vectorStore.initialize(tempDir)
    graph = new Graph()
  }, TIMEOUT)

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('adds nodes to graph after indexing a TypeScript file', async () => {
    const content = `
export function hashPassword(password: string): string {
  return password + '_hashed'
}
export function comparePassword(plain: string, hash: string): boolean {
  return hashPassword(plain) === hash
}
`
    await indexFile('src/crypto.ts', content, graph, vectorStore)
    const nodeNames = graph.nodes().map(n => graph.getNodeAttribute(n, 'name') as string)
    expect(nodeNames).toContain('hashPassword')
    expect(nodeNames).toContain('comparePassword')
  }, TIMEOUT)

  it('adds records to vector store after indexing', async () => {
    const before = await vectorStore.count()
    await indexFile('src/sample.ts', 'export function sample(): void {}', graph, vectorStore)
    const after = await vectorStore.count()
    expect(after).toBeGreaterThan(before)
  }, TIMEOUT)

  it('replaces stale nodes when a file is re-indexed', async () => {
    await indexFile('src/changing.ts', 'export function original(): void {}', graph, vectorStore)
    await indexFile('src/changing.ts', 'export function updated(): void {}', graph, vectorStore)
    const nodesForFile = graph.nodes().filter(n => graph.getNodeAttribute(n, 'path') === 'src/changing.ts')
    const names = nodesForFile.map(n => graph.getNodeAttribute(n, 'name') as string)
    expect(names).toContain('updated')
    expect(names).not.toContain('original')
  }, TIMEOUT)
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/miners/__tests__/pipeline.integration.test.ts
```

Expected: FAIL — `indexFile` with this signature not found.

- [ ] **Step 3: Add `indexFile` to `src/miners/index.ts`**

Add this function (preserve all existing exports):

```typescript
import { mineFile } from './ast'
import { embedBatch } from '../embeddings/pipeline'
import type { VectorStore } from '../vector/store'
import type Graph from 'graphology'

/**
 * Index a single file: mine AST nodes, embed summaries,
 * update the graph and vector store. Upsert semantics — safe to call repeatedly.
 */
export async function indexFile(
  filepath: string,
  content: string,
  graph: Graph,
  vectorStore: VectorStore
): Promise<void> {
  const mined = await mineFile(filepath, content)
  if (mined.nodes.length === 0) return

  const posixPath = filepath.replace(/\\/g, '/')

  // Remove stale graph nodes for this path
  const stale = graph.nodes().filter(n => graph.getNodeAttribute(n, 'path') === posixPath)
  for (const n of stale) graph.dropNode(n)

  // Embed all summaries in one batch call
  const summaries = mined.nodes.map(n =>
    `${n.type} ${n.name} in ${posixPath}`
  )
  const embeddings = await embedBatch(summaries)

  // Add nodes to graph
  for (let i = 0; i < mined.nodes.length; i++) {
    const node = mined.nodes[i]
    if (!graph.hasNode(node.id)) {
      graph.addNode(node.id, {
        name:       node.name,
        type:       node.type,
        path:       node.path,
        lines:      node.lines,
        confidence: node.confidence,
        source:     node.source,
        summary:    summaries[i],
      })
    }
  }

  // Add edges
  for (const node of mined.nodes) {
    for (const edge of node.edges ?? []) {
      if (graph.hasNode(edge.to) && !graph.hasEdge(node.id, edge.to)) {
        graph.addEdge(node.id, edge.to, { relation: edge.relation })
      }
    }
  }

  // Upsert into vector store
  await vectorStore.upsert(
    mined.nodes.map((node, i) => ({
      nodeId:    node.id,
      embedding: embeddings[i],
      path:      node.path,
      summary:   summaries[i],
    }))
  )
}
```

- [ ] **Step 4: Run integration test**

```bash
npx vitest run src/miners/__tests__/pipeline.integration.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/miners/index.ts src/miners/__tests__/pipeline.integration.test.ts
git commit -m "feat: unified indexFile pipeline — AST mine + embed + graph + vector store"
```

---

## Task 11: Benchmark Harness

**Files:**
- Create: `bench/harness.ts`
- Create: `bench/METHODOLOGY.md`
- Create: `bench/__tests__/harness.test.ts`
- Modify: `package.json`, `.gitignore`

- [ ] **Step 1: Write the failing test**

```typescript
// bench/__tests__/harness.test.ts
import { describe, it, expect } from 'vitest'
import { countTokens, type BenchmarkResult } from '../harness'

describe('benchmark harness', () => {
  it('countTokens returns positive number for non-empty strings', () => {
    const count = countTokens('export function validateToken(): boolean { return true }')
    expect(count).toBeGreaterThan(0)
  })

  it('countTokens returns 0 for empty string', () => {
    expect(countTokens('')).toBe(0)
  })

  it('longer strings have more tokens than shorter strings', () => {
    const short = countTokens('function a() {}')
    const long  = countTokens('function a() { return true } function b() { return false }')
    expect(long).toBeGreaterThan(short)
  })

  it('BenchmarkResult type is structurally valid', () => {
    const result: BenchmarkResult = {
      fixture:         'small',
      baseline_tokens: 600_000,
      engram_tokens:   108_000,
      reduction_pct:   82,
      files_processed: 800,
      duration_ms:     4200,
      timestamp:       new Date().toISOString(),
    }
    expect(result.reduction_pct).toBe(82)
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}/)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run bench/__tests__/harness.test.ts
```

Expected: FAIL — `bench/harness.ts` not found.

- [ ] **Step 3: Create `bench/harness.ts`**

```typescript
import { readdir, readFile } from 'fs/promises'
import { join, extname, relative } from 'path'

export interface BenchmarkResult {
  fixture:         string
  baseline_tokens: number   // tokens if agent reads all files in full
  engram_tokens:   number   // tokens served by engram summaries
  reduction_pct:   number   // (1 - engram / baseline) * 100
  files_processed: number
  duration_ms:     number
  timestamp:       string
}

// 4 chars ≈ 1 token — conservative approximation for code (OpenAI/Anthropic tokenizers)
export function countTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs',
  '.py', '.go', '.rs', '.java', '.rb',
  '.c', '.cpp', '.h', '.hpp',
  '.md', '.json', '.yaml', '.yml',
])

const SKIP_DIRS = new Set(['node_modules', '.git', '.engram', 'dist', 'build'])

export async function gatherFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  await walk(dir, files)
  return files
}

async function walk(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
      await walk(full, out)
    } else if (!entry.isDirectory() && TEXT_EXTENSIONS.has(extname(entry.name))) {
      out.push(full)
    }
  }
}

export async function measureBaselineTokens(files: string[]): Promise<number> {
  let total = 0
  for (const file of files) {
    try {
      const content = await readFile(file, 'utf-8')
      total += countTokens(content)
    } catch {
      // skip unreadable files
    }
  }
  return total
}

export async function runBenchmark(
  fixtureDir: string,
  fixtureName: string,
  getSummaryTokenCount: (relPath: string) => number
): Promise<BenchmarkResult> {
  const start = Date.now()
  const files = await gatherFiles(fixtureDir)

  const baseline = await measureBaselineTokens(files)

  let engram = 0
  for (const file of files) {
    engram += getSummaryTokenCount(relative(fixtureDir, file))
  }

  const duration_ms  = Date.now() - start
  const reduction_pct = Math.round((1 - engram / Math.max(baseline, 1)) * 100)

  return {
    fixture:         fixtureName,
    baseline_tokens: baseline,
    engram_tokens:   engram,
    reduction_pct,
    files_processed: files.length,
    duration_ms,
    timestamp:       new Date().toISOString(),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run bench/__tests__/harness.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Create `bench/METHODOLOGY.md`**

```markdown
# Engram Benchmark Methodology

## What We Measure

**Baseline A — Full files:** Total tokens consumed if an AI agent reads every text file
in the fixture repo before answering. Measured as `sum(ceil(fileLength / 4))` across
all text files (4 chars ≈ 1 token per OpenAI/Anthropic tokenizer approximation).

**Engram B — Summaries:** Total tokens served by engram hook summaries across the same
file set. Each ECPResponse summary is capped at 300 tokens. For the benchmark, we use
300 tokens per indexed node as a conservative upper bound.

**Reduction:** `(1 − B/A) × 100%`

## Fixture Repos (Pinned Commits)

| Size   | Repo                                | Commit   | ~Files | ~Tokens |
|--------|-------------------------------------|----------|--------|---------|
| Small  | fastify/fastify                     | see COMMITS.md | ~800 | ~600k |
| Medium | microsoft/vscode-extension-samples  | see COMMITS.md | ~3k  | ~2.5M |
| Large  | microsoft/TypeScript (src/ only)    | see COMMITS.md | ~50k | ~40M  |

## Reproducing Results

```bash
git clone https://github.com/NickCirv/engram
cd engram
npm install
npm run download-grammars
npm run bench -- --fixture small
```

Output written to `bench/results/YYYY-MM-DD-small.json`.

Any developer running this on the same fixture commit should see results within ±5%.
Variance beyond ±10% is a bug — please open an issue.

## Limitations

- Token counting uses 4 chars/token approximation, not exact tokenizer
- Assumes agent reads all files; real sessions are selective (results are conservative)
- Fixture repos are public — results on private codebases may vary
- Engram summary quality depends on AST confidence; this benchmark requires ≥0.95
```

- [ ] **Step 6: Update `package.json` and `.gitignore`**

Add to `package.json` scripts:
```json
"bench": "tsx bench/run.ts"
```

Add to `.gitignore`:
```
bench/results/
bench/fixtures/small/
bench/fixtures/medium/
bench/fixtures/large/
```

- [ ] **Step 7: Commit**

```bash
git add bench/ package.json .gitignore
git commit -m "feat: reproducible benchmark harness with published methodology"
```

---

## Phase 0 Final Verification

- [ ] **Run full test suite**

```bash
npx vitest run
```

Expected: All tests pass, zero failures.

- [ ] **Run Biome**

```bash
npx @biomejs/biome check .
```

Expected: Zero errors.

- [ ] **End-to-end smoke test**

```bash
npx tsx -e "
import { indexFile } from './src/miners/index.ts'
import { VectorStore } from './src/vector/index.ts'
import { hybridSearch } from './src/query/hybrid.ts'
import Graph from 'graphology'
import { mkdirSync } from 'fs'

mkdirSync('.engram', { recursive: true })
const graph = new Graph()
const store = new VectorStore()
await store.initialize('.engram')

await indexFile('src/auth.ts', 'export function validateToken(token: string): boolean { return token.length > 10 }', graph, store)

const results = await hybridSearch('token validation', graph, store, 5)
console.log('Results:', JSON.stringify(results, null, 2))
if (!results.some(r => r.nodeId.includes('validateToken'))) {
  throw new Error('validateToken not found in results')
}
console.log('Smoke test PASSED')
"
```

Expected: `Smoke test PASSED` with results array containing `validateToken`.

- [ ] **Tag v1.0.0**

```bash
git tag -a v1.0.0 -m "v1.0.0: Foundation hardening — tree-sitter AST, LanceDB vector search, hybrid query, reproducible benchmarks"
```

---

## Phase 0 Milestones

- [ ] All JS/TS files route to oxc miner (confidence = 1.0, source = extracted)
- [ ] All Python/Go/Rust/Java/Ruby/PHP/C/C++ files route to tree-sitter (confidence = 1.0)
- [ ] LanceDB vector store persists across sessions (verified by persistence test)
- [ ] Embeddings generate locally — no API calls (verified by pipeline test)
- [ ] Hybrid search deduplicates and marks hybrid results correctly
- [ ] indexFile upserts: re-indexing a file removes stale nodes
- [ ] Benchmark methodology published in `bench/METHODOLOGY.md`
- [ ] Biome passes with zero errors
- [ ] All tests pass
- [ ] v1.0.0 tagged

---

## Subsequent Plans (Write When Phase 0 Is Complete)

| Phase | Plan file | Gate to write it |
|-------|-----------|------------------|
| 1: ECP Protocol | `docs/superpowers/plans/2026-04-13-engram-phase1-ecp.md` | v1.0.0 tagged + all Phase 0 milestones green |
| 2: Platform | `docs/superpowers/plans/2026-04-13-engram-phase2-platform.md` | ECP spec published + 3 adapters live |
| 3: Team Revenue | `docs/superpowers/plans/2026-04-13-engram-phase3-team.md` | Graph explorer live + plugin SDK v1 |
| 4: Enterprise | `docs/superpowers/plans/2026-04-13-engram-phase4-enterprise.md` | 10 paying teams + $10k MRR |
