/**
 * Tests for the schema versioning and migration runner.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GraphStore } from "../../src/graph/store.js";
import {
  getSchemaVersion,
  runMigrations,
  CURRENT_SCHEMA_VERSION,
} from "../../src/db/migrate.js";

// Helper: cast store to access internal db property (testing only)
type InternalStore = { db: ReturnType<typeof getSchemaVersion extends (db: infer D) => unknown ? () => D : never> };

describe("migrate", () => {
  let tmpDir: string;
  let store: GraphStore;
  let dbPath: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "engram-migrate-test-"));
    dbPath = join(tmpDir, "graph.db");
    store = await GraphStore.open(dbPath);
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function getRawDb(s: GraphStore) {
    return (s as unknown as { db: { exec: (sql: string) => Array<{ values: unknown[][] }>; run: (sql: string, params?: unknown[]) => unknown } }).db;
  }

  it("getSchemaVersion returns 0 on a db with no schema_version table", () => {
    const db = getRawDb(store);
    db.exec("DROP TABLE IF EXISTS schema_version");
    const version = getSchemaVersion(db);
    expect(version).toBe(0);
  });

  it("store constructor auto-migrates to CURRENT_SCHEMA_VERSION", () => {
    const db = getRawDb(store);
    const version = getSchemaVersion(db);
    expect(version).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("runMigrations brings a zeroed db to CURRENT_SCHEMA_VERSION", () => {
    const db = getRawDb(store);
    db.exec("DROP TABLE IF EXISTS schema_version");

    const result = runMigrations(db, dbPath);

    expect(result.toVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.migrationsRun).toBeGreaterThan(0);
    expect(getSchemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("running migrations twice is idempotent", () => {
    const db = getRawDb(store);
    db.exec("DROP TABLE IF EXISTS schema_version");

    runMigrations(db, dbPath);
    const second = runMigrations(db, dbPath);

    expect(second.migrationsRun).toBe(0);
    expect(second.fromVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(second.toVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(getSchemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("schema_version table contains the correct version after migration", () => {
    const db = getRawDb(store);
    db.exec("DROP TABLE IF EXISTS schema_version");

    runMigrations(db, dbPath);

    expect(getSchemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("engram_config table exists after migration 6", () => {
    const db = getRawDb(store);
    const result = db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='engram_config'"
    );
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].values[0][0]).toBe("engram_config");
  });

  it("backup file is created when migrating an existing db at version 5", () => {
    const db = getRawDb(store);

    // Simulate state: version 5 already applied
    db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
    db.exec("DELETE FROM schema_version");
    db.run("INSERT INTO schema_version (version) VALUES (?)", [5]);

    // Persist to disk so dbPath exists physically
    store.save();

    const result = runMigrations(db, dbPath);

    expect(result.fromVersion).toBe(5);
    expect(result.toVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.backedUp).toBe(true);
    expect(existsSync(`${dbPath}.bak-v5`)).toBe(true);
  });

  // ── v3.0 migration 8 — bi-temporal mistake validity ────────────────────
  describe("migration 8: bi-temporal mistake validity", () => {
    it("nodes table has valid_until + invalidated_by_commit columns after migration", () => {
      const db = getRawDb(store);
      const result = db.exec("PRAGMA table_info(nodes)");
      const columnNames = (result[0]?.values ?? []).map((row) => row[1] as string);
      expect(columnNames).toContain("valid_until");
      expect(columnNames).toContain("invalidated_by_commit");
    });

    it("idx_nodes_validity exists after migration", () => {
      const db = getRawDb(store);
      const result = db.exec(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_nodes_validity'"
      );
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].values[0][0]).toBe("idx_nodes_validity");
    });
  });
});
