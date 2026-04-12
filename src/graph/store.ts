/**
 * SQLite-backed persistent graph store using sql.js (pure JS, zero native deps).
 * Stores nodes and edges with confidence tagging, temporal staleness, and query frequency.
 */
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type {
  Confidence,
  EdgeRelation,
  GraphEdge,
  GraphNode,
  GraphStats,
  NodeKind,
} from "./schema.js";

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
    `);
    // Indexes (ignore errors if they already exist)
    const indexes = [
      "CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind)",
      "CREATE INDEX IF NOT EXISTS idx_nodes_source_file ON nodes(source_file)",
      "CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source)",
      "CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target)",
      "CREATE INDEX IF NOT EXISTS idx_edges_relation ON edges(relation)",
      "CREATE INDEX IF NOT EXISTS idx_edges_source_file ON edges(source_file)",
    ];
    for (const sql of indexes) {
      try { this.db.run(sql); } catch { /* already exists */ }
    }
  }

  save(): void {
    const data = this.db.export();
    writeFileSync(this.dbPath, Buffer.from(data));
  }

  upsertNode(node: GraphNode): void {
    this.db.run(
      `INSERT OR REPLACE INTO nodes (id, label, kind, source_file, source_location, confidence, confidence_score, last_verified, query_count, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      ]
    );
  }

  upsertEdge(edge: GraphEdge): void {
    this.db.run(
      `INSERT OR REPLACE INTO edges (source, target, relation, confidence, confidence_score, source_file, source_location, last_verified, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      ]
    );
  }

  /**
   * Remove all nodes and edges associated with a specific source file.
   * Used by the file watcher for incremental re-indexing — old nodes for
   * a changed file are cleared before re-extracting.
   */
  deleteBySourceFile(sourceFile: string): void {
    this.db.run("BEGIN TRANSACTION");
    try {
      this.db.run("DELETE FROM edges WHERE source_file = ?", [sourceFile]);
      this.db.run("DELETE FROM nodes WHERE source_file = ?", [sourceFile]);
      this.db.run("COMMIT");
    } catch (e) {
      this.db.run("ROLLBACK");
      throw e;
    }
  }

  bulkUpsert(nodes: GraphNode[], edges: GraphEdge[]): void {
    this.db.run("BEGIN TRANSACTION");
    for (const node of nodes) this.upsertNode(node);
    for (const edge of edges) this.upsertEdge(edge);
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

  searchNodes(query: string, limit = 20): GraphNode[] {
    const pattern = `%${query}%`;
    const results: GraphNode[] = [];
    const stmt = this.db.prepare(
      "SELECT * FROM nodes WHERE label LIKE ? OR id LIKE ? ORDER BY query_count DESC LIMIT ?"
    );
    stmt.bind([pattern, pattern, limit]);
    while (stmt.step()) {
      results.push(this.rowToNode(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  getNeighbors(
    nodeId: string,
    relationFilter?: EdgeRelation
  ): Array<{ node: GraphNode; edge: GraphEdge }> {
    const sql = relationFilter
      ? "SELECT * FROM edges WHERE (source = ? OR target = ?) AND relation = ?"
      : "SELECT * FROM edges WHERE source = ? OR target = ?";
    const params = relationFilter
      ? [nodeId, nodeId, relationFilter]
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

  getGodNodes(topN = 10): Array<{ node: GraphNode; degree: number }> {
    const results: Array<{ node: GraphNode; degree: number }> = [];
    // Exclude structural plumbing (file/import/module) AND concept nodes.
    // The `concept` kind is used by the skills-miner for both skills and
    // keyword nodes — a keyword like "landing page" may have hundreds of
    // triggered_by edges but isn't a "core abstraction" of the codebase.
    // Users want real code entities + decisions/patterns/mistakes here.
    const stmt = this.db.prepare(
      `SELECT n.*, COUNT(*) as degree
       FROM nodes n
       JOIN edges e ON e.source = n.id OR e.target = n.id
       WHERE n.kind NOT IN ('file', 'import', 'module', 'concept')
       GROUP BY n.id
       ORDER BY degree DESC
       LIMIT ?`
    );
    stmt.bind([topN]);
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

  getAllNodes(): GraphNode[] {
    const results: GraphNode[] = [];
    const stmt = this.db.prepare("SELECT * FROM nodes");
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

  getStats(): GraphStats {
    const nodeCount = (this.db.exec("SELECT COUNT(*) FROM nodes")[0]?.values[0]?.[0] as number) ?? 0;
    const edgeCount = (this.db.exec("SELECT COUNT(*) FROM edges")[0]?.values[0]?.[0] as number) ?? 0;

    const confRows = this.db.exec(
      "SELECT confidence, COUNT(*) as c FROM edges GROUP BY confidence"
    );
    const total = edgeCount || 1;
    const confMap: Record<string, number> = {};
    if (confRows[0]) {
      for (const row of confRows[0].values) {
        confMap[row[0] as string] = row[1] as number;
      }
    }

    const savedRow = this.db.exec(
      "SELECT value FROM stats WHERE key = 'tokens_saved'"
    );
    const lastMinedRow = this.db.exec(
      "SELECT value FROM stats WHERE key = 'last_mined'"
    );

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

  clearAll(): void {
    this.db.run("DELETE FROM nodes");
    this.db.run("DELETE FROM edges");
    this.db.run("DELETE FROM stats");
  }

  close(): void {
    this.save();
    this.db.close();
  }

  private rowToNode(row: Record<string, unknown>): GraphNode {
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
      metadata: JSON.parse((row.metadata as string) || "{}"),
    };
  }

  private rowToEdge(row: Record<string, unknown>): GraphEdge {
    return {
      source: row.source as string,
      target: row.target as string,
      relation: row.relation as EdgeRelation,
      confidence: (row.confidence as Confidence) ?? "EXTRACTED",
      confidenceScore: (row.confidence_score as number) ?? 1.0,
      sourceFile: (row.source_file as string) ?? "",
      sourceLocation: (row.source_location as string) ?? null,
      lastVerified: (row.last_verified as number) ?? 0,
      metadata: JSON.parse((row.metadata as string) || "{}"),
    };
  }
}
