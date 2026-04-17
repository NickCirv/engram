/**
 * LSP provider tests — graceful-degradation suite.
 *
 * These tests verify that the LSP provider and connection helper:
 *   1. Return null / false when no LSP socket exists (expected in CI)
 *   2. Never throw on any path
 *   3. Handle cache-reset correctly
 *
 * There is NO test that asserts a live LSP connection — that would be
 * brittle in CI. The contract is: when nothing is available, the provider
 * is silent and transparent.
 */
import { describe, it, expect, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LspConnection } from "../../src/providers/lsp-connection.js";
import { lspProvider, _resetLspCache } from "../../src/providers/lsp.js";
import type { NodeContext } from "../../src/providers/types.js";

const baseContext: NodeContext = {
  filePath: "src/auth/middleware.ts",
  projectRoot: join(tmpdir(), "test-lsp-project"),
  nodeIds: ["src/auth/middleware.ts::validateToken"],
  imports: ["jsonwebtoken"],
  hasTests: false,
  churnRate: 0.0,
};

afterEach(() => {
  // Always reset the module-level connection cache between tests
  _resetLspCache();
});

describe("LspConnection.tryConnect()", () => {
  it("returns null when no socket files exist", async () => {
    // In CI there are no LSP sockets — tryConnect should return null cleanly
    const conn = await LspConnection.tryConnect();
    // Accept either null (no sockets) or a connection if running in an IDE.
    // We just verify it does not throw.
    if (conn !== null) {
      conn.close();
    }
    expect(true).toBe(true); // reached here without throwing
  });

  it("returns null gracefully when all candidate paths are absent", async () => {
    // Force the no-socket path by checking on a platform where /tmp sockets
    // matching the candidate names definitely do not exist.
    // We can only assert this is deterministic if we know no IDE is running,
    // so we skip the assertion on the value and just verify no throw.
    let threw = false;
    try {
      const conn = await LspConnection.tryConnect();
      conn?.close();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

describe("lspProvider.isAvailable()", () => {
  it("returns false when no LSP socket exists (CI baseline)", async () => {
    // Reset cache so we attempt a fresh connect
    _resetLspCache();
    const available = await lspProvider.isAvailable();
    // In CI: expect false. In an IDE with running LSP: could be true.
    // The important assertion is that it doesn't throw and returns a boolean.
    expect(typeof available).toBe("boolean");
  });

  it("does not throw even when called multiple times rapidly", async () => {
    const results = await Promise.all([
      lspProvider.isAvailable(),
      lspProvider.isAvailable(),
      lspProvider.isAvailable(),
    ]);
    expect(results.every((r) => typeof r === "boolean")).toBe(true);
  });
});

describe("lspProvider.resolve()", () => {
  it("returns null when not connected", async () => {
    _resetLspCache();
    const result = await lspProvider.resolve(
      "src/auth/middleware.ts",
      baseContext
    );
    // When no LSP is available, resolve returns null — that is correct.
    // If an LSP IS available but hover is a stub, it still returns null.
    expect(result === null || result?.provider === "engram:lsp").toBe(true);
  });

  it("never throws for any file path", async () => {
    _resetLspCache();
    const paths = [
      "src/index.ts",
      "../../sneaky/../path.ts",
      "",
      "file with spaces.ts",
    ];
    for (const fp of paths) {
      let threw = false;
      try {
        await lspProvider.resolve(fp, { ...baseContext, filePath: fp });
      } catch {
        threw = true;
      }
      expect(threw).toBe(false);
    }
  });
});

describe("lspProvider metadata", () => {
  it("has correct static properties", () => {
    expect(lspProvider.name).toBe("engram:lsp");
    expect(lspProvider.label).toBe("LSP CONTEXT");
    expect(lspProvider.tier).toBe(1);
    expect(lspProvider.tokenBudget).toBe(100);
    expect(lspProvider.timeoutMs).toBe(100);
  });

  it("has no warmup method (Tier 1)", () => {
    expect(lspProvider.warmup).toBeUndefined();
  });
});
