/**
 * SQLite-backed persistent graph store using sql.js (pure JS, zero native deps).
 * Stores nodes and edges with confidence tagging, temporal staleness, and query frequency.
 */
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { runMigrations } from "../db/migrate.js";
import type {
  Confidence,
  EdgeRelation,
  GraphEdge,
  GraphNode,
  GraphStats,
  NodeKind,
} from "./schema.js";
import type { CachedContext } from "../providers/types.js";

export class GraphStore {
  private db: SqlJsDatabase;
  private readonly dbPath: string;

  private constructor(db: SqlJsDatabase, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
    this.migrate();
  }

  static async open(dbPath: string): Promise<GraphStore> {
    mkdirSync(dirname(dbPath), { recursive: true });
    const SQL = await initSqlJs();
    let db: SqlJsDatabase;
    if (existsSync(dbPath)) {
      const buffer = readFileSync(dbPath);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }
    return new GraphStore(db, dbPath);
  }

  private migrate(): void {
    this.db.run(`
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
      );

      CREATE TABLE IF NOT EXISTS provider_cache (
        provider TEXT NOT NULL,
        file_path TEXT NOT NULL,
        content TEXT NOT NULL,
        query_used TEXT NOT NULL DEFAULT '',
        cached_at INTEGER NOT NULL,
        ttl INTEGER NOT NULL DEFAULT 3600,
        PRIMARY KEY (provider, file_path)
      );
    `);
    // Indexes (ignore errors if they already exist)
    const indexes = [
      "CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind)",
      "CREATE INDEX IF NOT EXISTS idx_nodes_source_file ON nodes(source_file)",
      "CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source)",
      "CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target)",
      "CREATE INDEX IF NOT EXISTS idx_edges_relation ON edges(relation)",
      "CREATE INDEX IF NOT EXISTS idx_edges_source_file ON edges(source_file)",
      "CREATE INDEX IF NOT EXISTS idx_cache_file ON provider_cache(file_path)",
      "CREATE INDEX IF NOT EXISTS idx_cache_stale ON provider_cache(cached_at)",
    ];
    for (const sql of indexes) {
      try { this.db.run(sql); } catch { /* already exists */ }
    }
    runMigrations(this.db, this.dbPath);
  }

  save(): void {
    const data = this.db.export();
    writeFileSync(this.dbPath, Buffer.from(data));
  }

