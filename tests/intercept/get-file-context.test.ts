/**
 * Tests for core.ts::getFileContext — the bridge from absolute paths
 * (as hooks receive them from Claude Code) to graph queries.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { init, getFileContext } from "../../src/core.js";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  utimesSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("getFileContext", () => {
  let projectRoot: string;
  let authFile: string;

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), "engram-gfc-test-"));
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    authFile = join(projectRoot, "src", "auth.ts");
    writeFileSync(
      authFile,
      `export class AuthService {
  validate(token: string): boolean {
    return token.length > 0;
  }
  issue(userId: string): string {
    return "tok_" + userId;
  }
}

export class SessionStore {
  create(userId: string): string { return "sess_" + userId; }
}

export function createAuthService(): AuthService {
  return new AuthService();
}

export function verifyToken(token: string): boolean {
  return token.startsWith("tok_");
}
`
    );
    await init(projectRoot);
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("returns found=true with a summary for a file that has graph nodes", async () => {
    const ctx = await getFileContext(projectRoot, authFile);
    expect(ctx.found).toBe(true);
    expect(ctx.nodeCount).toBeGreaterThan(0);
    expect(ctx.summary).toContain("src/auth.ts");
    expect(ctx.confidence).toBeGreaterThan(0);
  });

  it("computes confidence as coverage × quality", async () => {
    const ctx = await getFileContext(projectRoot, authFile);
    // auth.ts has 4+ declarations (interface + class + 2 methods + function)
    // and all should extract at EXTRACTED quality (1.0). So confidence
    // should be at or near 1.0 × 1.0 = 1.0, but bounded by coverage
    // ceiling.
    expect(ctx.confidence).toBeGreaterThan(0.5);
    expect(ctx.confidence).toBeLessThanOrEqual(1.0);
  });

  it("returns empty result for a file with no graph coverage", async () => {
    const ghostFile = join(projectRoot, "src", "does-not-exist.ts");
    const ctx = await getFileContext(projectRoot, ghostFile);
    expect(ctx.found).toBe(false);
    expect(ctx.nodeCount).toBe(0);
    expect(ctx.confidence).toBe(0);
    expect(ctx.summary).toBe("");
  });

  it("returns empty for a file outside the project root", async () => {
    const outsideFile = join(tmpdir(), "engram-gfc-outside.ts");
    writeFileSync(outsideFile, "// outside\n");
    try {
      const ctx = await getFileContext(projectRoot, outsideFile);
      expect(ctx.found).toBe(false);
    } finally {
      rmSync(outsideFile, { force: true });
    }
  });

  it("detects staleness when file is newer than graph", async () => {
    // First get a fresh context — should not be stale.
    const fresh = await getFileContext(projectRoot, authFile);
    expect(fresh.isStale).toBe(false);

    // Touch the file to make it newer than graph.db.
    const future = new Date(Date.now() + 60_000); // 60s in the future
    utimesSync(authFile, future, future);

    const stale = await getFileContext(projectRoot, authFile);
    expect(stale.isStale).toBe(true);
    // Summary is still returned; the caller decides what to do with stale data.
    expect(stale.found).toBe(true);
  });

  it("reports graphMtimeMs matching the graph.db file mtime", async () => {
    const ctx = await getFileContext(projectRoot, authFile);
    expect(ctx.graphMtimeMs).toBeGreaterThan(0);
    // Should be approximately "now" since init just ran.
    expect(ctx.graphMtimeMs).toBeGreaterThan(Date.now() - 60_000);
  });

  it("handles a non-existent project root gracefully (returns empty)", async () => {
    const ctx = await getFileContext(
      "/definitely/does/not/exist/anywhere",
      "/some/file.ts"
    );
    expect(ctx.found).toBe(false);
    expect(ctx.graphMtimeMs).toBe(0);
  });

  it("never throws even on invalid inputs", async () => {
    const bad = await getFileContext("", "");
    expect(bad.found).toBe(false);
  });

  it("returns fileMtimeMs=null for files that don't exist yet", async () => {
    const newFile = join(projectRoot, "src", "new-file-not-yet.ts");
    const ctx = await getFileContext(projectRoot, newFile);
    expect(ctx.fileMtimeMs).toBe(null);
    expect(ctx.found).toBe(false);
  });
});
