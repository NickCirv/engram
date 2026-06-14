import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { init, query, godNodes, stats, benchmark, learn } from "../src/core.js";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Core — init", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "engram-core-test-"));
    // Create a mini project
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(
      join(tmpDir, "src", "index.ts"),
      `import { helper } from "./helper.js";\n\nexport function main() {\n  return helper();\n}\n`
    );
    writeFileSync(
      join(tmpDir, "src", "helper.ts"),
      `export function helper() {\n  return "hello";\n}\n\nexport function unused() {\n  return null;\n}\n`
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates .engram directory and graph.db", async () => {
    const result = await init(tmpDir);
    expect(result.fileCount).toBe(2);
    expect(result.nodes).toBeGreaterThan(0);
    expect(result.edges).toBeGreaterThan(0);
    expect(result.timeMs).toBeGreaterThanOrEqual(0);
  });

  it("extracts functions from both files", async () => {
    await init(tmpDir);
    const gods = await godNodes(tmpDir);
    const labels = gods.map((g) => g.label);
    expect(labels).toContain("main()");
    expect(labels).toContain("helper()");
  });

  it("reports stats after init", async () => {
    await init(tmpDir);
    const s = await stats(tmpDir);
    expect(s.nodes).toBeGreaterThan(0);
    expect(s.edges).toBeGreaterThan(0);
    expect(s.lastMined).toBeGreaterThan(0);
  });
});

describe("Core — query", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "engram-query-test-"));
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(
      join(tmpDir, "src", "auth.ts"),
      `export class AuthController {\n  async login(email: string) { return true; }\n  async logout() { return true; }\n}\n`
    );
    writeFileSync(
      join(tmpDir, "src", "db.ts"),
      `export class Database {\n  async connect() { return true; }\n  async query(sql: string) { return []; }\n}\n`
    );
    await init(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds matching nodes", async () => {
    const result = await query(tmpDir, "auth login");
    expect(result.nodesFound).toBeGreaterThan(0);
    expect(result.text).toContain("auth");
  });

  it("returns token estimate", async () => {
    const result = await query(tmpDir, "database");
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });

  it("returns empty for no match", async () => {
    const result = await query(tmpDir, "zzzznonexistent");
    expect(result.nodesFound).toBe(0);
  });

  it("respects token budget", async () => {
    const small = await query(tmpDir, "auth", { tokenBudget: 50 });
    const large = await query(tmpDir, "auth", { tokenBudget: 5000 });
    expect(small.text.length).toBeLessThanOrEqual(large.text.length);
  });
});

describe("Core — benchmark", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "engram-bench-test-"));
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "app.ts"), `export function app() { return "hello"; }\n`);
    await init(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports both baselines", async () => {
    const result = await benchmark(tmpDir);
    expect(result.naiveFullCorpus).toBeGreaterThan(0);
    expect(result.avgQueryTokens).toBeGreaterThanOrEqual(0);
  });
});

describe("Core — learn", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "engram-learn-test-"));
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "app.ts"), `export function app() {}\n`);
    await init(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("learns a pattern", async () => {
    const result = await learn(tmpDir, "pattern: always use immutable objects for state");
    expect(result.nodesAdded).toBeGreaterThanOrEqual(1);
  });

  it("learns a bug description", async () => {
    const result = await learn(tmpDir, "bug: race condition when multiple users connect simultaneously");
    expect(result.nodesAdded).toBeGreaterThanOrEqual(1);
  });

  it("returns 0 for no extractable pattern", async () => {
    const result = await learn(tmpDir, "hello world");
    expect(result.nodesAdded).toBe(0);
  });
});

describe("Core — init with skills (v0.2)", () => {
  let tmpDir: string;
  let skillsDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "engram-skills-init-"));
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(
      join(tmpDir, "src", "app.ts"),
      `export function main() { return "hi"; }\n`
    );

    // Mini skills directory
    skillsDir = mkdtempSync(join(tmpdir(), "engram-skills-fixture-"));
    mkdirSync(join(skillsDir, "test-skill-a"));
    writeFileSync(
      join(skillsDir, "test-skill-a", "SKILL.md"),
      `---\nname: test-skill-a\ndescription: "Use when testing alpha. Triggers: 'alpha test'."\n---\n\n# Test Skill A\n`
    );
    mkdirSync(join(skillsDir, "test-skill-b"));
    writeFileSync(
      join(skillsDir, "test-skill-b", "SKILL.md"),
      `---\nname: test-skill-b\ndescription: "Use when testing beta. Triggers: 'beta test'."\n---\n\n# Test Skill B\n`
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(skillsDir, { recursive: true, force: true });
  });

  it("skips skills-miner by default (backwards compat)", async () => {
    const result = await init(tmpDir);
    expect(result.skillCount).toBe(0);
  });

  it("withSkills: <path> → mines the given directory", async () => {
    const result = await init(tmpDir, { withSkills: skillsDir });
    expect(result.skillCount).toBe(2);
    expect(result.nodes).toBeGreaterThan(2); // code nodes + 2 skills + keyword nodes
  });

  it("withSkills: true → resolves the default skills dir (hermetic via ENGRAM_SKILLS_DIR)", async () => {
    // Point the `true` default at an isolated EMPTY dir so the test is
    // deterministic and never mines the developer's live ~/.claude/skills
    // (which is large + concurrently modified → could throw mid-scan, #137).
    const emptySkills = mkdtempSync(join(tmpdir(), "engram-empty-skills-"));
    const prev = process.env.ENGRAM_SKILLS_DIR;
    process.env.ENGRAM_SKILLS_DIR = emptySkills;
    try {
      const result = await init(tmpDir, { withSkills: true });
      expect(result.skillCount).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.ENGRAM_SKILLS_DIR;
      else process.env.ENGRAM_SKILLS_DIR = prev;
      rmSync(emptySkills, { recursive: true, force: true });
    }
  });

  it("skill nodes do not appear as god nodes (kind=concept excluded)", async () => {
    await init(tmpDir, { withSkills: skillsDir });
    const gods = await godNodes(tmpDir);
    // God nodes should be code entities, not skill concepts
    for (const g of gods) {
      expect(g.kind).not.toBe("concept");
    }
  });
});

describe("Core — init lockfile guard (v0.2)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "engram-lock-"));
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(
      join(tmpDir, "src", "app.ts"),
      `export function main() {}\n`
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws when a lock file already exists", async () => {
    mkdirSync(join(tmpDir, ".engram"));
    writeFileSync(join(tmpDir, ".engram", "init.lock"), "99999");
    await expect(init(tmpDir)).rejects.toThrow(/lock/i);
  });

  it("cleans up the lock file on success", async () => {
    await init(tmpDir);
    expect(existsSync(join(tmpDir, ".engram", "init.lock"))).toBe(false);
  });
});
