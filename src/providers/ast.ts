/**
 * engram:ast provider — real AST-based symbol extraction via web-tree-sitter.
 *
 * Confidence 1.0 (exact, not estimated). Tier 1. 200ms timeout.
 *
 * Falls back gracefully to null on any error so the resolver can continue
 * with the regex-based engram:structure provider.
 */
import { readFileSync } from "node:fs";
import type { Node } from "web-tree-sitter";
import type { ContextProvider, NodeContext, ProviderResult } from "./types.js";
import { getSupportedLang, getParser } from "./grammar-loader.js";

interface Symbol {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "method" | "variable";
  line: number;
  params?: string;
}

// ─── AST traversal ──────────────────────────────────────────────────────────

function extractParams(node: Node): string {
  const paramsNode =
    node.childForFieldName("parameters") ??
    node.childForFieldName("formal_parameters");
  if (!paramsNode) return "";
  return paramsNode.text
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80)
    .trim();
}

function extractSymbols(rootNode: Node): Symbol[] {
  const symbols: Symbol[] = [];

  function visit(node: Node): void {
    switch (node.type) {
      // ── Functions ───────────────────────────────────────────────
      case "function_declaration":
      case "function_definition": {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          symbols.push({
            name: nameNode.text,
            kind: "function",
            line: node.startPosition.row + 1,
            params: extractParams(node),
          });
        }
        break;
      }

      // ── Classes ─────────────────────────────────────────────────
      case "class_declaration":
      case "class_definition": {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          symbols.push({
            name: nameNode.text,
            kind: "class",
            line: node.startPosition.row + 1,
          });
        }
        break;
      }

      // ── Methods ─────────────────────────────────────────────────
      case "method_definition":
      case "method_declaration": {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          symbols.push({
            name: nameNode.text,
            kind: "method",
            line: node.startPosition.row + 1,
            params: extractParams(node),
          });
        }
        break;
      }

      // ── TypeScript interfaces ────────────────────────────────────
      case "interface_declaration": {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          symbols.push({
            name: nameNode.text,
            kind: "interface",
            line: node.startPosition.row + 1,
          });
        }
        break;
      }

      // ── TypeScript type aliases ──────────────────────────────────
      case "type_alias_declaration": {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          symbols.push({
            name: nameNode.text,
            kind: "type",
            line: node.startPosition.row + 1,
          });
        }
        break;
      }

      // ── Exported variable declarations (incl. arrow functions) ──
      case "lexical_declaration":
      case "variable_declaration": {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (!child || child.type !== "variable_declarator") continue;
          const nameNode = child.childForFieldName("name");
          const valueNode = child.childForFieldName("value");
          if (!nameNode) continue;
          const isArrow =
            valueNode?.type === "arrow_function" ||
            valueNode?.type === "function";
          symbols.push({
            name: nameNode.text,
            kind: isArrow ? "function" : "variable",
            line: node.startPosition.row + 1,
            params: isArrow && valueNode ? extractParams(valueNode) : undefined,
          });
        }
        break;
      }

      default:
        break;
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) visit(child);
    }
  }

  visit(rootNode);
  return symbols;
}

// ─── Formatting ──────────────────────────────────────────────────────────────

function formatSymbols(symbols: Symbol[], tokenBudget: number): string {
  const lines = symbols.map((s) => {
    const params = s.params !== undefined ? `(${s.params})` : "";
    return `${s.kind.toUpperCase()} ${s.name}${params} L${s.line}`;
  });
  const charBudget = tokenBudget * 4;
  let text = lines.join("\n");
  if (text.length > charBudget) {
    text = text.slice(0, charBudget).trimEnd() + "\n... (truncated)";
  }
  return text;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export const astProvider: ContextProvider = {
  name: "engram:ast",
  label: "AST STRUCTURE",
  tier: 1,
  tokenBudget: 300,
  timeoutMs: 200,

  async resolve(
    filePath: string,
    _context: NodeContext
  ): Promise<ProviderResult | null> {
    const lang = getSupportedLang(filePath);
    if (!lang) return null;

    const parser = await getParser(lang);
    if (!parser) return null;

    try {
      const source = readFileSync(filePath, "utf-8");
      const tree = parser.parse(source);
      if (!tree) return null;
      const symbols = extractSymbols(tree.rootNode);
      if (symbols.length === 0) return null;

      return {
        provider: "engram:ast",
        content: formatSymbols(symbols, this.tokenBudget),
        confidence: 1.0,
        cached: false,
      };
    } catch {
      return null;
    }
  },

  async isAvailable(): Promise<boolean> {
    try {
      const { Parser } = await import("web-tree-sitter");
      await Parser.init();
      return true;
    } catch {
      return false;
    }
  },
};
