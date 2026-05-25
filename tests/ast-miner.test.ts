import { describe, it, expect } from "vitest";
import { extractFile, extractDirectory, SUPPORTED_EXTENSIONS } from "../src/miners/ast-miner.js";
import { join } from "node:path";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import * as os from "node:os";

const FIXTURES = join(import.meta.dirname, "fixtures");

describe("AST Miner", () => {
  describe("SUPPORTED_EXTENSIONS", () => {
    it("includes TypeScript and JavaScript", () => {
      expect(SUPPORTED_EXTENSIONS.has(".ts")).toBe(true);
      expect(SUPPORTED_EXTENSIONS.has(".tsx")).toBe(true);
      expect(SUPPORTED_EXTENSIONS.has(".js")).toBe(true);
      expect(SUPPORTED_EXTENSIONS.has(".jsx")).toBe(true);
    });

    it("includes Python", () => {
      expect(SUPPORTED_EXTENSIONS.has(".py")).toBe(true);
    });

    it("includes Go, Rust, Java", () => {
      expect(SUPPORTED_EXTENSIONS.has(".go")).toBe(true);
      expect(SUPPORTED_EXTENSIONS.has(".rs")).toBe(true);
      expect(SUPPORTED_EXTENSIONS.has(".java")).toBe(true);
    });

    it("does not include non-code files", () => {
      expect(SUPPORTED_EXTENSIONS.has(".md")).toBe(false);
      expect(SUPPORTED_EXTENSIONS.has(".json")).toBe(false);
      expect(SUPPORTED_EXTENSIONS.has(".txt")).toBe(false);
    });
  });

  describe("extractFile — TypeScript", () => {
    it("extracts classes", () => {
      const { nodes } = extractFile(join(FIXTURES, "sample.ts"), FIXTURES);
      const classNodes = nodes.filter((n) => n.kind === "class");
      expect(classNodes.length).toBeGreaterThanOrEqual(1);
      expect(classNodes.some((n) => n.label === "UserService")).toBe(true);
    });

    it("extracts functions", () => {
      const { nodes } = extractFile(join(FIXTURES, "sample.ts"), FIXTURES);
      const funcNodes = nodes.filter((n) => n.kind === "function");
      expect(funcNodes.length).toBeGreaterThanOrEqual(1);
      const labels = funcNodes.map((n) => n.label);
      expect(labels).toContain("validateEmail()");
    });

    it("extracts imports", () => {
      const { edges } = extractFile(join(FIXTURES, "sample.ts"), FIXTURES);
      const importEdges = edges.filter((e) => e.relation === "imports");
      expect(importEdges.length).toBeGreaterThanOrEqual(1);
    });

    it("extracts exports", () => {
      const { edges } = extractFile(join(FIXTURES, "sample.ts"), FIXTURES);
      const exportEdges = edges.filter((e) => e.relation === "exports");
      expect(exportEdges.length).toBeGreaterThanOrEqual(1);
    });

    it("creates file node", () => {
      const { nodes } = extractFile(join(FIXTURES, "sample.ts"), FIXTURES);
      const fileNodes = nodes.filter((n) => n.kind === "file");
      expect(fileNodes.length).toBe(1);
      expect(fileNodes[0].label).toBe("sample.ts");
    });

    it("sets confidence to EXTRACTED", () => {
      const { nodes, edges } = extractFile(join(FIXTURES, "sample.ts"), FIXTURES);
      for (const node of nodes) {
        expect(node.confidence).toBe("EXTRACTED");
        expect(node.confidenceScore).toBe(0.85);
      }
      for (const edge of edges) {
        expect(edge.confidence).toBe("EXTRACTED");
      }
    });

    it("includes source location", () => {
      const { nodes } = extractFile(join(FIXTURES, "sample.ts"), FIXTURES);
      const funcNodes = nodes.filter((n) => n.kind === "function");
      for (const fn of funcNodes) {
        expect(fn.sourceLocation).toMatch(/^L\d+$/);
      }
    });
  });

  describe("extractFile — Python", () => {
    it("extracts classes", () => {
      const { nodes } = extractFile(join(FIXTURES, "sample.py"), FIXTURES);
      const classNodes = nodes.filter((n) => n.kind === "class");
      expect(classNodes.length).toBeGreaterThanOrEqual(2);
      const labels = classNodes.map((n) => n.label);
      expect(labels).toContain("Config");
      expect(labels).toContain("Server");
    });

    it("extracts functions including methods", () => {
      const { nodes } = extractFile(join(FIXTURES, "sample.py"), FIXTURES);
      const funcNodes = nodes.filter((n) => n.kind === "function");
      expect(funcNodes.length).toBeGreaterThanOrEqual(4);
      const labels = funcNodes.map((n) => n.label);
      expect(labels).toContain("__init__()");
      expect(labels).toContain("start()");
      expect(labels).toContain("create_app()");
    });

    it("extracts imports", () => {
      const { edges } = extractFile(join(FIXTURES, "sample.py"), FIXTURES);
      const importEdges = edges.filter(
        (e) => e.relation === "imports" || e.relation === "imports_from" // handle both patterns
      );
      expect(importEdges.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("extractDirectory", () => {
    it("extracts from all files in directory", () => {
      const result = extractDirectory(FIXTURES, FIXTURES);
      expect(result.fileCount).toBeGreaterThanOrEqual(2);
      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.edges.length).toBeGreaterThan(0);
      expect(result.totalLines).toBeGreaterThan(0);
    });

    it("returns correct counts", () => {
      const result = extractDirectory(FIXTURES, FIXTURES);
      expect(result.nodes.length).toBeGreaterThanOrEqual(10);
      expect(result.edges.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe("edge cases", () => {
    it("returns empty for unsupported file", () => {
      // Create a temp .md file path (won't actually read since extension check is first)
      const { nodes, edges } = extractFile("/tmp/test.md", "/tmp");
      expect(nodes).toEqual([]);
      expect(edges).toEqual([]);
    });
  });

describe("depth limits", () => {
    function mkdtemp(prefix: string): string {
      return mkdtempSync(join(os.tmpdir(), prefix));
    }

    function cleanup(dir: string): void {
      rmSync(dir, { recursive: true, force: true });
    }

    it("does not throw on directory nested 101 levels deep", () => {
      // Build a path 101 levels deep within a temp root
      const root = mkdtemp("engram-deep-");
      let current = root;

      for (let i = 1; i <= 101; i++) {
        current = join(current, `level${i}`);
      }
      mkdirSync(current, { recursive: true });
      writeFileSync(join(current, "deep.ts"), "export function deep() {}\n");

      // extractDirectory should not throw — MAX_DEPTH guard prevents stack overflow
      expect(() => extractDirectory(root)).not.toThrow();

      cleanup(root);
    });

    it("extracts files at exactly MAX_DEPTH (100)", () => {
      const root = mkdtemp("engram-exact-");
      let current = root;

      for (let i = 1; i <= 100; i++) {
        current = join(current, `d${i}`);
      }
      mkdirSync(current, { recursive: true });
      writeFileSync(join(current, "exact.ts"), "export function exact() {}\n");

      const result = extractDirectory(root);

      // File at depth 100 IS reachable (depth 0..100 inclusive)
      expect(result.fileCount).toBeGreaterThanOrEqual(1);
      expect(result.nodes.some((n) => n.label === "exact()")).toBe(true);

      cleanup(root);
    });

    it("stops extraction beyond MAX_DEPTH (100)", () => {
      const root = mkdtemp("engram-beyond-");
      let current = root;

      for (let i = 1; i <= 101; i++) {
        current = join(current, `d${i}`);
      }
      mkdirSync(current, { recursive: true });
      writeFileSync(join(current, "beyond.ts"), "export function beyond() {}\n");

      const result = extractDirectory(root);

      // File at depth 101 should NOT be extracted
      expect(result.fileCount).toBe(0);
      expect(result.nodes.some((n) => n.label === "beyond()")).toBe(false);

      cleanup(root);
    });

    it("returns mtimes map for incremental indexing", () => {
      const root = mkdtemp("engram-mtime-");
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src", "app.ts"), "export function app() {}\n");

      const result = extractDirectory(root);
      expect(result.mtimes.size).toBeGreaterThan(0);
      expect(result.skippedCount).toBe(0);

      cleanup(root);
    });
  });
});
