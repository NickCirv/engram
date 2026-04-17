import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GraphStore } from "../../src/graph/store.js";
import { init } from "../../src/core.js";
import {
  rollback,
  runMigrations,
  getSchemaVersion,
  CURRENT_SCHEMA_VERSION,
} from "../../src/db/migrate.js";

describe("schema rollback", () => {
  let testDir: string;
  let dbPath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `engram-rollback-${Date.now()}`);
    mkdirSync(join(testDir, "src"), { recursive: true });
    writeFileSync(
      join(testDir, "src", "a.ts"),
      "export function hello() {}\n"
    );
    await init(testDir);
    dbPath = join(testDir, ".engram", "graph.db");
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("no-op when target equals current version", async () => {
    const store = await GraphStore.open(dbPath);
    try {
      const current = getSchemaVersion(
        (store as unknown as { db: Parameters<typeof getSchemaVersion>[0] }).db
      );
      const result = rollback(
        (store as unknown as { db: Parameters<typeof rollback>[0] }).db,
        dbPath,
        current
      );
      expect(result.migrationsReverted).toBe(0);
      expect(result.fromVersion).toBe(current);
      expect(result.toVersion).toBe(current);
    } finally {
      store.close();
    }
  });

  it("throws when target > current", async () => {
    const store = await GraphStore.open(dbPath);
    try {
      expect(() =>
        rollback(
          (store as unknown as { db: Parameters<typeof rollback>[0] }).db,
          dbPath,
          CURRENT_SCHEMA_VERSION + 1
        )
      ).toThrow(/Invalid target version/);
    } finally {
      store.close();
    }
  });

  it("throws when target is negative", async () => {
    const store = await GraphStore.open(dbPath);
    try {
      expect(() =>
        rollback(
          (store as unknown as { db: Parameters<typeof rollback>[0] }).db,
          dbPath,
          -1
        )
      ).toThrow(/Invalid target version/);
    } finally {
      store.close();
    }
  });

  it("rolls back from current to earlier version and creates backup", async () => {
    const store = await GraphStore.open(dbPath);
    try {
      const result = rollback(
        (store as unknown as { db: Parameters<typeof rollback>[0] }).db,
        dbPath,
        CURRENT_SCHEMA_VERSION - 1
      );
      expect(result.toVersion).toBe(CURRENT_SCHEMA_VERSION - 1);
      expect(result.migrationsReverted).toBeGreaterThanOrEqual(1);

      // Within the same store instance, the version reflects the rollback
      const v = getSchemaVersion(
        (store as unknown as { db: Parameters<typeof getSchemaVersion>[0] }).db
      );
      expect(v).toBe(CURRENT_SCHEMA_VERSION - 1);
      store.save();
    } finally {
      store.close();
    }

    // Backup file should exist after rollback
    expect(existsSync(`${dbPath}.bak-v${CURRENT_SCHEMA_VERSION}`)).toBe(true);

    // Note: re-opening the store will auto-migrate forward again. This is
    // by design — rollback is for in-session debugging/recovery, not for
    // pinning the schema at a lower version. Users who need to stay at an
    // older version should keep using the backup file directly.
  });

  it("roundtrip: migrate → rollback → migrate returns same version", async () => {
    const store = await GraphStore.open(dbPath);
    try {
      const startVersion = getSchemaVersion(
        (store as unknown as { db: Parameters<typeof getSchemaVersion>[0] }).db
      );
      expect(startVersion).toBe(CURRENT_SCHEMA_VERSION);

      // Roll back 2 versions
      rollback(
        (store as unknown as { db: Parameters<typeof rollback>[0] }).db,
        dbPath,
        startVersion - 2
      );
      store.save();

      // Migrate forward
      const forward = runMigrations(
        (store as unknown as { db: Parameters<typeof runMigrations>[0] }).db,
        dbPath
      );
      expect(forward.toVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(forward.migrationsRun).toBe(2);
    } finally {
      store.close();
    }
  });
});
