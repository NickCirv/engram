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
export const CURRENT_SCHEMA_VERSION = 10;

export interface RollbackResult {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly migrationsReverted: number;
  readonly backedUp: boolean;
}

/**
 * Down migrations — reverse of `MIGRATIONS`.
 * Only migrations that create new tables or columns have a DOWN migration.
 * No-op migrations (SELECT 1) have no-op rollbacks. Dropping tables is
 * destructive — we always back up the DB first.
 *
 * Callers MUST explicitly request rollback via `rollback()` below; it's never
 * automatic. Forward migrations are append-only and idempotent.
 */
const DOWN_MIGRATIONS: Record<number, string> = {
  // v3.0: bi-temporal mistake validity. SQLite only added DROP COLUMN in
  // 3.35 (2021); older sql.js builds may not support it. We don't depend
  // on the columns being absent — leaving them in place is safe. The index
  // CAN be dropped cleanly.
  8: `DROP INDEX IF EXISTS idx_nodes_validity;`,
  7: `DROP TABLE IF EXISTS query_cache; DROP TABLE IF EXISTS pattern_cache;`,
  6: `DROP TABLE IF EXISTS engram_config;`,
  5: `DROP TABLE IF EXISTS provider_cache;`,
  4: `SELECT 1;`, // hook-log is JSONL, no SQL rollback
  3: `SELECT 1;`, // skills miner — no schema change
  2: `SELECT 1;`, // mistake memory — no schema change
  // 1 → 0 drops the entire schema. We require `engram init` for that.
  1: `DROP TABLE IF EXISTS stats; DROP TABLE IF EXISTS edges; DROP TABLE IF EXISTS nodes;`,
};

/**
 * A migration step is either:
 *  - a SQL string (run verbatim — must be self-idempotent, e.g. CREATE TABLE
 *    IF NOT EXISTS) — used for migrations 1-7
 *  - a function that receives the db handle and runs custom logic, used when
 *    SQLite syntax isn't natively idempotent (e.g. ALTER TABLE ADD COLUMN
 *    raises 'duplicate column name' on re-run)
 */
type MigrationStep =
  | string
  | ((db: ExecDb) => void);

/**
 * Add a column to an existing table only if it isn't already present.
 * SQLite (pre-3.35) has no ADD COLUMN IF NOT EXISTS, so we check
 * PRAGMA table_info first. Safe to re-run.
 */
