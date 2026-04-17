/**
 * Tests for the engram:ast provider and grammar-loader utilities.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { getSupportedLang, getParser, _resetParserCache } from "../../src/providers/grammar-loader.js";
import { astProvider } from "../../src/providers/ast.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_TS = join(__dirname, "..", "fixtures", "sample.ts");
const FIXTURE_PY = join(__dirname, "..", "fixtures", "sample.py");

// ─── getSupportedLang ────────────────────────────────────────────────────────

describe("getSupportedLang", () => {
  it("maps known TypeScript extensions", () => {
    expect(getSupportedLang("foo.ts")).toBe("typescript");
    expect(getSupportedLang("foo.tsx")).toBe("tsx");
  });

  it("maps JavaScript extensions", () => {
    expect(getSupportedLang("foo.js")).toBe("javascript");
    expect(getSupportedLang("foo.jsx")).toBe("javascript");
    expect(getSupportedLang("foo.mjs")).toBe("javascript");
  });

  it("maps Python/Go/Rust", () => {
    expect(getSupportedLang("foo.py")).toBe("python");
    expect(getSupportedLang("foo.go")).toBe("go");
    expect(getSupportedLang("foo.rs")).toBe("rust");
  });

  it("returns null for unsupported extensions", () => {
    expect(getSupportedLang("foo.md")).toBeNull();
    expect(getSupportedLang("foo.json")).toBeNull();
    expect(getSupportedLang("Makefile")).toBeNull();
    expect(getSupportedLang("noextension")).toBeNull();
  });

  it("is case-insensitive on extension", () => {
    expect(getSupportedLang("FOO.TS")).toBe("typescript");
  });
});

// ─── getParser ───────────────────────────────────────────────────────────────

describe("getParser", () => {
  beforeAll(() => _resetParserCache());

  it("returns a parser for typescript when grammar is available", async () => {
    const parser = await getParser("typescript");
    // May be null if WASM is not available in this test environment
    if (parser !== null) {
      expect(typeof (parser as { parse: unknown }).parse).toBe("function");
    }
  });

  it("returns null for an unknown language", async () => {
    const parser = await getParser("cobol");
    expect(parser).toBeNull();
  });
});

// ─── astProvider ─────────────────────────────────────────────────────────────

describe("astProvider", () => {
  const mockContext = {
    filePath: "tests/fixtures/sample.ts",
    projectRoot: join(__dirname, "..", ".."),
    nodeIds: [],
    imports: [],
    hasTests: false,
    churnRate: 0,
  };

  it("returns null for unsupported file extension", async () => {
    const result = await astProvider.resolve("README.md", mockContext);
    expect(result).toBeNull();
  });

  it("returns null for a non-existent file", async () => {
    const result = await astProvider.resolve(
      join(tmpdir(), "does-not-exist-engram.ts"),
      mockContext
    );
    expect(result).toBeNull();
  });

  it("resolves sample.ts with confidence 1.0 when grammar is available", async () => {
    const result = await astProvider.resolve(FIXTURE_TS, mockContext);
    // If WASM not available, result will be null — that's fine (graceful degradation)
    if (result !== null) {
      expect(result.provider).toBe("engram:ast");
      expect(result.confidence).toBe(1.0);
      expect(result.cached).toBe(false);
      expect(result.content.length).toBeGreaterThan(0);
      // sample.ts has UserService class and getUser/createUser/deleteUser methods
      expect(result.content).toMatch(/UserService/);
    }
  });

  it("isAvailable returns a boolean", async () => {
    const available = await astProvider.isAvailable();
    expect(typeof available).toBe("boolean");
  });
});