  upsertNode(node: GraphNode, defaults?: { projectRoot?: string; projectBranch?: string; memoryScope?: string }): void {
    const projectRoot = (node as any).projectRoot ?? defaults?.projectRoot ?? "";
    const projectBranch = (node as any).projectBranch ?? defaults?.projectBranch ?? null;
    const memoryScope = (node as any).memoryScope ?? defaults?.memoryScope ?? null;

    this.db.run(
      `INSERT OR REPLACE INTO nodes (id, label, kind, source_file, source_location, confidence, confidence_score, last_verified, query_count, metadata, valid_until, invalidated_by_commit, project_root, project_branch, memory_scope)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        node.id,
        node.label,
        node.kind,
        node.sourceFile,
        node.sourceLocation,
        node.confidence,
        node.confidenceScore,
        node.lastVerified,
        node.queryCount,
        JSON.stringify(node.metadata),
        node.validUntil ?? null,
        node.invalidatedByCommit ?? null,
        projectRoot,
        projectBranch,
        memoryScope,
      ]
    );
  }

  upsertEdge(edge: GraphEdge, defaults?: { projectRoot?: string }): void {
    const projectRoot = (edge as any).projectRoot ?? defaults?.projectRoot ?? "";
    this.db.run(
      `INSERT OR REPLACE INTO edges (source, target, relation, confidence, confidence_score, source_file, source_location, last_verified, metadata, project_root)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        edge.source,
        edge.target,
        edge.relation,
        edge.confidence,
        edge.confidenceScore,
        edge.sourceFile,
        edge.sourceLocation,
        edge.lastVerified,
        JSON.stringify(edge.metadata),
        projectRoot,
      ]
    );
  }

  /**
   * Remove all nodes and edges associated with a specific source file.
   * If projectRoot is provided, only clears nodes/edges for that project.
   * Used by the file watcher for incremental re-indexing — old nodes for
   * a changed file are cleared before re-extracting.
   */
  deleteBySourceFile(sourceFile: string, projectRoot?: string): void {
    this.db.run("BEGIN TRANSACTION");
    try {
      if (projectRoot) {
        this.db.run("DELETE FROM edges WHERE source_file = ? AND project_root = ?", [sourceFile, projectRoot]);
        this.db.run("DELETE FROM nodes WHERE source_file = ? AND project_root = ?", [sourceFile, projectRoot]);
      } else {
        this.db.run("DELETE FROM edges WHERE source_file = ?", [sourceFile]);
        this.db.run("DELETE FROM nodes WHERE source_file = ?", [sourceFile]);
      }
      this.db.run("COMMIT");
    } catch (e) {
      this.db.run("ROLLBACK");
      throw e;
    }
  }

  countBySourceFile(sourceFile: string, projectRoot?: string): number {
    const sql = projectRoot
      ? "SELECT COUNT(*) AS n FROM nodes WHERE source_file = ? AND project_root = ?"
      : "SELECT COUNT(*) AS n FROM nodes WHERE source_file = ?";
    const stmt = this.db.prepare(sql);
    if (projectRoot) stmt.bind([sourceFile, projectRoot]);
    else stmt.bind([sourceFile]);
    let count = 0;
    if (stmt.step()) {
      const row = stmt.getAsObject() as { n: number };
      count = Number(row.n) || 0;
    }
    stmt.free();
    return count;
  }

  bulkUpsert(nodes: GraphNode[], edges: GraphEdge[], projectRoot?: string, projectBranch?: string, memoryScope?: string): void {
    this.db.run("BEGIN TRANSACTION");
    for (const node of nodes) this.upsertNode(node, { projectRoot, projectBranch, memoryScope });
    for (const edge of edges) this.upsertEdge(edge, { projectRoot });
    this.db.run("COMMIT");
    this.save();
  }

  getNode(id: string): GraphNode | null {
    const stmt = this.db.prepare("SELECT * FROM nodes WHERE id = ?");
    stmt.bind([id]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return this.rowToNode(row);
    }
    stmt.free();
    return null;
  }

  searchNodes(query: string, limit = 20, projectRoot?: string): GraphNode[] {
    const escaped = query.replace(/%/g, "\\%").replace(/_/g, "\\_");
    const pattern = `%${escaped}%`;
    const results: GraphNode[] = [];
    const sql = projectRoot
      ? "SELECT * FROM nodes WHERE (label LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\') AND project_root = ? ORDER BY query_count DESC LIMIT ?"
      : "SELECT * FROM nodes WHERE label LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\' ORDER BY query_count DESC LIMIT ?";
    const stmt = this.db.prepare(sql);
    if (projectRoot) stmt.bind([pattern, pattern, projectRoot, limit]);
    else stmt.bind([pattern, pattern, limit]);
    while (stmt.step()) {
      results.push(this.rowToNode(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  getNeighbors(
    nodeId: string,
    relationFilter?: EdgeRelation,
    projectRoot?: string
  ): Array<{ node: GraphNode; edge: GraphEdge }> {
    const sql = relationFilter
      ? projectRoot
        ? "SELECT * FROM edges WHERE (source = ? OR target = ?) AND relation = ? AND project_root = ?"
        : "SELECT * FROM edges WHERE (source = ? OR target = ?) AND relation = ?"
      : projectRoot
        ? "SELECT * FROM edges WHERE (source = ? OR target = ?) AND project_root = ?"
        : "SELECT * FROM edges WHERE source = ? OR target = ?";
    const params = relationFilter
      ? projectRoot
        ? [nodeId, nodeId, relationFilter, projectRoot]
        : [nodeId, nodeId, relationFilter]
      : projectRoot
        ? [nodeId, nodeId, projectRoot]
        : [nodeId, nodeId];

    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const results: Array<{ node: GraphNode; edge: GraphEdge }> = [];
    while (stmt.step()) {
      const edge = this.rowToEdge(stmt.getAsObject());
      const neighborId = edge.source === nodeId ? edge.target : edge.source;
      const node = this.getNode(neighborId);
      if (node) results.push({ node, edge });
    }
    stmt.free();
    return results;
  }

  getGodNodes(topN = 10, projectRoot?: string): Array<{ node: GraphNode; degree: number }> {
    const results: Array<{ node: GraphNode; degree: number }> = [];
    // Exclude structural plumbing (file/import/module) AND concept nodes.
    // The `concept` kind is used by the skills-miner for both skills and
    // keyword nodes — a keyword like "landing page" may have hundreds of
    // triggered_by edges but isn't a "core abstraction" of the codebase.
    // Users want real code entities + decisions/patterns/mistakes here.
    const sql = projectRoot
      ? `SELECT n.*, COUNT(*) as degree
         FROM nodes n
         JOIN edges e ON e.source = n.id OR e.target = n.id
         WHERE n.kind NOT IN ('file', 'import', 'module', 'concept') AND n.project_root = ?
         GROUP BY n.id
         ORDER BY degree DESC
         LIMIT ?`
      : `SELECT n.*, COUNT(*) as degree
         FROM nodes n
         JOIN edges e ON e.source = n.id OR e.target = n.id
         WHERE n.kind NOT IN ('file', 'import', 'module', 'concept')
         GROUP BY n.id
         ORDER BY degree DESC
         LIMIT ?`;
    const stmt = this.db.prepare(sql);
    if (projectRoot) stmt.bind([projectRoot, topN]);
    else stmt.bind([topN]);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push({
        node: this.rowToNode(row),
        degree: row.degree as number,
      });
    }
    stmt.free();
    return results;
  }

  getNodesByFile(sourceFile: string, limit = 500, projectRoot?: string): GraphNode[] {
    const results: GraphNode[] = [];
    const sql = projectRoot
      ? "SELECT * FROM nodes WHERE source_file = ? AND project_root = ? LIMIT ?"
      : "SELECT * FROM nodes WHERE source_file = ? LIMIT ?";
    const stmt = this.db.prepare(sql);
    if (projectRoot) stmt.bind([sourceFile, projectRoot, limit]);
    else stmt.bind([sourceFile, limit]);
    while (stmt.step()) {
      results.push(this.rowToNode(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  getEdgesForNodes(nodeIds: string[], projectRoot?: string): GraphEdge[] {
    if (nodeIds.length === 0) return [];
    // Chunk to stay under SQLite's SQLITE_LIMIT_VARIABLE_NUMBER (999).
    // Each chunk binds chunk.length * 2 params (source IN + target IN).
    const CHUNK = 400;
    const seen = new Set<string>();
    const results: GraphEdge[] = [];
    for (let i = 0; i < nodeIds.length; i += CHUNK) {
      const chunk = nodeIds.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => "?").join(",");
      let sql = `SELECT * FROM edges WHERE source IN (${placeholders}) OR target IN (${placeholders})`;
      if (projectRoot) sql = `SELECT * FROM edges WHERE (source IN (${placeholders}) OR target IN (${placeholders})) AND project_root = ?`;
      const stmt = this.db.prepare(sql);
      if (projectRoot) stmt.bind([...chunk, ...chunk, projectRoot]);
      else stmt.bind([...chunk, ...chunk]);
      while (stmt.step()) {
        const edge = this.rowToEdge(stmt.getAsObject());
        const key = `${edge.source}|${edge.target}|${edge.relation}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push(edge);
        }
      }
      stmt.free();
    }
    return results;
  }

  getAllNodes(projectRoot?: string): GraphNode[] {
    const results: GraphNode[] = [];
    const sql = projectRoot ? "SELECT * FROM nodes WHERE project_root = ?" : "SELECT * FROM nodes";
    const stmt = this.db.prepare(sql);
    if (projectRoot) stmt.bind([projectRoot]);
    while (stmt.step()) {
      results.push(this.rowToNode(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  getAllEdges(): GraphEdge[] {
    const results: GraphEdge[] = [];
    const stmt = this.db.prepare("SELECT * FROM edges");
    while (stmt.step()) {
      results.push(this.rowToEdge(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  incrementQueryCount(nodeId: string): void {
    this.db.run(
      "UPDATE nodes SET query_count = query_count + 1 WHERE id = ?",
      [nodeId]
    );
  }

  getStats(projectRoot?: string): GraphStats {
    // Helper to encode project stat keys
    const encodeProjectKey = (p: string, k: string) => `project:${Buffer.from(p).toString("base64")}:${k}`;

    const nodeCount = projectRoot
      ? (this.db.exec("SELECT COUNT(*) FROM nodes WHERE project_root = ?", [projectRoot])[0]?.values[0]?.[0] as number) ?? 0
      : (this.db.exec("SELECT COUNT(*) FROM nodes")[0]?.values[0]?.[0] as number) ?? 0;
    const edgeCount = projectRoot
      ? (this.db.exec("SELECT COUNT(*) FROM edges WHERE project_root = ?", [projectRoot])[0]?.values[0]?.[0] as number) ?? 0
      : (this.db.exec("SELECT COUNT(*) FROM edges")[0]?.values[0]?.[0] as number) ?? 0;

    const confSql = projectRoot
      ? "SELECT confidence, COUNT(*) as c FROM edges WHERE project_root = ? GROUP BY confidence"
      : "SELECT confidence, COUNT(*) as c FROM edges GROUP BY confidence";
    const confRows = projectRoot ? this.db.exec(confSql, [projectRoot]) : this.db.exec(confSql);

    const total = edgeCount || 1;
    const confMap: Record<string, number> = {};
    if (confRows[0]) {
      for (const row of confRows[0].values) {
        confMap[row[0] as string] = row[1] as number;
      }
    }

    // Stats table: for project-scoped values we use namespaced keys
    const savedKey = projectRoot ? encodeProjectKey(projectRoot, "tokens_saved") : "tokens_saved";
    const lastMinedKey = projectRoot ? encodeProjectKey(projectRoot, "last_mined") : "last_mined";

    const savedRow = this.db.exec("SELECT value FROM stats WHERE key = ?", [savedKey]);
    const lastMinedRow = this.db.exec("SELECT value FROM stats WHERE key = ?", [lastMinedKey]);

    return {
      nodes: nodeCount,
      edges: edgeCount,
      communities: 0,
      extractedPct: Math.round(((confMap["EXTRACTED"] ?? 0) / total) * 100),
      inferredPct: Math.round(((confMap["INFERRED"] ?? 0) / total) * 100),
      ambiguousPct: Math.round(((confMap["AMBIGUOUS"] ?? 0) / total) * 100),
      lastMined: lastMinedRow[0] ? Number(lastMinedRow[0].values[0][0]) : 0,
      totalQueryTokensSaved: savedRow[0] ? Number(savedRow[0].values[0][0]) : 0,
    };
  }

  getStat(key: string): string | null {
    const stmt = this.db.prepare("SELECT value FROM stats WHERE key = ?");
    stmt.bind([key]);
    if (stmt.step()) {
      const val = stmt.getAsObject().value as string;
      stmt.free();
      return val;
    }
    stmt.free();
    return null;
  }

  getStatNum(key: string): number {
    const val = this.getStat(key);
    return val ? Number(val) : 0;
  }

  setStat(key: string, value: string): void {
    this.db.run(
      "INSERT OR REPLACE INTO stats (key, value) VALUES (?, ?)",
      [key, value]
    );
  }

  /** Remove all nodes and edges originating from a specific source file. */
  removeNodesForFile(sourceFile: string): void {
    // Delete edges that reference nodes from this file
    this.db.run(
      `DELETE FROM edges WHERE source IN (SELECT id FROM nodes WHERE source_file = ?)
       OR target IN (SELECT id FROM nodes WHERE source_file = ?)`,
      [sourceFile, sourceFile]
    );
    this.db.run("DELETE FROM nodes WHERE source_file = ?", [sourceFile]);
  }

  clearAll(): void {
    this.db.run("DELETE FROM nodes");
    this.db.run("DELETE FROM edges");
    this.db.run("DELETE FROM stats");
    this.db.run("DELETE FROM provider_cache");
  }

  // ─── Provider Cache ─────────────────────────────────────────────

  /**
   * Get all cached provider results for a file. Returns only non-stale
   * entries (cached_at + ttl > now).
   */
  getCachedContext(filePath: string, projectRoot?: string): CachedContext[] {
    const now = Date.now();
    const results: CachedContext[] = [];
    const sql = projectRoot
      ? `SELECT * FROM provider_cache
       WHERE file_path = ? AND project_root = ? AND (cached_at + ttl * 1000) > ?`
      : `SELECT * FROM provider_cache
       WHERE file_path = ? AND (cached_at + ttl * 1000) > ?`;
    const stmt = this.db.prepare(sql);
    if (projectRoot) stmt.bind([filePath, projectRoot, now]);
    else stmt.bind([filePath, now]);
    while (stmt.step()) {
      results.push(this.rowToCachedContext(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  /**
   * Get cached context for a specific provider + file. Returns null if
   * missing or stale.
   */
  getCachedContextForProvider(
    provider: string,
    filePath: string,
    projectRoot?: string
  ): CachedContext | null {
    const now = Date.now();
    const sql = projectRoot
      ? `SELECT * FROM provider_cache
       WHERE provider = ? AND file_path = ? AND project_root = ? AND (cached_at + ttl * 1000) > ?`
      : `SELECT * FROM provider_cache
       WHERE provider = ? AND file_path = ? AND (cached_at + ttl * 1000) > ?`;
    const stmt = this.db.prepare(sql);
    if (projectRoot) stmt.bind([provider, filePath, projectRoot, now]);
    else stmt.bind([provider, filePath, now]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return this.rowToCachedContext(row);
    }
    stmt.free();
    return null;
  }

  /**
   * Upsert a single cached provider result.
   */
  setCachedContext(
    provider: string,
    filePath: string,
    content: string,
    ttl: number,
    queryUsed = "",
    projectRoot?: string
  ): void {
    if (projectRoot) {
      this.db.run(
        `INSERT OR REPLACE INTO provider_cache
         (provider, file_path, content, query_used, cached_at, ttl, project_root)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [provider, filePath, content, queryUsed, Date.now(), ttl, projectRoot]
      );
    } else {
      this.db.run(
        `INSERT OR REPLACE INTO provider_cache
         (provider, file_path, content, query_used, cached_at, ttl, project_root)
         VALUES (?, ?, ?, ?, ?, ?, '')`,
        [provider, filePath, content, queryUsed, Date.now(), ttl]
      );
    }
  }

  /**
   * Bulk insert/replace cache entries for a provider. Uses a transaction
   * for performance. Called by provider warmup at SessionStart.
   */
  warmCache(
    provider: string,
    entries: ReadonlyArray<{ filePath: string; content: string }>,
    ttl: number,
    queryUsed = "",
    projectRoot?: string
  ): void {
    if (entries.length === 0) return;
    this.db.run("BEGIN TRANSACTION");
    try {
      for (const entry of entries) {
        if (projectRoot) {
          this.db.run(
            `INSERT OR REPLACE INTO provider_cache
             (provider, file_path, content, query_used, cached_at, ttl, project_root)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [provider, entry.filePath, entry.content, queryUsed, Date.now(), ttl, projectRoot]
          );
        } else {
          this.db.run(
            `INSERT OR REPLACE INTO provider_cache
             (provider, file_path, content, query_used, cached_at, ttl, project_root)
             VALUES (?, ?, ?, ?, ?, ?, '')`,
            [provider, entry.filePath, entry.content, queryUsed, Date.now(), ttl]
          );
        }
      }
      this.db.run("COMMIT");
      this.save();
    } catch (e) {
      this.db.run("ROLLBACK");
      throw e;
    }
  }

  /**
   * Remove all stale cache entries. Called at SessionStart before warmup.
   */
  pruneStaleCache(projectRoot?: string): number {
    const now = Date.now();
    if (projectRoot) {
      this.db.run(
        "DELETE FROM provider_cache WHERE project_root = ? AND (cached_at + ttl * 1000) <= ?",
        [projectRoot, now]
      );
    } else {
      this.db.run(
        "DELETE FROM provider_cache WHERE (cached_at + ttl * 1000) <= ?",
        [now]
      );
    }
    const result = this.db.exec("SELECT changes()");
    return (result[0]?.values[0]?.[0] as number) ?? 0;
  }

  /**
   * Remove all cache entries for a provider. Used when a provider is
   * disabled or its configuration changes.
   */
  clearProviderCache(provider: string, projectRoot?: string): void {
    if (projectRoot) this.db.run("DELETE FROM provider_cache WHERE provider = ? AND project_root = ?", [provider, projectRoot]);
    else this.db.run("DELETE FROM provider_cache WHERE provider = ?", [provider]);
  }

  /**
   * Get count of cached entries per provider.
   */
  getCacheStats(projectRoot?: string): Array<{ provider: string; count: number; stale: number }> {
    const now = Date.now();
    const results: Array<{ provider: string; count: number; stale: number }> = [];
    const stmt = this.db.prepare(
      projectRoot
        ? `SELECT provider,
              COUNT(*) as total,
              SUM(CASE WHEN (cached_at + ttl * 1000) <= ? THEN 1 ELSE 0 END) as stale
         FROM provider_cache WHERE project_root = ?
         GROUP BY provider`
        : `SELECT provider,
              COUNT(*) as total,
              SUM(CASE WHEN (cached_at + ttl * 1000) <= ? THEN 1 ELSE 0 END) as stale
         FROM provider_cache
         GROUP BY provider`
    );
    if (projectRoot) stmt.bind([now, projectRoot]);
    else stmt.bind([now]);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push({
        provider: row.provider as string,
        count: row.total as number,
        stale: row.stale as number,
      });
    }
    stmt.free();
    return results;
  }

  private rowToCachedContext(row: Record<string, unknown>): CachedContext {
    return {
      provider: (row.provider as string) ?? "",
      filePath: (row.file_path as string) ?? "",
      content: (row.content as string) ?? "",
      queryUsed: (row.query_used as string) ?? "",
      cachedAt: (row.cached_at as number) ?? 0,
      ttl: (row.ttl as number) ?? 3600,
    };
  }

  // ─── Low-level DB access (for cache module) ──────────────────

  /** Run raw SQL (DDL, DML). For cache table creation and updates. */
  runSql(sql: string, params?: unknown[]): void {
    if (params && params.length > 0) {
      const stmt = this.db.prepare(sql);
      stmt.bind(params as (string | number | null)[]);
      stmt.step();
      stmt.free();
    } else {
      this.db.run(sql);
    }
  }

  /** Prepare a statement for row-by-row iteration. Caller must free(). */
  prepare(sql: string): ReturnType<SqlJsDatabase["prepare"]> {
    return this.db.prepare(sql);
  }

  // ─── Lifecycle ────────────────────────────────────────────────

  close(): void {
    this.save();
    this.db.close();
  }

  private rowToNode(row: Record<string, unknown>): GraphNode {
    const validUntilRaw = row.valid_until;
    const invalidatedByRaw = row.invalidated_by_commit;
    const meta = JSON.parse((row.metadata as string) || "{}");
    // Project scoping fields exposed in metadata for convenience.
    (meta as Record<string, unknown>).projectRoot = (row.project_root as string) ?? "";
    (meta as Record<string, unknown>).projectBranch = (row.project_branch as string) ?? null;
    (meta as Record<string, unknown>).memoryScope = (row.memory_scope as string) ?? null;

    return {
      id: row.id as string,
      label: row.label as string,
      kind: row.kind as NodeKind,
      sourceFile: (row.source_file as string) ?? "",
      sourceLocation: (row.source_location as string) ?? null,
      confidence: (row.confidence as Confidence) ?? "EXTRACTED",
      confidenceScore: (row.confidence_score as number) ?? 1.0,
      lastVerified: (row.last_verified as number) ?? 0,
      queryCount: (row.query_count as number) ?? 0,
      metadata: meta,
      validUntil:
        validUntilRaw === null || validUntilRaw === undefined
          ? undefined
          : (validUntilRaw as number),
      invalidatedByCommit:
        invalidatedByRaw === null || invalidatedByRaw === undefined
          ? undefined
          : (invalidatedByRaw as string),
    };
  }

  private rowToEdge(row: Record<string, unknown>): GraphEdge {
    const meta = JSON.parse((row.metadata as string) || "{}");
    (meta as Record<string, unknown>).projectRoot = (row.project_root as string) ?? "";

    return {
      source: row.source as string,
      target: row.target as string,
      relation: row.relation as EdgeRelation,
      confidence: (row.confidence as Confidence) ?? "EXTRACTED",
      confidenceScore: (row.confidence_score as number) ?? 1.0,
      sourceFile: (row.source_file as string) ?? "",
      sourceLocation: (row.source_location as string) ?? null,
      lastVerified: (row.last_verified as number) ?? 0,
      metadata: meta,
    };
  }
}