function addColumnIfMissing(
  db: ExecDb,
  table: string,
  column: string,
  ddl: string
): void {
  const result = db.exec(`PRAGMA table_info(${table})`);
  const existing = (result[0]?.values ?? []).map((row) => row[1] as string);
  if (!existing.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

/**
 * Migration definitions — each runs only once, in order.
 * Migrations 1-5 are retroactive: they document the existing schema using
 * CREATE TABLE IF NOT EXISTS so they are safe to run on existing databases.
 */
const MIGRATIONS: Record<number, MigrationStep> = {
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

  // v2.0.0: Memory cache tables — query_cache + pattern_cache
  7: `
CREATE TABLE IF NOT EXISTS query_cache (
  key TEXT PRIMARY KEY,
  result TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_mtime REAL NOT NULL,
  created_at INTEGER NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pattern_cache (
  pattern TEXT PRIMARY KEY,
  result TEXT NOT NULL,
  graph_version INTEGER NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_query_cache_file ON query_cache(file_path);`,

  // v3.0.0: Bi-temporal validity for mistake nodes (and any other node kind
  // that wants it). `valid_until` is the unix-ms timestamp after which the
  // mistake should NO LONGER surface in context (e.g. the referenced code
  // was refactored away). NULL = still valid (back-compat default for all
  // existing rows). `invalidated_by_commit` records the git SHA that caused
  // the invalidation, for audit + future "explain why this mistake stopped
  // firing" UX. Index is partial — only mistakes with an explicit validity
  // window pay storage cost.
  //
  // Function-based because ALTER TABLE ADD COLUMN isn't idempotent in
  // SQLite — re-running on a db that already has the columns throws
  // 'duplicate column name'. We pre-check via PRAGMA table_info.
  8: (db: ExecDb) => {
    addColumnIfMissing(db, "nodes", "valid_until", "valid_until INTEGER");
    addColumnIfMissing(db, "nodes", "invalidated_by_commit", "invalidated_by_commit TEXT");
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_nodes_validity
        ON nodes(kind, valid_until)
        WHERE kind = 'mistake' AND valid_until IS NOT NULL;
    `);
  },

  // v3.1.0: project scoping — add project_root/project_branch/memory_scope
  // columns so a single global DB can host multiple projects' data and
  // memory types (project/global/entity). Backfill is optional — new
  // rows will populate these columns automatically.
  9: (db: ExecDb) => {
    addColumnIfMissing(db, "nodes", "project_root", "project_root TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing(db, "nodes", "project_branch", "project_branch TEXT");
    addColumnIfMissing(db, "nodes", "memory_scope", "memory_scope TEXT");

    addColumnIfMissing(db, "edges", "project_root", "project_root TEXT NOT NULL DEFAULT ''");

    // Add project_root to provider_cache so caches can be scoped per project
    addColumnIfMissing(db, "provider_cache", "project_root", "project_root TEXT NOT NULL DEFAULT ''");

    // Index project_root on nodes/edges/provider_cache for efficient per-project queries
    try { db.exec("CREATE INDEX IF NOT EXISTS idx_nodes_project_root ON nodes(project_root)"); } catch {}
    try { db.exec("CREATE INDEX IF NOT EXISTS idx_edges_project_root ON edges(project_root)"); } catch {}
    try { db.exec("CREATE INDEX IF NOT EXISTS idx_provider_cache_project_root ON provider_cache(project_root)"); } catch {}
  },

  // v3.2.0: canonical ids for deterministic dedupe + migration to merge existing duplicates
  10: (db: ExecDb) => {
    addColumnIfMissing(db, "nodes", "canonical_id", "canonical_id TEXT");
    try { db.exec("CREATE INDEX IF NOT EXISTS idx_nodes_canonical_project ON nodes(canonical_id, project_root)"); } catch {}

    // Compute canonical ids for existing nodes and backfill
    try {
      // Import computeCanonicalId dynamically so migrations are self-contained
      const { computeCanonicalId } = require("../graph/canonical.js");
      const res = db.exec("SELECT id, label, kind, memory_scope, project_root FROM nodes");
      const rows = (res[0] && res[0].values) ? res[0].values : [];
      for (const r of rows) {
        const id = String(r[0] ?? "");
        const label = String(r[1] ?? "");
        const kind = String(r[2] ?? "");
        const memoryScope = r[3] ?? "project";
        const projectRoot = r[4] ?? "";
        const canonical = computeCanonicalId(label, kind, memoryScope, projectRoot);
        try {
          // Use parameterized run when available
          (db as unknown as RunDb).run("UPDATE nodes SET canonical_id = ? WHERE id = ?", [canonical, id]);
        } catch {
          try { db.exec(`UPDATE nodes SET canonical_id = '${String(canonical).replace(/'/g, "''")}' WHERE id = '${String(id).replace(/'/g, "''")}'`); } catch {}
        }
      }

      // Find canonical groups with >1 member and merge duplicates
      const groups = db.exec("SELECT canonical_id, project_root FROM nodes WHERE canonical_id IS NOT NULL AND canonical_id <> '' GROUP BY canonical_id, project_root HAVING COUNT(*) > 1");
      const gvals = (groups[0] && groups[0].values) ? groups[0].values : [];
      for (const gv of gvals) {
        const canonical = String(gv[0]);
        const proj = String(gv[1] ?? "");
        const selSql = `SELECT id FROM nodes WHERE canonical_id = '${String(canonical).replace(/'/g, "''")}' AND project_root = '${String(proj).replace(/'/g, "''")}' ORDER BY confidence_score DESC, last_verified DESC`;
        const sel = db.exec(selSql);
        const nrows = (sel[0] && sel[0].values) ? sel[0].values.map((v) => String(v[0])) : [];
        if (nrows.length <= 1) continue;
        const primary = nrows[0];
        const duplicates = nrows.slice(1);

        for (const dup of duplicates) {
          try {
            // Re-insert source edges with primary as source (INSERT OR IGNORE)
            const srcEdges = db.exec(`SELECT source, target, relation, confidence, confidence_score, source_file, source_location, last_verified, metadata, project_root FROM edges WHERE source = '${String(dup).replace(/'/g, "''")}'`);
            const srcVals = (srcEdges[0] && srcEdges[0].values) ? srcEdges[0].values : [];
            for (const e of srcVals) {
              const [_s, target, relation, confidence, confidence_score, source_file, source_location, last_verified, metadata, edge_proj] = e;
              try {
                (db as unknown as RunDb).run(
                  `INSERT OR IGNORE INTO edges (source, target, relation, confidence, confidence_score, source_file, source_location, last_verified, metadata, project_root) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [primary, target, relation, confidence, confidence_score, source_file, source_location, last_verified, metadata, edge_proj]
                );
              } catch { /* best-effort */ }
            }

            // Re-insert target edges with primary as target
            const tgtEdges = db.exec(`SELECT source, target, relation, confidence, confidence_score, source_file, source_location, last_verified, metadata, project_root FROM edges WHERE target = '${String(dup).replace(/'/g, "''")}'`);
            const tgtVals = (tgtEdges[0] && tgtEdges[0].values) ? tgtEdges[0].values : [];
            for (const e of tgtVals) {
              const [source, _t, relation, confidence, confidence_score, source_file, source_location, last_verified, metadata, edge_proj] = e;
              try {
                (db as unknown as RunDb).run(
                  `INSERT OR IGNORE INTO edges (source, target, relation, confidence, confidence_score, source_file, source_location, last_verified, metadata, project_root) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [source, primary, relation, confidence, confidence_score, source_file, source_location, last_verified, metadata, edge_proj]
                );
              } catch { /* best-effort */ }
            }

            // Remove old edges referencing the duplicate
            try {
              (db as unknown as RunDb).run("DELETE FROM edges WHERE source = ? OR target = ?", [dup, dup]);
            } catch { db.exec(`DELETE FROM edges WHERE source = '${String(dup).replace(/'/g, "''")}' OR target = '${String(dup).replace(/'/g, "''")}'`); }

            // Finally remove the duplicate node
            try {
              (db as unknown as RunDb).run("DELETE FROM nodes WHERE id = ?", [dup]);
            } catch { db.exec(`DELETE FROM nodes WHERE id = '${String(dup).replace(/'/g, "''")}'`); }
          } catch {
            // continue on error for best-effort merging
          }
        }
      }
    } catch (e) {
      // Best-effort migration: if any of the merge steps fail, we don't
      // want to abort the whole migration run. The canonical_id column
      // still exists and the system will continue to operate.
    }
  },
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
    const step = MIGRATIONS[v];
    if (step) {
      if (typeof step === "string") {
        (db as unknown as ExecDb).exec(step);
      } else {
        step(db as unknown as ExecDb);
      }
      migrationsRun++;
    }
  }

  // Persist the new version
  (db as unknown as ExecDb).exec(`DELETE FROM schema_version`);
  db.run(`INSERT INTO schema_version (version) VALUES (?)`, [CURRENT_SCHEMA_VERSION]);

  return { fromVersion, toVersion: CURRENT_SCHEMA_VERSION, migrationsRun, backedUp };
}

