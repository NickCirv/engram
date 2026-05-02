import { describe, it, expect } from "vitest";
import {
  canonicalize,
  canonicalizeToString,
  canonicalizeEnvelopeForSigning,
} from "../../src/mesh/index.js";

describe("mesh.jcs.canonicalizeToString", () => {
  it("primitives serialize literally", () => {
    expect(canonicalizeToString(null)).toBe("null");
    expect(canonicalizeToString(true)).toBe("true");
    expect(canonicalizeToString(false)).toBe("false");
    expect(canonicalizeToString(42)).toBe("42");
    expect(canonicalizeToString(0)).toBe("0");
    expect(canonicalizeToString(-0)).toBe("0");
  });

  it("strings escape per RFC 8259", () => {
    expect(canonicalizeToString("simple")).toBe('"simple"');
    expect(canonicalizeToString('with "quote"')).toBe('"with \\"quote\\""');
    expect(canonicalizeToString("tab\there")).toBe('"tab\\there"');
    expect(canonicalizeToString("\u0001")).toBe('"\\u0001"');
  });

  it("arrays preserve order", () => {
    expect(canonicalizeToString([3, 1, 2])).toBe("[3,1,2]");
  });

  it("object keys sort by UTF-16 code unit", () => {
    const out = canonicalizeToString({ b: 2, a: 1, c: 3 });
    expect(out).toBe('{"a":1,"b":2,"c":3}');
  });

  it("nested objects sort at every level", () => {
    const out = canonicalizeToString({
      z: { y: 1, x: 2 },
      a: { c: 3, b: 4 },
    });
    expect(out).toBe('{"a":{"b":4,"c":3},"z":{"x":2,"y":1}}');
  });

  it("undefined keys are dropped, not errored", () => {
    const out = canonicalizeToString({ a: 1, b: undefined, c: 3 });
    expect(out).toBe('{"a":1,"c":3}');
  });

  it("throws on non-finite numbers", () => {
    expect(() => canonicalizeToString(NaN)).toThrow();
    expect(() => canonicalizeToString(Infinity)).toThrow();
    expect(() => canonicalizeToString(-Infinity)).toThrow();
  });

  it("throws on circular references", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => canonicalizeToString(a)).toThrow(/circular/);
  });

  it("throws on functions and symbols", () => {
    expect(() => canonicalizeToString(() => 1)).toThrow();
    expect(() => canonicalizeToString(Symbol("x"))).toThrow();
  });

  it("throws on bigint", () => {
    expect(() => canonicalizeToString(BigInt(1))).toThrow();
  });
});

describe("mesh.jcs.canonicalize (bytes)", () => {
  it("produces valid UTF-8", () => {
    const bytes = canonicalize({ greeting: "héllo" });
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toContain("héllo");
  });

  it("identical objects produce identical bytes", () => {
    const a = canonicalize({ a: 1, b: { c: 2 } });
    const b = canonicalize({ b: { c: 2 }, a: 1 });
    expect(a).toEqual(b);
  });
});

describe("mesh.jcs.canonicalizeEnvelopeForSigning", () => {
  it("strips sig field before serializing", () => {
    const env = {
      v: 1,
      id: "01HXX",
      ts: "2026-05-02T10:00:00.000Z",
      from: "abc",
      type: "peer.hello",
      payload: { hello: "world" },
      sig: "this-must-not-be-in-the-signed-bytes",
    };
    const bytes = canonicalizeEnvelopeForSigning(env);
    const text = new TextDecoder().decode(bytes);
    expect(text).not.toContain("must-not-be-in");
    expect(text).toContain('"hello":"world"');
  });

  it("output is independent of original key order", () => {
    const a = canonicalizeEnvelopeForSigning({ v: 1, type: "x", id: "1", ts: "t", from: "f", payload: {}, sig: "s" });
    const b = canonicalizeEnvelopeForSigning({ sig: "s", payload: {}, from: "f", ts: "t", id: "1", type: "x", v: 1 });
    expect(a).toEqual(b);
  });
});
