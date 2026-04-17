/**
 * Schema versioning and migration runner for engram's SQLite graph store.
 *
 * Migrations are append-only and idempotent. Each numbered entry runs exactly
 * once, tracked via the `schema_version` table. A backup of the database is
 * created before the first real migration run.
 */
import { existsSync, copyFileSync } from "node:fs";

export interface MigrationResult {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly migrationsRun: number;
  readonly backedUp: boolean;
}

/** Current schema version — bump this when adding new migrations. */
export const CURRENT_SCHEMA_VERSION = 6;

/**
 * Migration definitions — each runs only once, in order.
 * Migrations 1-5 are retroactive: they document the existing schema using
 * CREATE TABLE IF NOT EXISTS so they are safe to run on existing databases.
 */
const MIGRATIONS: Record<number, string> = {
  // v0.1.0: Initial schema
  1: `
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  source_file TEXT NOT NULL DEFAULT '',
  source_location TEXT,
  confidence TEXT NOT NULL DEFAULT 'EXTRACTED',
  confidence_score REAL NOT NULL DEFAULT 1.0,
  last_verified INTEGER NOT NULL DEFAULT 0,
  query_count INTEGER NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS edges (
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  relation TEXT NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'EXTRACTED',
  confidence_score REAL NOT NULL DEFAULT 1.0,
  source_file TEXT NOT NULL DEFAULT '',
  source_location TEXT,
  last_verified INTEGER NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (source, target, relation)
);
CREATE TABLE IF NOT EXISTS stats (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);`,

  // v0.2.0: Mistake memory — uses existing nodes table, no schema change
  2: `SELECT 1;`,

  // v0.2.0: Skills miner — uses concept nodes with metadata.subkind, no schema change
  3: `SELECT 1;`,

  // v0.3.0: Hook log — stored in JSONL file, not SQLite
  4: `SELECT 1;`,

  // v0.5.0: Provider cache
  5: `
CREATE TABLE IF NOT EXISTS provider_cache (
  provider TEXT NOT NULL,
  file_path TEXT NOT NULL,
  content TEXT NOT NULL,
  query_used TEXT NOT NULL DEFAULT '',
  cached_at INTEGER NOT NULL,
  ttl INTEGER NOT NULL DEFAULT 3600,
  PRIMARY KEY (provider, file_path)
);`,

  // v1.0.0: Config table for auto-tuning
  6: `
CREATE TABLE IF NOT EXISTS engram_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);`,
};

type ExecDb = { exec: (sql: string) => Array<{ values: unknown[][] }> };
type RunDb = { exec: (sql: string) => unknown; run: (sql: string, params?: unknown[]) => unknown };

/**
 * Returns the current schema version recorded in the database.
 * Returns 0 if the schema_version table does not exist (fresh database).
 */
export function getSchemaVersion(db: ExecDb): number {
  try {
    const result = db.exec("SELECT version FROM schema_version LIMIT 1");
    if (result.length > 0 && result[0].values.length > 0) {
      return result[0].values[0][0] as number;
    }
  } catch {
    // Table does not exist — version 0
  }
  return 0;
}

/**
 * Runs all pending migrations against the given sql.js database instance.
 * Creates a versioned backup before migrating if the database file exists
 * and the current version is greater than 0.
 */
export function runMigrations(db: RunDb, dbPath: string): MigrationResult {
  const fromVersion = getSchemaVersion(db as unknown as ExecDb);

  if (fromVersion >= CURRENT_SCHEMA_VERSION) {
    return { fromVersion, toVersion: fromVersion, migrationsRun: 0, backedUp: false };
  }

  // Backup before migrating if the file already exists and has data
  let backedUp = false;
  if (existsSync(dbPath) && fromVersion > 0) {
    const backupPath = `${dbPath}.bak-v${fromVersion}`;
    try {
      copyFileSync(dbPath, backupPath);
      backedUp = true;
    } catch {
      // Backup failed — continue anyway (data is still in the original file)
    }
  }

  // Ensure the schema_version table exists
  (db as unknown as ExecDb).exec(
    `CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`
  );

  // Run each pending migration in order
  let migrationsRun = 0;
  for (let v = fromVersion + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
    const sql = MIGRATIONS[v];
    if (sql) {
      (db as unknown as ExecDb).exec(sql);
      migrationsRun++;
    }
  }

  // Persist the new version
  (db as unknown as ExecDb).exec(`DELETE FROM schema_version`);
  db.run(`INSERT INTO schema_version (version) VALUES (?)`, [CURRENT_SCHEMA_VERSION]);

  return { fromVersion, toVersion: CURRENT_SCHEMA_VERSION, migrationsRun, backedUp };
}
