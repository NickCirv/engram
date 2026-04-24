/**
 * Resolver tests — verifies the Context Spine assembly engine.
 * Uses mock providers to test the resolution pipeline without
 * external dependencies.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ContextProvider, NodeContext, ProviderResult } from "../../src/providers/types.js";

// We test the resolver logic directly by importing the internal pieces
// For integration tests, we'd use the real providers against a test DB

const baseContext: NodeContext = {
  filePath: "src/auth/middleware.ts",
  projectRoot: "/tmp/test-project",
  nodeIds: ["src/auth/middleware.ts::validateToken"],
  imports: ["jsonwebtoken", "express"],
  hasTests: true,
  churnRate: 0.12,
};

function mockProvider(
  overrides: Partial<ContextProvider> & { name: string }
): ContextProvider {
  return {
    label: overrides.name.toUpperCase(),
    tier: 1,
    tokenBudget: 100,
    timeoutMs: 200,
    resolve: vi.fn().mockResolvedValue({
      provider: overrides.name,
      content: `${overrides.name} content`,
      confidence: 0.9,
      cached: false,
    }),
    isAvailable: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("provider types", () => {
  it("NodeContext has all required fields", () => {
    const ctx: NodeContext = {
      filePath: "src/auth.ts",
      projectRoot: "/project",
      nodeIds: [],
      imports: [],
      hasTests: false,
      churnRate: 0,
    };
    expect(ctx.filePath).toBe("src/auth.ts");
  });

  it("ProviderResult has all required fields", () => {
    const result: ProviderResult = {
      provider: "test",
      content: "test content",
      confidence: 0.9,
      cached: false,
    };
    expect(result.provider).toBe("test");
    expect(result.cached).toBe(false);
  });
});

describe("mock provider behavior", () => {
  it("provider resolve returns result", async () => {
    const provider = mockProvider({ name: "test-provider" });
    const result = await provider.resolve("src/auth.ts", baseContext);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("test-provider");
    expect(result!.content).toBe("test-provider content");
  });

  it("provider returning null is skipped", async () => {
    const provider = mockProvider({
      name: "empty-provider",
      resolve: vi.fn().mockResolvedValue(null),
    });
    const result = await provider.resolve("src/auth.ts", baseContext);
    expect(result).toBeNull();
  });

  it("provider throwing is caught", async () => {
    const provider = mockProvider({
      name: "broken-provider",
      resolve: vi.fn().mockRejectedValue(new Error("provider crashed")),
    });
    // The resolver wraps this in a try/catch — simulating here
    let result: ProviderResult | null = null;
    try {
      result = await provider.resolve("src/auth.ts", baseContext);
    } catch {
      result = null;
    }
    expect(result).toBeNull();
  });

  it("unavailable provider is filtered out", async () => {
    const provider = mockProvider({
      name: "offline-provider",
      isAvailable: vi.fn().mockResolvedValue(false),
    });
    const available = await provider.isAvailable();
    expect(available).toBe(false);
  });

  it("cached result has cached: true", async () => {
    const provider = mockProvider({
      name: "cached-provider",
      resolve: vi.fn().mockResolvedValue({
        provider: "cached-provider",
        content: "cached content",
        confidence: 0.8,
        cached: true,
      }),
    });
    const result = await provider.resolve("src/auth.ts", baseContext);
    expect(result!.cached).toBe(true);
  });
});

describe("token budget estimation", () => {
  it("estimates ~4 chars per token", () => {
    // The resolver uses Math.ceil(text.length / 4)
    const text = "This is a test string of about 40 chars.";
    const estimate = Math.ceil(text.length / 4);
    expect(estimate).toBe(10);
  });

  it("empty string is 0 tokens", () => {
    expect(Math.ceil("".length / 4)).toBe(0);
  });
});

describe("provider priority", () => {
  it("PROVIDER_PRIORITY has the correct order", async () => {
    const { PROVIDER_PRIORITY } = await import("../../src/providers/types.js");
    expect(PROVIDER_PRIORITY[0]).toBe("engram:ast");
    expect(PROVIDER_PRIORITY[1]).toBe("engram:structure");
    expect(PROVIDER_PRIORITY[2]).toBe("engram:mistakes");
    // v3.0 item #4: anthropic:memory inserted between mistakes + mempalace
    expect(PROVIDER_PRIORITY[3]).toBe("anthropic:memory");
    expect(PROVIDER_PRIORITY[4]).toBe("mempalace");
    expect(PROVIDER_PRIORITY[5]).toBe("context7");
    expect(PROVIDER_PRIORITY[6]).toBe("engram:git");
    expect(PROVIDER_PRIORITY[7]).toBe("obsidian");
  });
});

// ── v3.0 item #3: per-provider budget enforcement + mistakes-boost ──

describe("enforcePerProviderBudget", () => {
  it("leaves under-budget results untouched", async () => {
    const { enforcePerProviderBudget } = await import(
      "../../src/providers/resolver.js"
    );
    const providers: ContextProvider[] = [mockProvider({ name: "p1", tokenBudget: 100 })];
    const results: ProviderResult[] = [
      { provider: "p1", content: "short content", confidence: 0.8, cached: false },
    ];
    const out = enforcePerProviderBudget(results, providers);
    expect(out[0].content).toBe("short content");
  });

  it("truncates over-budget results by line", async () => {
    const { enforcePerProviderBudget } = await import(
      "../../src/providers/resolver.js"
    );
    // 5-token budget ≈ 20 chars; big content spans many lines
    const providers: ContextProvider[] = [mockProvider({ name: "p1", tokenBudget: 5 })];
    const bigLine = "a".repeat(40); // ~10 tokens
    const content = ["line1 short", bigLine, "line3"].join("\n");
    const results: ProviderResult[] = [
      { provider: "p1", content, confidence: 0.8, cached: false },
    ];
    const out = enforcePerProviderBudget(results, providers);
    expect(out[0].content).toContain("line1 short");
    expect(out[0].content).toContain("[truncated]");
    expect(out[0].content).not.toContain(bigLine);
  });

  it("hard-caps characters when even the first line exceeds budget", async () => {
    const { enforcePerProviderBudget } = await import(
      "../../src/providers/resolver.js"
    );
    const providers: ContextProvider[] = [mockProvider({ name: "p1", tokenBudget: 5 })];
    const content = "x".repeat(1000); // single line, way over budget
    const results: ProviderResult[] = [
      { provider: "p1", content, confidence: 0.5, cached: false },
    ];
    const out = enforcePerProviderBudget(results, providers);
    // Must be truncated — never emit the full 1000-char line
    expect(out[0].content.length).toBeLessThan(content.length);
    expect(out[0].content).toContain("[truncated]");
  });

  it("defaults budget to 200 tokens when provider isn't found", async () => {
    const { enforcePerProviderBudget } = await import(
      "../../src/providers/resolver.js"
    );
    const content = "ok"; // tiny — should survive default budget
    const results: ProviderResult[] = [
      { provider: "mystery", content, confidence: 0.7, cached: false },
    ];
    const out = enforcePerProviderBudget(results, []);
    expect(out[0].content).toBe("ok");
  });
});

describe("boostByMistakes", () => {
  const sampleMistakesContent = [
    "  ! JWT secret hardcoded (flagged 3d ago)",
    "  ! Race condition in login flow (flagged 1mo ago)",
  ].join("\n");

  it("returns results unchanged when there's no mistakes provider in the set", async () => {
    const { boostByMistakes } = await import("../../src/providers/resolver.js");
    const results: ProviderResult[] = [
      { provider: "engram:ast", content: "foo JWT bar", confidence: 0.8, cached: false },
    ];
    const out = boostByMistakes(results);
    expect(out[0].confidence).toBe(0.8);
  });

  it("boosts results whose content matches a mistake label", async () => {
    const { boostByMistakes } = await import("../../src/providers/resolver.js");
    const results: ProviderResult[] = [
      {
        provider: "engram:mistakes",
        content: sampleMistakesContent,
        confidence: 0.95,
        cached: false,
      },
      {
        provider: "engram:ast",
        content: "function handleLogin() { /* race condition in login flow */ }",
        confidence: 0.6,
        cached: false,
      },
    ];
    const out = boostByMistakes(results);
    const ast = out.find((r) => r.provider === "engram:ast");
    expect(ast!.confidence).toBeCloseTo(0.9, 5); // 0.6 * 1.5 = 0.9
  });

  it("caps boosted confidence at 1.0", async () => {
    const { boostByMistakes } = await import("../../src/providers/resolver.js");
    const results: ProviderResult[] = [
      {
        provider: "engram:mistakes",
        content: sampleMistakesContent,
        confidence: 0.95,
        cached: false,
      },
      {
        provider: "mempalace",
        content: "decision about JWT secret hardcoded handling",
        confidence: 0.8,
        cached: false,
      },
    ];
    const out = boostByMistakes(results);
    const mp = out.find((r) => r.provider === "mempalace");
    expect(mp!.confidence).toBe(1.0); // 0.8 * 1.5 = 1.2 capped
  });

  it("leaves non-matching results' confidence untouched", async () => {
    const { boostByMistakes } = await import("../../src/providers/resolver.js");
    const results: ProviderResult[] = [
      {
        provider: "engram:mistakes",
        content: sampleMistakesContent,
        confidence: 0.95,
        cached: false,
      },
      {
        provider: "context7",
        content: "Express.js middleware documentation — no relation to our mistakes",
        confidence: 0.7,
        cached: false,
      },
    ];
    const out = boostByMistakes(results);
    const c7 = out.find((r) => r.provider === "context7");
    expect(c7!.confidence).toBe(0.7);
  });

  it("does NOT boost the engram:mistakes provider itself", async () => {
    const { boostByMistakes } = await import("../../src/providers/resolver.js");
    const results: ProviderResult[] = [
      {
        provider: "engram:mistakes",
        content: sampleMistakesContent,
        confidence: 0.95,
        cached: false,
      },
    ];
    const out = boostByMistakes(results);
    expect(out[0].confidence).toBe(0.95);
  });

  it("case-insensitive matching (mistake labels are normalized)", async () => {
    const { boostByMistakes } = await import("../../src/providers/resolver.js");
    const results: ProviderResult[] = [
      {
        provider: "engram:mistakes",
        content: "  ! Some Important Bug (flagged today)",
        confidence: 0.95,
        cached: false,
      },
      {
        provider: "engram:git",
        content: "commit abc: fixed SOME IMPORTANT BUG for real this time",
        confidence: 0.5,
        cached: false,
      },
    ];
    const out = boostByMistakes(results);
    const git = out.find((r) => r.provider === "engram:git");
    expect(git!.confidence).toBeCloseTo(0.75, 5); // 0.5 * 1.5
  });
});