/**
 * Revert schema to an earlier version by running DOWN migrations in reverse.
 *
 * Always creates a backup at `<dbPath>.bak-v<fromVersion>` before rolling
 * back — table drops are irreversible and a user may want to inspect the
 * backup later.
 *
 * Throws if targetVersion is out of range. Rollback to version 0 is allowed
 * and drops the entire schema.
 */
export function rollback(
  db: RunDb,
  dbPath: string,
  targetVersion: number
): RollbackResult {
  const fromVersion = getSchemaVersion(db as unknown as ExecDb);

  if (targetVersion < 0 || targetVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Invalid target version ${targetVersion}. Must be 0..${CURRENT_SCHEMA_VERSION}.`
    );
  }
  if (targetVersion > fromVersion) {
    throw new Error(
      `Cannot roll back to v${targetVersion}: current is v${fromVersion}. ` +
        `Use 'engram db migrate' to move forward.`
    );
  }
  if (targetVersion === fromVersion) {
    return {
      fromVersion,
      toVersion: fromVersion,
      migrationsReverted: 0,
      backedUp: false,
    };
  }

  // Always back up before rolling back
  let backedUp = false;
  if (existsSync(dbPath)) {
    const backupPath = `${dbPath}.bak-v${fromVersion}`;
    try {
      copyFileSync(dbPath, backupPath);
      backedUp = true;
    } catch {
      // Backup failed — continue but note it
    }
  }

  const dbExec = db as unknown as ExecDb;

  // Run down migrations from current → target, in reverse order
  let migrationsReverted = 0;
  for (let v = fromVersion; v > targetVersion; v--) {
    const sql = DOWN_MIGRATIONS[v];
    if (sql) {
      dbExec.exec(sql);
      migrationsReverted++;
    }
  }

  // Persist the new (lower) version
  if (targetVersion === 0) {
    dbExec.exec(`DROP TABLE IF EXISTS schema_version`);
  } else {
    dbExec.exec(`DELETE FROM schema_version`);
    db.run(`INSERT INTO schema_version (version) VALUES (?)`, [targetVersion]);
  }

  return {
    fromVersion,
    toVersion: targetVersion,
    migrationsReverted,
    backedUp,
  };
}
