import { describe, it, expect } from "vitest";
import {
  isEnvelope,
  computeTrust,
  MESH_PROTOCOL_VERSION,
  MESH_MAX_ENVELOPE_BYTES,
  MESH_CLOCK_TOLERANCE_MS,
  MESH_REPLAY_CACHE_TTL_MS,
} from "../../src/mesh/index.js";

describe("mesh.types constants", () => {
  it("exports stable protocol version 1", () => {
    expect(MESH_PROTOCOL_VERSION).toBe(1);
  });

  it("envelope size cap is 64 KB", () => {
    expect(MESH_MAX_ENVELOPE_BYTES).toBe(65536);
  });

  it("clock tolerance is 5 minutes", () => {
    expect(MESH_CLOCK_TOLERANCE_MS).toBe(300000);
  });

  it("replay cache TTL is 24 hours", () => {
    expect(MESH_REPLAY_CACHE_TTL_MS).toBe(86400000);
  });
});

describe("mesh.types.isEnvelope", () => {
  const valid = {
    v: 1,
    id: "01HXX",
    ts: "2026-05-02T10:00:00.000Z",
    from: "abc",
    type: "peer.hello" as const,
    payload: {},
    sig: "sig",
  };

  it("accepts a well-formed envelope", () => {
    expect(isEnvelope(valid)).toBe(true);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["string", "envelope"],
    ["number", 42],
    ["empty object", {}],
  ])("rejects %s", (_label, v) => {
    expect(isEnvelope(v)).toBe(false);
  });

  it.each([
    "v",
    "id",
    "ts",
    "from",
    "type",
    "sig",
  ] as const)("rejects when %s is missing", (key) => {
    const broken = { ...valid };
    delete (broken as Record<string, unknown>)[key];
    expect(isEnvelope(broken)).toBe(false);
  });

  it("rejects when v is a string", () => {
    expect(isEnvelope({ ...valid, v: "1" })).toBe(false);
  });
});

describe("mesh.types.computeTrust", () => {
  it("applies the 0.4/0.2/0.2/0.2 weighted formula", () => {
    const t = computeTrust({ success: 1, uptime: 1, threat: 1, integrity: 1 });
    expect(t).toBe(1);
  });

  it("returns 0 when all inputs are 0", () => {
    expect(computeTrust({ success: 0, uptime: 0, threat: 0, integrity: 0 })).toBe(0);
  });

  it("clamps above 1", () => {
    expect(computeTrust({ success: 5, uptime: 5, threat: 5, integrity: 5 })).toBe(1);
  });

  it("clamps below 0", () => {
    expect(computeTrust({ success: -5, uptime: -5, threat: -5, integrity: -5 })).toBe(0);
  });

  it("weights success twice as heavily as the others", () => {
    const onlySuccess = computeTrust({ success: 1, uptime: 0, threat: 0, integrity: 0 });
    const onlyUptime = computeTrust({ success: 0, uptime: 1, threat: 0, integrity: 0 });
    expect(onlySuccess).toBeCloseTo(0.4, 5);
    expect(onlyUptime).toBeCloseTo(0.2, 5);
  });
});
