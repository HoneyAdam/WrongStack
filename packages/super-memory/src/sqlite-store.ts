/**
 * SQLite-backed Super Memory store.
 *
 * Replaces the JSONL full-load-on-every-op pattern with an indexed database.
 * Uses `node:sqlite` (DatabaseSync), WAL mode, and FTS5 for full-text search.
 *
 * The schema stores the full SuperMemory object as JSON in a `memories` table
 * (primary index on id, with indexes on status, kind, scope, importance,
 * updatedAt) plus an FTS5 virtual table over the searchable text.  Graph edges
 * are stored in an `edges` table with indexes on from/to nodes.
 *
 * On first open, if a legacy `memories.jsonl` exists and the SQLite db is empty,
 * the store migrates records automatically (one-time cost).
 */

import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { ulid, withFileLock } from '@wrongstack/core/utils';
import { ensureDir } from '@wrongstack/core/utils';
import { readJsonl } from './jsonl.js';
import type {
  LegacyImportResult,
  MemoryAnchor,
  MemoryAudienceContext,
  MemoryCandidate,
  MemoryGraphEdge,
  MemoryGraphRelation,
  RememberSuperMemoryInput,
  SessionConsolidationInput,
  SessionConsolidationResult,
  SuperMemory,
  SuperMemoryForPathOptions,
  SuperMemoryHygieneOptions,
  SuperMemoryHygieneReport,
  SuperMemoryManifest,
  SuperMemorySearchOptions,
  SuperMemoryStatus,
  SuperMemoryStats,
  SuperMemoryStoreOptions,
  UpdateSuperMemoryInput,
} from './types.js';
import { SUPER_MEMORY_SCHEMA_VERSION } from './types.js';
import { resolveSuperMemoryPaths } from './paths.js';
import {
  normalizeAnchors,
  normalizeAudience,
  normalizeSources,
  normalizeTags,
  normalizeText,
  validateRememberInput,
} from './store-helpers.js';

// ─── SQLite loader (mirrors codebase-index's lazy pattern) ──────────────

let DatabaseSyncCtor: typeof DatabaseSync | undefined;

function loadDatabaseSync(): typeof DatabaseSync {
  if (DatabaseSyncCtor) return DatabaseSyncCtor;
  // silence the experimental warning
  const originalEmit = process.emitWarning;
  process.emitWarning = ((w: unknown, ...r: unknown[]): void => {
    const msg = typeof w === 'string' ? w : (w as Error)?.message ?? '';
    if (/sqlite/i.test(msg) && /experimental/i.test(msg)) return;
    (originalEmit as (w: unknown, ...r: unknown[]) => void)(w, ...r);
  }) as typeof process.emitWarning;
  try {
    const req = createRequire(import.meta.url);
    DatabaseSyncCtor = (req('node:sqlite') as typeof import('node:sqlite')).DatabaseSync;
  } catch (err) {
    throw new Error(
      "Super Memory SQLite store needs Node's built-in SQLite (node:sqlite), available since Node 22.5. " +
        `This runtime doesn't provide it: ${(err as Error).message}`,
    );
  }
  return DatabaseSyncCtor;
}

// ─── Schema ─────────────────────────────────────────────────────────────

const SQLITE_SCHEMA_VERSION = 1;

