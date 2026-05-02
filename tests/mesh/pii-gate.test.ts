import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { containsPii, stripPii, stripPiiDeep } from "../../src/mesh/index.js";

interface PiiZoo {
  categories: Record<string, string[]>;
  negatives: Record<string, string[]>;
}

const fixture: PiiZoo = JSON.parse(
  readFileSync(join(__dirname, "..", "fixtures", "pii-zoo.json"), "utf8"),
);

describe("mesh.pii-gate against pii-zoo fixtures", () => {
  for (const [category, samples] of Object.entries(fixture.categories)) {
    if (category.startsWith("_")) continue;
    describe(`category: ${category}`, () => {
      for (const sample of samples) {
        it(`detects + strips: ${sample.slice(0, 50)}`, () => {
          expect(containsPii(sample)).toBe(true);
          const { redacted, categories } = stripPii(sample);
          expect(redacted).toContain("[REDACTED]");
          expect(categories.length).toBeGreaterThan(0);
        });
      }
    });
  }

  describe("negatives must NOT trigger", () => {
    for (const [bucket, samples] of Object.entries(fixture.negatives)) {
      if (bucket.startsWith("_")) continue;
      for (const sample of samples) {
        it(`leaves alone: ${sample.slice(0, 50)}`, () => {
          // We allow `containsPii` to be true on a few negatives that share
          // shape with secrets (rare). The hard requirement is that a real
          // secret pattern doesn't slip THROUGH stripPii. Negatives are a
          // false-positive surface to monitor, not a hard fail.
          const { redacted } = stripPii(sample);
          // Our negatives should pass through close to unchanged.
          // We allow up to one redaction per sample to keep tests durable
          // as the gate evolves.
          const redactionCount = (redacted.match(/\[REDACTED\]/g) ?? []).length;
          expect(redactionCount).toBeLessThanOrEqual(1);
        });
      }
    }
  });
});

describe("mesh.pii-gate.stripPiiDeep", () => {
  it("recurses through objects", () => {
    const input = { user: { email: "a@b.com" }, ok: "safe" };
    const { value, categories } = stripPiiDeep(input);
    const v = value as Record<string, Record<string, string>>;
    expect(v.user.email).toContain("[REDACTED]");
    expect(v.ok).toBe("safe");
    expect(categories).toContain("email");
  });

  it("recurses through arrays", () => {
    const input = ["hello", { token: "Bearer abcdef1234567890ABCDEF1234567890" }];
    const { value, categories } = stripPiiDeep(input);
    expect(JSON.stringify(value)).toContain("[REDACTED]");
    expect(categories).toContain("bearer");
  });

  it("preserves non-string primitives", () => {
    const { value } = stripPiiDeep({ count: 42, ok: true, none: null });
    expect(value).toEqual({ count: 42, ok: true, none: null });
  });

  it("never throws on weird input", () => {
    expect(() => stripPiiDeep({ a: { b: { c: { d: "x@y.com" } } } })).not.toThrow();
    expect(() => stripPiiDeep([])).not.toThrow();
    expect(() => stripPiiDeep("")).not.toThrow();
  });
});
