import { describe, it, expect } from "vitest";
import {
  detectPackageManager,
  upgradeCommand,
  manualCommand,
  PACKAGE,
} from "../../src/update/install.js";

describe("update/install.ts — upgradeCommand", () => {
  it("builds npm upgrade with latest", () => {
    const r = upgradeCommand("npm");
    expect(r.cmd).toBe("npm");
    expect(r.args).toEqual(["install", "-g", "engramx@latest"]);
  });

  it("builds pnpm upgrade with latest", () => {
    const r = upgradeCommand("pnpm");
    expect(r.cmd).toBe("pnpm");
    expect(r.args).toEqual(["add", "-g", "engramx@latest"]);
  });

  it("builds yarn upgrade with latest", () => {
    const r = upgradeCommand("yarn");
    expect(r.cmd).toBe("yarn");
    expect(r.args).toEqual(["global", "add", "engramx@latest"]);
  });

  it("builds bun upgrade with latest", () => {
    const r = upgradeCommand("bun");
    expect(r.cmd).toBe("bun");
    expect(r.args).toEqual(["add", "-g", "engramx@latest"]);
  });

  it("respects --channel beta", () => {
    const r = upgradeCommand("npm", "beta");
    expect(r.args).toEqual(["install", "-g", "engramx@beta"]);
  });
});

describe("update/install.ts — detectPackageManager", () => {
  it("returns some result without throwing", () => {
    const r = detectPackageManager();
    expect(r).toBeDefined();
    // reason is always populated
    expect(typeof r.reason).toBe("string");
    // manager is npm by fallback when not recognized
    if (r.manager) {
      expect(["npm", "pnpm", "yarn", "bun"]).toContain(r.manager);
    }
  });
});

describe("update/install.ts — manualCommand + PACKAGE", () => {
  it("generates the canonical install line", () => {
    expect(manualCommand()).toBe("npm install -g engramx@latest");
    expect(manualCommand("beta")).toBe("npm install -g engramx@beta");
  });

  it("exports the package name", () => {
    expect(PACKAGE).toBe("engramx");
  });
});