function initSchema(db: DatabaseSync): void {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA busy_timeout = 30000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      status TEXT NOT NULL,
      kind TEXT NOT NULL,
      scope TEXT NOT NULL,
      importance REAL NOT NULL,
      confidence REAL NOT NULL,
      freshness REAL NOT NULL,
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      audience TEXT,
      tags TEXT
    );
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_status ON memories(status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_kind ON memories(kind)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_scope ON memories(scope)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_importance ON memories(importance DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_updated ON memories(updated_at DESC)');

  // FTS5 full-text search over memory text + tags
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        text, tags, audience, content='memories', content_rowid='rowid'
      );
    `);
    // Triggers to keep FTS in sync
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, text, tags, audience)
        VALUES (new.rowid,
          json_extract(new.data, '$.text'),
          COALESCE(json_extract(new.data, '$.tags'), ''),
          COALESCE(new.audience, ''));
      END;
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, text, tags, audience)
        VALUES('delete', old.rowid,
          json_extract(old.data, '$.text'),
          COALESCE(json_extract(old.data, '$.tags'), ''),
          COALESCE(old.audience, ''));
      END;
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, text, tags, audience)
        VALUES('delete', old.rowid,
          json_extract(old.data, '$.text'),
          COALESCE(json_extract(old.data, '$.tags'), ''),
          COALESCE(old.audience, ''));
        INSERT INTO memories_fts(rowid, text, tags, audience)
        VALUES (new.rowid,
          json_extract(new.data, '$.text'),
          COALESCE(json_extract(new.data, '$.tags'), ''),
          COALESCE(new.audience, ''));
      END;
    `);
  } catch {
    // FTS5 unavailable — search will use LIKE fallback
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS edges (
      from_node TEXT NOT NULL,
      to_node TEXT NOT NULL,
      relation TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      PRIMARY KEY (from_node, to_node, relation)
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_edge_from ON edges(from_node)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_edge_to ON edges(to_node)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT NOT NULL,
      at TEXT NOT NULL,
      trace_id TEXT,
      data TEXT
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

// ─── Store ──────────────────────────────────────────────────────────────

export class SqliteSuperMemoryStore {
  readonly paths;
  private readonly projectRoot: string;
  private readonly now: () => Date;
  private traceId?: string | undefined;
  private db!: DatabaseSync;
  private initialized = false;
  private initializing: Promise<void> | undefined;
  private mutationChain: Promise<unknown> = Promise.resolve();

  constructor(opts: SuperMemoryStoreOptions) {
    this.projectRoot = path.resolve(opts.projectRoot);
    this.paths = resolveSuperMemoryPaths(this.projectRoot, opts.directory);
    this.traceId = opts.traceId;
    this.now = opts.now ?? (() => new Date());
  }

  withTraceId(traceId: string): this {
    this.traceId = traceId;
    return this;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializing) return this.initializing;
    this.initializing = this.initializeOnce();
    try {
      await this.initializing;
    } finally {
      this.initializing = undefined;
    }
  }

  private async initializeOnce(): Promise<void> {
    await ensureDir(this.paths.rootDir);
    const dbPath = path.join(this.paths.rootDir, 'super-memory.db');
    const DBCtor = loadDatabaseSync();
    this.db = new DBCtor(dbPath);
    initSchema(this.db);

    // Check schema version
    const row = this.db.prepare('SELECT value FROM schema_meta WHERE key = ?').get('version') as
      | { value?: number }
      | undefined;
    if (!row) {
      this.db.prepare('INSERT INTO schema_meta (key, value) VALUES (?, ?)').run('version', SQLITE_SCHEMA_VERSION);
    }

    // Write manifest if absent
    await withFileLock(this.paths.manifest, async () => {
      if (!fs.existsSync(this.paths.manifest)) {
        const nowIso = this.now().toISOString();
        const manifest: SuperMemoryManifest = {
          schemaVersion: SUPER_MEMORY_SCHEMA_VERSION,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        fs.writeFileSync(this.paths.manifest, JSON.stringify(manifest, null, 2));
      }
    });

    // Auto-migrate from JSONL if db is empty and JSONL exists
    const countRow = this.db.prepare('SELECT COUNT(*) AS n FROM memories').get() as { n: number };
    if ((countRow as { n: number }).n === 0 && fs.existsSync(this.paths.memoriesLog)) {
      await this.migrateFromJsonl();
    }

    this.initialized = true;
  }

  // ─── JSONL migration ────────────────────────────────────────────────

  private async migrateFromJsonl(): Promise<void> {
    type SuperMemoryRecord = { recordType: 'memory'; memory: SuperMemory };
    const records = await readJsonl<SuperMemoryRecord>(this.paths.memoriesLog);
    const insertMem = this.db.prepare(`
      INSERT OR REPLACE INTO memories
        (id, data, status, kind, scope, importance, confidence, freshness, updated_at, created_at, audience, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = this.db.exec('BEGIN');
    try {
      for (const rec of records) {
        if (rec.recordType !== 'memory' || !rec.memory) continue;
        const m = rec.memory;
        insertMem.run(
          m.id,
          JSON.stringify(m),
          m.status,
          m.kind,
          m.scope,
          m.importance,
          m.confidence,
          m.freshness,
          m.updatedAt,
          m.createdAt,
          m.audience ? JSON.stringify(m.audience) : null,
          JSON.stringify(m.tags),
        );
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    void tx;
  }

  // ─── Core helpers ───────────────────────────────────────────────────

  private nowIso(): string {
    return this.now().toISOString();
  }

  private rowToMemory(row: { data: string }): SuperMemory {
    return JSON.parse(row.data) as SuperMemory;
  }

  private runMutation<T>(work: () => T): Promise<T> {
    const next = this.mutationChain
      .catch(() => undefined)
      .then(async () =>
        withFileLock(path.join(this.paths.locksDir, 'store-mutation'), async () => work(), {
          timeoutMs: 60_000,
          staleMs: 30 * 60_000,
        }),
      );
    this.mutationChain = next;
    return next as Promise<T>;
  }

  // ─── Public API ─────────────────────────────────────────────────────

  async rememberSuper(input: RememberSuperMemoryInput): Promise<SuperMemory> {
    validateRememberInput(input);
    const normalizedText = normalizeText(input.text);
    if (!normalizedText) throw new Error('Super Memory text must not be empty.');
    await this.initialize();

    const scope = input.scope ?? 'project';
    const kind = input.kind ?? 'fact';
    const tags = normalizeTags(input.tags);
    const anchors = normalizeAnchors(this.projectRoot, input.anchors ?? []);
    const audience = normalizeAudience(input.audience);
    const sources = normalizeSources(input.sources ?? [{ type: 'user' }]);
    const nowIso = this.nowIso();

    return this.runMutation(() => {
      // Check for duplicate by canonical text
      const canonical = normalizedText.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
      const candidates = this.db
        .prepare(
          `SELECT data FROM memories
           WHERE status IN ('active','stale') AND scope = ?
           AND LOWER(json_extract(data, '$.text')) LIKE ?`,
        )
        .all(scope, `%${canonical}%`) as Array<{ data: string }>;

      for (const c of candidates) {
        const existing = this.rowToMemory(c);
        const existingCanonical = existing.text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
        if (existingCanonical === canonical) {
          // Merge
          const merged: SuperMemory = {
            ...existing,
            tags: [...new Set([...existing.tags, ...tags])],
            anchors: [...new Map([...existing.anchors, ...anchors].map((a) => [JSON.stringify(a), a])).values()] as MemoryAnchor[],
            ...(audience ? { audience } : {}),
            sources: [...new Map([...existing.sources, ...sources].map((s) => [JSON.stringify(s), s])).values()],
            importance: Math.max(existing.importance, input.importance ?? 0.6),
            confidence: Math.max(existing.confidence, input.confidence ?? 0.8),
            freshness: Math.max(existing.freshness, input.freshness ?? 1),
            updatedAt: nowIso,
            revision: existing.revision + 1,
          };
          this.upsertMemory(merged);
          return merged;
        }
      }

      // Create new
      const memory: SuperMemory = {
        id: ulid(),
        revision: 1,
        text: normalizedText,

        kind,
        scope,
        status: 'active',
        tags,
        anchors,
        sources,
        audience,
        importance: input.importance ?? 0.6,
        confidence: input.confidence ?? 0.8,
        freshness: input.freshness ?? 1,
        supersedes: input.supersedes,
        contradicts: input.contradicts,
        supersededBy: undefined,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      this.upsertMemory(memory);
      return memory;
    });
  }

  private upsertMemory(m: SuperMemory): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO memories
          (id, data, status, kind, scope, importance, confidence, freshness, updated_at, created_at, audience, tags)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        m.id,
        JSON.stringify(m),
        m.status,
        m.kind,
        m.scope,
        m.importance,
        m.confidence,
        m.freshness,
        m.updatedAt,
        m.createdAt,
        m.audience ? JSON.stringify(m.audience) : null,
        JSON.stringify(m.tags),
      );
  }

  async updateSuper(id: string, input: UpdateSuperMemoryInput): Promise<SuperMemory> {
    await this.initialize();
    return this.runMutation(() => {
      const row = this.db.prepare('SELECT data FROM memories WHERE id = ?').get(id) as
        | { data: string }
        | undefined;
      if (!row) throw new Error(`Super Memory ${id} not found.`);
      const existing = this.rowToMemory(row);
      const updated: SuperMemory = {
        ...existing,
        ...(input.text !== undefined && { text: normalizeText(input.text) }),

        ...(input.kind !== undefined && { kind: input.kind }),
        ...(input.status !== undefined && { status: input.status as SuperMemoryStatus }),
        ...(input.tags !== undefined && { tags: normalizeTags(input.tags) }),
        ...(input.anchors !== undefined && { anchors: normalizeAnchors(this.projectRoot, input.anchors) }),
        ...(input.importance !== undefined && { importance: Math.max(0, Math.min(1, input.importance)) }),
        ...(input.confidence !== undefined && { confidence: Math.max(0, Math.min(1, input.confidence)) }),
        ...(input.freshness !== undefined && { freshness: Math.max(0, Math.min(1, input.freshness)) }),
        ...(input.audience !== undefined && { audience: normalizeAudience(input.audience) }),
        ...(input.supersedes !== undefined && { supersedes: input.supersedes }),
        ...(input.contradicts !== undefined && { contradicts: input.contradicts }),
        revision: existing.revision + 1,
        updatedAt: this.nowIso(),
      };
      this.upsertMemory(updated);
      return updated;
    });
  }

  async deleteSuper(id: string, reason?: string): Promise<{ deleted: true; id: string }> {
    await this.initialize();
    await this.runMutation(() => {
      this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
      this.db.prepare('DELETE FROM edges WHERE from_node = ? OR to_node = ?').run(`mem:${id}`, `mem:${id}`);
      this.audit('memory.deleted', { memoryId: id, reason });
    });
    return { deleted: true, id };
  }

  async searchSuper(query: string, opts?: SuperMemorySearchOptions): Promise<SuperMemory[]> {
    await this.initialize();
    const limit = opts?.limit ?? 20;
    const statusFilter = opts?.includeStatuses ?? ['active'];

    // Try FTS5 first
    try {
      const placeholders = statusFilter.map(() => '?').join(',');
      const ftsQuery = query.split(/\s+/).filter(Boolean).map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ');
      const rows = this.db
        .prepare(
          `SELECT m.data FROM memories m
           JOIN memories_fts f ON m.rowid = f.rowid
           WHERE m.status IN (${placeholders})
           AND memories_fts MATCH ?
           ORDER BY bm25(memories_fts) DESC, m.importance DESC
           LIMIT ?`,
        )
        .all(...statusFilter, ftsQuery, limit) as Array<{ data: string }>;
      return rows.map((r) => this.rowToMemory(r));
    } catch {
      // FTS5 unavailable — LIKE fallback
    }

    // LIKE fallback
    const likePattern = `%${query.replace(/[%_]/g, (c) => '\\' + c)}%`;
    const placeholders = statusFilter.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT data FROM memories
         WHERE status IN (${placeholders})
         AND LOWER(json_extract(data, '$.text')) LIKE ? ESCAPE '\\'
         ORDER BY importance DESC
         LIMIT ?`,
      )
      .all(...statusFilter, likePattern, limit) as Array<{ data: string }>;
    return rows.map((r) => this.rowToMemory(r));
  }

  async retrieveForPath(
    paths: string[],
    opts?: SuperMemoryForPathOptions,
  ): Promise<SuperMemory[]> {
    await this.initialize();
    const limit = opts?.limit ?? 20;
    const includeAncestors = opts?.includeAncestors ?? true;

    // Build LIKE conditions for each path
    const conditions: string[] = [];
    const params: (string | number)[] = ['active', 'stale'];
    for (const p of paths) {
      const normalized = p.replace(/\\/g, '/').replace(/\/+/g, '/');
      params.push(`%"path":"${normalized.replace(/[%_]/g, '\\$&')}"%`);
      conditions.push('LOWER(data) LIKE ? ESCAPE \'\\\'');
      if (includeAncestors) {
        const parts = normalized.split('/').filter(Boolean);
        for (let i = parts.length; i >= 1; i--) {
          const ancestor = parts.slice(0, i).join('/');
          params.push(`%"path":"${ancestor.replace(/[%_]/g, '\\$&')}"%`);
          conditions.push('LOWER(data) LIKE ? ESCAPE \'\\\'');
        }
      }
    }
    const rowParams: (string | number)[] = [...params, limit] as (string | number)[];
    const rows = this.db
      .prepare(
        `SELECT data FROM memories
         WHERE status IN (?, ?)
         AND (${conditions.join(' OR ')})
         ORDER BY importance DESC, updated_at DESC
         LIMIT ?`,
      )
      .all(...rowParams as (string | number)[]) as Array<{ data: string }>;
    return rows.map((r) => this.rowToMemory(r));
  }

  async retrieveForAudience(
    context: MemoryAudienceContext,
    opts?: { limit?: number },
  ): Promise<SuperMemory[]> {
    await this.initialize();
    const limit = opts?.limit ?? 20;
    const role = context.role?.toLowerCase() ?? '';
    const taskType = context.taskType?.toLowerCase() ?? '';
    const mode = context.mode?.toLowerCase() ?? '';

    // Search audience JSON for matching role/task/mode (OR within, AND across)
    const rows = this.db
      .prepare(
        `SELECT data FROM memories
         WHERE status IN ('active','stale')
         AND audience IS NOT NULL
         AND (
           (LOWER(audience) LIKE ? OR LOWER(audience) LIKE ?)
           AND (LOWER(audience) LIKE ? OR LOWER(audience) LIKE ?)
           AND (LOWER(audience) LIKE ? OR LOWER(audience) LIKE ?)
         )
         ORDER BY importance DESC
         LIMIT ?`,
      )
      .all(
        `%"roles":["%${role}%`,
        '%"taskTypes":["%',
        `%"taskTypes":["%${taskType}%`,
        '%"modes":["%',
        `%"modes":["%${mode}%`,
        '%"roles":["%',
        limit,
      ) as Array<{ data: string }>;
    return rows.map((r) => this.rowToMemory(r));
  }

  async listMemories(opts?: {
    status?: SuperMemoryStatus | 'all';
    kind?: string;
    limit?: number;
    offset?: number;
  }): Promise<SuperMemory[]> {
    await this.initialize();
    const limit = opts?.limit ?? 100;
    const offset = opts?.offset ?? 0;
    const status = opts?.status ?? 'all';
    const kind = opts?.kind;

    let sql = 'SELECT data FROM memories WHERE 1=1';
    const params: unknown[] = [];
    if (status !== 'all') {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (kind && kind !== 'all') {
      sql += ' AND kind = ?';
      params.push(kind);
    }
    sql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params as (string | number)[]) as Array<{ data: string }>;
    return rows.map((r) => this.rowToMemory(r));
  }

  async getStats(): Promise<SuperMemoryStats> {
    await this.initialize();
    const totalRow = this.db.prepare('SELECT COUNT(*) AS n FROM memories').get() as { n: number };
    const byStatus: Record<string, number> = {};
    const statusRows = this.db
      .prepare('SELECT status, COUNT(*) AS n FROM memories GROUP BY status')
      .all() as Array<{ status: string; n: number }>;
    for (const r of statusRows) byStatus[r.status] = r.n;

    const byKind: Record<string, number> = {};
    const kindRows = this.db
      .prepare('SELECT kind, COUNT(*) AS n FROM memories GROUP BY kind')
      .all() as Array<{ kind: string; n: number }>;
    for (const r of kindRows) byKind[r.kind] = r.n;

    const edgeRow = this.db.prepare('SELECT COUNT(*) AS n FROM edges').get() as { n: number };

    return {
      total: totalRow.n,
      byStatus: byStatus as SuperMemoryStats['byStatus'],
      byKind,
      edges: edgeRow.n,
    };
  }

  // ─── Graph ──────────────────────────────────────────────────────────

  async addGraphEdge(from: string, to: string, relation: MemoryGraphRelation, weight = 1): Promise<void> {
    await this.initialize();
    this.db
      .prepare(
        `INSERT INTO edges (from_node, to_node, relation, weight, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(from_node, to_node, relation) DO UPDATE SET weight = weight + excluded.weight`,
      )
      .run(from, to, relation, weight, this.nowIso());
  }

  async traverseGraph(starts: string[], opts?: { maxDepth?: number; limit?: number }): Promise<MemoryGraphEdge[]> {
    await this.initialize();
    const maxDepth = Math.min(opts?.maxDepth ?? 2, 6);
    const limit = Math.min(opts?.limit ?? 100, 1000);

    const visitedNodes = new Set(starts);
    const visitedEdges = new Set<string>();
    const result: MemoryGraphEdge[] = [];
    const queue = starts.map((n) => ({ node: n, depth: 0 }));

    while (queue.length > 0 && result.length < limit) {
      const current = queue.shift()!;
      if (current.depth >= maxDepth) continue;
      const rows = this.db
        .prepare('SELECT from_node, to_node, relation, weight FROM edges WHERE from_node = ? OR to_node = ?')
        .all(current.node, current.node) as Array<{
        from_node: string;
        to_node: string;
        relation: MemoryGraphRelation;
        weight: number;
      }>;
      for (const r of rows) {
        const next = r.from_node === current.node ? r.to_node : r.from_node;
        const edgeKey = `${r.from_node}\u0000${r.to_node}\u0000${r.relation}`;
        if (visitedEdges.has(edgeKey)) continue;
        visitedEdges.add(edgeKey);
        result.push({
          id: ulid(),
          from: r.from_node,
          to: r.to_node,
          relation: r.relation,
          weight: r.weight,
          createdAt: this.nowIso(),
          schemaVersion: 1,
        });
        if (!visitedNodes.has(next)) {
          visitedNodes.add(next);
          queue.push({ node: next, depth: current.depth + 1 });
        }
      }
    }
    return result;
  }

  // ─── Audit ──────────────────────────────────────────────────────────

  private audit(event: string, data?: Record<string, unknown>): void {
    this.db
      .prepare('INSERT INTO audit_log (event, at, trace_id, data) VALUES (?, ?, ?, ?)')
      .run(event, this.nowIso(), this.traceId ?? null, data ? JSON.stringify(data) : null);
  }

  // ─── Hygiene ────────────────────────────────────────────────────────

  async runHygiene(_opts?: SuperMemoryHygieneOptions): Promise<SuperMemoryHygieneReport> {
    await this.initialize();
    // Basic implementation — verifies anchors and marks stale
    const active = await this.listMemories({ status: 'active', limit: 10000 });
    const stale: string[] = [];
    const verified: string[] = [];

    for (const m of active) {
      // Simple check: if memory has anchors, check file existence
      let allValid = true;
      for (const anchor of m.anchors) {
        if (anchor.type === 'file' || anchor.type === 'symbol' || anchor.type === 'test' || anchor.type === 'git') {
          if (anchor.path) {
            const abs = path.resolve(this.projectRoot, anchor.path);
            if (!fs.existsSync(abs)) {
              allValid = false;
              break;
            }
          }
        }
      }
      if (allValid) verified.push(m.id);
      else stale.push(m.id);
    }

    // Mark stale
    for (const id of stale) {
      this.db.prepare('UPDATE memories SET status = ?, data = json_set(data, \'$.status\', ?) WHERE id = ?').run(
        'stale',
        'stale',
        id,
      );
    }

    const report: SuperMemoryHygieneReport = {
      startedAt: this.nowIso(),
      completedAt: this.nowIso(),
      examined: active.length,
      deduplicated: 0,
      superseded: 0,
      contradicted: 0,
      staled: stale.length,
      archived: 0,
      deleted: 0,
      verified: verified.length,
    };
    return report;
  }

  // ─── Candidates ─────────────────────────────────────────────────────

  async addCandidate(candidate: MemoryCandidate): Promise<void> {
    await this.initialize();
    this.db
      .prepare(
        'INSERT OR REPLACE INTO candidates (id, data, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(candidate.id, JSON.stringify(candidate), candidate.status, candidate.createdAt, candidate.updatedAt);
  }

  async listCandidates(): Promise<MemoryCandidate[]> {
    await this.initialize();
    const rows = this.db
      .prepare('SELECT data FROM candidates ORDER BY created_at DESC')
      .all() as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as MemoryCandidate);
  }

  // ─── Legacy compat ──────────────────────────────────────────────────

  async importLegacy(raw: string): Promise<LegacyImportResult> {
    // Parse legacy markdown and import as new memories
    const lines = raw.split(/\r?\n/);
    let imported = 0;
    let skipped = 0;
    for (const line of lines) {
      if (!/^\s*[-*]\s+/.test(line)) continue;
      const text = line.replace(/^\s*[-*]\s+/, '').trim();
      if (!text) {
        skipped++;
        continue;
      }
      await this.rememberSuper({ text, scope: 'project' });
      imported++;
    }
    return { imported, skipped, files: 0 };
  }

  async consolidateSession(input: SessionConsolidationInput): Promise<SessionConsolidationResult> {
    let accepted = 0;
    let rejected = 0;
    void input;
    return { accepted, rejected, candidates: 0, duplicate: 0 };
  }

  close(): void {
    if (this.db) {
      this.db.close();
    }
  }
}
