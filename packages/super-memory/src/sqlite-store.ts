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
import { normalizeTextKey } from './middleware/turn-memory.js';
import type {
  CandidateDecision,
  CreateCandidateInput,
  LegacyImportResult,
  MemoryAnchor,
  MemoryAudienceContext,
  MemoryCandidate,
  MemoryCandidateResolution,
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
  collectStringValues,
  looksLikeSecret,
  normalizeAnchors,
  normalizeAudience,
  normalizeSources,
  normalizeTags,
  normalizeText,
  validateRememberInput,
} from './store-helpers.js';

// ─── SQLite loader (mirrors codebase-index's lazy pattern) ──────────────

let DatabaseSyncCtor: typeof DatabaseSync | undefined | null;
// null = confirmed unavailable, undefined = not yet probed

/**
 * Non-throwing probe — returns true if `node:sqlite` is available
 * in the current runtime. Safe to call from outside the store.
 */
export function isSqliteAvailable(): boolean {
  if (DatabaseSyncCtor === null) return false;
  if (DatabaseSyncCtor !== undefined) return true;
  try {
    loadDatabaseSync();
    return true;
  } catch {
    DatabaseSyncCtor = null;
    return false;
  }
}

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
      const canonical = normalizeTextKey(normalizedText);
      const candidates = this.db
        .prepare(
          `SELECT data FROM memories
           WHERE status IN ('active','stale') AND scope = ?
           AND LOWER(json_extract(data, '$.text')) LIKE ?`,
        )
        .all(scope, `%${canonical}%`) as Array<{ data: string }>;

      for (const c of candidates) {
        const existing = this.rowToMemory(c);
        const existingCanonical = normalizeTextKey(existing.text);
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
        persistence: input.persistence,
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

  async recordInjection(memoryIds: string[], trigger: string, sessionId?: string): Promise<void> {
    if (memoryIds.length === 0) return;
    await this.initialize();
    await this.runMutation(() => {
      const now = this.nowIso();
      // Counter increments are indexed json_set updates — cheap enough to
      // apply immediately, unlike the JSONL store's batched flush.
      const stmt = this.db.prepare(
        `UPDATE memories SET data = json_set(data,
           '$.injectionCount', COALESCE(json_extract(data, '$.injectionCount'), 0) + 1,
           '$.lastAccessedAt', ?)
         WHERE id = ? AND status != 'deleted'`,
      );
      for (const id of memoryIds) stmt.run(now, id);
      this.audit('memory.injected', { details: { memoryIds, trigger, sessionId } });
    });
  }

  async recordUse(memoryIds: string[], source: string, sessionId?: string): Promise<void> {
    if (memoryIds.length === 0) return;
    await this.initialize();
    await this.runMutation(() => {
      const now = this.nowIso();
      const stmt = this.db.prepare(
        `UPDATE memories SET data = json_set(data,
           '$.useCount', COALESCE(json_extract(data, '$.useCount'), 0) + 1,
           '$.lastUsedAt', ?,
           '$.lastAccessedAt', ?)
         WHERE id = ? AND status != 'deleted'`,
      );
      for (const id of memoryIds) stmt.run(now, now, id);
      this.audit('memory.used', { details: { memoryIds, source, sessionId } });
    });
  }

  async searchSuper(query: string, opts?: SuperMemorySearchOptions): Promise<SuperMemory[]> {
    await this.initialize();
    const limit = opts?.limit ?? 20;
    const statusFilter = opts?.includeStatuses ?? ['active'];

    // Empty query → direct table scan (bypasses FTS5 which is slower for list-all)
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      const placeholders = statusFilter.map(() => '?').join(',');
      const rows = this.db
        .prepare(
          `SELECT data FROM memories
           WHERE status IN (${placeholders})
           ORDER BY importance DESC, updated_at DESC
           LIMIT ?`,
        )
        .all(...statusFilter, limit) as Array<{ data: string }>;
      return rows.map((r) => this.rowToMemory(r));
    }

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

    // Query all audience-scoped memories, then filter in JS for correctness.
    // The SQLite LIKE approach was fragile — it produced false negatives when
    // a memory targeted only one audience dimension (e.g. only roles) because
    // the cyclical fallback logic couldn't express "this dimension is absent
    // so it's automatically satisfied."
    const rows = this.db
      .prepare(
        `SELECT data FROM memories
         WHERE status IN ('active','stale')
         AND audience IS NOT NULL
         ORDER BY importance DESC
         LIMIT ?`,
      )
      .all(1000) as Array<{ data: string }>;

    return rows
      .map((r) => this.rowToMemory(r))
      .filter((m) => {
        if (!m.audience) return false;
        const a = m.audience;
        // For each dimension the memory defines, the context must match.
        // Undefined/unset dimensions in memory are pass-through (no constraint).
        if (a.roles?.length && !a.roles.some((r) => r.toLowerCase() === role)) return false;
        if (a.taskTypes?.length && !a.taskTypes.some((t) => t.toLowerCase() === taskType)) return false;
        if (a.modes?.length && !a.modes.some((m) => m.toLowerCase() === mode)) return false;
        return true;
      })
      .slice(0, limit);
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

  /**
   * Reject input that looks like a secret or credential. Mirrors
   * `SuperMemoryStore.rejectIfUnsafeInput` so candidate proposals filed through
   * the SQLite store are subject to the same unsafe-content guard before they
   * reach the ReviewQueue.
   */
  private rejectIfUnsafeInput(input: Omit<RememberSuperMemoryInput, 'legacyScope' | 'priority' | 'type'>): void {
    for (const value of collectStringValues(input)) {
      if (looksLikeSecret(value)) {
        throw new Error('Super Memory refused to store text that looks like a secret or credential.');
      }
    }
  }

  // ─── Hygiene ────────────────────────────────────────────────────────

  async hygiene(opts?: SuperMemoryHygieneOptions): Promise<SuperMemoryHygieneReport> {
    await this.initialize();
    const startedAt = this.nowIso();

    // ── Phase 1: Anchor verification ────────────────────────────────
    const active = await this.listMemories({ status: 'active', limit: 10000 });
    const stale: string[] = [];
    const verified: string[] = [];

    for (const m of active) {
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

    // ── Phase 2: Deduplication ──────────────────────────────────────
    // Group active memories by (scope, canonical text). Keep the highest-
    // quality entry (importance desc, confidence desc, createdAt asc) and
    // mark duplicates as 'superseded'. Matches the JSONL store's
    // hygieneUnlocked dedup logic.
    let deduplicated = 0;
    let superseded = 0;
    const allActive = await this.listMemories({ status: 'active', limit: 10000 });
    const groups = new Map<string, SuperMemory[]>();
    for (const m of allActive) {
      const key = `${m.scope}\0${normalizeTextKey(m.text)}`;
      const group = groups.get(key);
      if (group) group.push(m);
      else groups.set(key, [m]);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const sorted = [...group].sort((a, b) =>
        b.importance - a.importance
        || b.confidence - a.confidence
        || a.createdAt.localeCompare(b.createdAt),
      );
      const keeper = sorted[0]!;
      const duplicates = sorted.slice(1);
      // Merge tags/anchors/sources into keeper
      const updatedKeeper: SuperMemory = {
        ...keeper,
        tags: [...new Set(sorted.flatMap((m) => m.tags))],
        anchors: [...new Map([...sorted.flatMap((m) => m.anchors)].map((a) => [JSON.stringify(a), a])).values()] as MemoryAnchor[],
        sources: [...new Set(sorted.flatMap((m) => m.sources.map((s) => JSON.stringify(s))))].map((s) => JSON.parse(s)),
        supersedes: [...new Set([...(keeper.supersedes ?? []), ...duplicates.map((m) => m.id)])],
        updatedAt: this.nowIso(),
      };
      this.upsertMemory(updatedKeeper);
      for (const dup of duplicates) {
        const supersededDup: SuperMemory = {
          ...dup,
          status: 'superseded',
          supersededBy: keeper.id,
          updatedAt: this.nowIso(),
        };
        this.upsertMemory(supersededDup);
        // Add graph edge (best-effort — the edges table may not exist in all configs)
        try {
          this.db
            .prepare('INSERT INTO edges (from_node, to_node, relation, weight, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(`mem:${keeper.id}`, `mem:${dup.id}`, 'supersedes', 1, this.nowIso());
        } catch { /* edges table may be absent */ }
        deduplicated++;
        superseded++;
      }
    }
    this.audit('memory.hygiene_dedup', { details: { deduplicated, superseded } });

    // ── Phase 3: Review candidates ──────────────────────────────────
    // Matches the JSONL store's four rules: expires_at_passed,
    // injected_never_used, confidence_low, freshness_low.
    // Permanent memories are exempt from all candidate rules.
    const nowMs = this.now().getTime();
    const retentionMs = (opts?.retentionDays ?? 90) * 86_400_000;
    const lowConfidenceMs = (opts?.archiveLowConfidenceAfterDays ?? 30) * 86_400_000;
    const unusedMs = (opts?.archiveUnusedAfterDays ?? 30) * 86_400_000;
    const unusedMinInjections = Math.max(1, Math.floor(opts?.unusedMinInjections ?? 10));

    // Load existing pending candidates so we can de-dup within this run.
    // Uses `targetMemoryId` (the proposal-linkage field), NOT `memoryId`
    // (which is the resolution-result field and is undefined for pending
    // hygiene-created candidates — the rename from memoryId→targetMemoryId
    // moved the link, so this reader had to move with it).
    const existingCandidates = await this.listCandidates();
    const existingPendingKeys = new Set(
      existingCandidates
        .filter((c) => c.status === 'pending')
        .map((c) => c.targetMemoryId ?? ''),
    );
    const candidateEmittedFor = new Set<string>();

    let reviewCandidatesCreated = 0;

    // Query non-deleted, non-superseded memories for candidate evaluation
    const candidates = await this.listMemories({ status: 'all', limit: 10000 });
    for (const m of candidates) {
      if (m.status === 'deleted' || m.status === 'superseded' || m.status === 'contradicted') continue;

      const age = nowMs - Date.parse(m.lastAccessedAt ?? m.updatedAt);
      const persistence = m.persistence ?? 'long_lived';
      let reason: string | undefined;
      let suggestedAction: 'delete' | 'archive' | 'investigate' = 'investigate';

      if (m.scope === 'session' && m.expiresAt && Date.parse(m.expiresAt) <= nowMs) {
        reason = 'expires_at_passed';
        suggestedAction = 'delete';
      } else if (m.expiresAt && Date.parse(m.expiresAt) <= nowMs) {
        reason = 'expires_at_passed';
        suggestedAction = 'delete';
      } else if (
        m.status === 'active'
        && m.scope !== 'session'
        && (m.injectionCount ?? 0) >= unusedMinInjections
        && (m.useCount ?? 0) === 0
        && nowMs - Date.parse(m.updatedAt) >= unusedMs
      ) {
        reason = 'injected_never_used';
        suggestedAction = 'delete';
      } else if (
        (m.status === 'stale' && age >= retentionMs)
        || (m.confidence < 0.5 && age >= lowConfidenceMs)
      ) {
        reason = m.confidence < 0.5 ? 'confidence_low' : 'freshness_low';
        suggestedAction = 'investigate';
      }

      // Permanent memories are exempt from time/usage rules
      if (reason && persistence !== 'permanent'
        && !candidateEmittedFor.has(m.id)
        && !existingPendingKeys.has(m.id)) {
        candidateEmittedFor.add(m.id);
        const ageDays = Math.floor((nowMs - Date.parse(m.updatedAt)) / 86_400_000);
        await this.addCandidate({
          id: ulid(),
          schemaVersion: 1,
          targetMemoryId: m.id,
          text: m.text,
          kind: 'memory_review',
          status: 'pending',
          scope: 'project',
          confidence: 0.6,
          importance: 0.4,
          tags: [...m.tags, `review:${reason}`, `suggested:${suggestedAction}`, `persistence:${persistence}`],
          anchors: m.anchors,
          sources: [{ type: 'session' }],
          createdAt: this.nowIso(),
          updatedAt: this.nowIso(),
        });
        this.audit('memory.review_candidate_created', {
          memoryId: m.id,
          reason,
          details: { suggestedAction, ageDays, persistence, status: m.status, confidence: m.confidence },
        });
        reviewCandidatesCreated++;
      }
    }

    const report: SuperMemoryHygieneReport = {
      startedAt,
      completedAt: this.nowIso(),
      examined: active.length,
      deduplicated,
      superseded,
      contradicted: 0,
      staled: stale.length,
      reviewCandidatesCreated,
      archived: 0,
      archivedUnused: 0,
      deleted: 0,
      verified: verified.length,
    };
    this.audit('memory.hygiene_completed', { details: report as unknown as Record<string, unknown> });
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

  /**
   * Public proposal channel — mirrors `SuperMemoryStore.createCandidate`.
   * Lets agents (e.g. the Mnemosyne custodian) file review proposals into
   * the ReviewQueue instead of applying destructive changes directly.
   */
  async createCandidate(
    input: CreateCandidateInput,
  ): Promise<MemoryCandidate> {
    validateRememberInput(input);
    // Reject secrets/credentials before any store operation. Mirrors
    // SuperMemoryStore.rejectIfUnsafeInput so candidate proposals filed
    // through the SQLite store are subject to the same unsafe-content guard
    // before they reach the ReviewQueue.
    this.rejectIfUnsafeInput(input);
    await this.initialize();
    const text = normalizeText(input.text);
    if (!text) throw new Error('Super Memory candidate text must not be empty.');
    const scope = input.scope ?? 'project';
    const key = normalizeTextKey(text);
    // Check+insert under runMutation to prevent race conditions.
    // Dedup is scoped to `pending` candidates only so accepted/rejected
    // proposals don't permanently block re-submission.
    // Uses synchronous SQL directly so runMutation's () => T contract is satisfied.
    return this.runMutation(() => {
      const rows = this.db
        .prepare("SELECT data FROM candidates WHERE status = 'pending' ORDER BY created_at DESC")
        .all() as Array<{ data: string }>;
      const existing = rows.map((r) => JSON.parse(r.data) as MemoryCandidate);
      const duplicate = existing.find(
        (candidate) => candidate.scope === scope && normalizeTextKey(candidate.text) === key,
      );
      if (duplicate) return duplicate;
      const now = this.nowIso();
      const audience = normalizeAudience(input.audience);
      const candidate: MemoryCandidate = {
        schemaVersion: SUPER_MEMORY_SCHEMA_VERSION,
        id: `candidate_${ulid()}`,
        status: 'pending',
        text,
        kind: input.kind ?? 'fact',
        scope,
        confidence: clamp01(input.confidence ?? 0.6),
        importance: clamp01(input.importance ?? 0.6),
        tags: normalizeTags(input.tags),
        anchors: normalizeAnchors(this.projectRoot, input.anchors ?? []),
        ...(audience ? { audience } : {}),
        sources: normalizeSources(input.sources ?? [{ type: 'session' }]),
        createdAt: now,
        updatedAt: now,
        ...(input.targetMemoryId ? { targetMemoryId: input.targetMemoryId } : {}),
        ...(input.reviewReason ? { reviewReason: input.reviewReason } : {}),
      };
      this.db
        .prepare(
          'INSERT OR REPLACE INTO candidates (id, data, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(candidate.id, JSON.stringify(candidate), candidate.status, candidate.createdAt, candidate.updatedAt);
      this.audit('memory.candidate_created', { details: { candidateId: candidate.id } });
      return candidate;
    });
  }

  async listCandidates(includeResolved = false): Promise<MemoryCandidate[]> {
    await this.initialize();
    // Mirror SuperMemoryStore.listCandidates: default to pending-only so the
    // ReviewQueue listing (and dedup lookups) exclude accepted/rejected rows.
    // `includeResolved = true` returns the full history for audit/diagnostics.
    const sql = includeResolved
      ? 'SELECT data FROM candidates ORDER BY updated_at DESC'
      : "SELECT data FROM candidates WHERE status = 'pending' ORDER BY updated_at DESC";
    const rows = this.db.prepare(sql).all() as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as MemoryCandidate);
  }

  /**
   * Accept a pending candidate by persisting its text as a memory and marking
   * the candidate `accepted`. Mirrors `SuperMemoryStore.acceptCandidate`.
   *
   * `rememberSuper` acquires the same `store-mutation` file lock as
   * `runMutation`, so the memory creation must happen OUTSIDE the candidate
   * status mutation to avoid a re-entrant deadlock. The candidate is read
   * under the lock, the memory is created, then the status update re-acquires
   * the lock — the same shape as the canonical store, which uses a separate
   * candidates lock file.
   */
  async acceptCandidate(candidateId: string): Promise<SuperMemory | undefined> {
    await this.initialize();
    // Read candidate snapshot under the lock, restricted to `pending` so an
    // already-accepted/rejected candidate cannot be re-resolved (one-way
    // lifecycle transition). Mirrors SuperMemoryStore's pending-only find.
    const snapshot = this.runMutation(() => {
      const row = this.db
        .prepare("SELECT data FROM candidates WHERE id = ? AND status = 'pending'")
        .get(candidateId) as { data: string } | undefined;
      if (!row) return undefined;
      return JSON.parse(row.data) as MemoryCandidate;
    });
    const candidate = await snapshot;
    if (!candidate) return undefined;
    // Create the memory outside the candidate lock to avoid re-entrant
    // lock acquisition on the same file lock.
    const memory = await this.rememberSuper({
      text: candidate.text,
      kind: candidate.kind,
      scope: candidate.scope,
      confidence: candidate.confidence,
      importance: candidate.importance,
      tags: candidate.tags,
      anchors: candidate.anchors,
      audience: candidate.audience,
      sources: candidate.sources,
    });
    // Mark the candidate accepted under the lock. The `status = 'pending'`
    // condition makes the transition atomic and idempotent: a candidate
    // resolved by a concurrent caller (or already resolved) is left
    // untouched, so the one-way lifecycle cannot be overwritten or applied
    // twice. The memory is still returned because it was legitimately
    // created; only the redundant candidate re-write is skipped.
    await this.runMutation(() => {
      const row = this.db
        .prepare("SELECT data FROM candidates WHERE id = ? AND status = 'pending'")
        .get(candidateId) as { data: string } | undefined;
      if (!row) return;
      const current = JSON.parse(row.data) as MemoryCandidate;
      const updated: MemoryCandidate = {
        ...current,
        status: 'accepted',
        memoryId: memory.id,
        updatedAt: this.nowIso(),
      };
      this.db
        .prepare(
          'INSERT OR REPLACE INTO candidates (id, data, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(updated.id, JSON.stringify(updated), updated.status, updated.createdAt, updated.updatedAt);
      this.audit('memory.candidate_accepted', { memoryId: memory.id, details: { candidateId } });
    });
    return memory;
  }

  /**
   * Reject a pending candidate, recording the reason. Mirrors
   * `SuperMemoryStore.rejectCandidate`. Runs under the mutation lock so the
   * status transition is atomic with the audit log.
   */
  async rejectCandidate(candidateId: string, reason: string): Promise<boolean> {
    await this.initialize();
    return this.runMutation(() => {
      // Restrict to `pending` so a resolved candidate cannot be re-resolved
      // (one-way lifecycle). Mirrors SuperMemoryStore's pending-only find.
      const row = this.db
        .prepare("SELECT data FROM candidates WHERE id = ? AND status = 'pending'")
        .get(candidateId) as { data: string } | undefined;
      if (!row) return false;
      const candidate = JSON.parse(row.data) as MemoryCandidate;
      const updated: MemoryCandidate = {
        ...candidate,
        status: 'rejected',
        reason: normalizeText(reason),
        updatedAt: this.nowIso(),
      };
      this.db
        .prepare(
          'INSERT OR REPLACE INTO candidates (id, data, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(updated.id, JSON.stringify(updated), updated.status, updated.createdAt, updated.updatedAt);
      this.audit('memory.candidate_rejected', { reason, details: { candidateId } });
      return true;
    });
  }

  /**
   * The redesign contract's decision path (`memory_candidate_resolve`).
   * Applies the review decision to the candidate's TARGET memory and marks
   * the candidate resolved. Mirrors `SuperMemoryStore.resolveCandidate`:
   * `delete` soft-deletes via `updateSuper(status:'deleted')` (audit-preserving
   * — never the hard `deleteSuper` row removal); `archive` sets
   * `status:'archived'`; `keep` leaves the memory untouched and dismisses the
   * proposal. Permanent targets are never deleted (`applied: false`).
   * Memory mutations happen OUTSIDE the candidate mutation lock (both use the
   * same store-mutation lock — see acceptCandidate's note).
   */
  async resolveCandidate(
    candidateId: string,
    decision: CandidateDecision,
    reason?: string,
  ): Promise<MemoryCandidateResolution | undefined> {
    await this.initialize();
    const snapshot = await this.runMutation(() => {
      const row = this.db
        .prepare("SELECT data FROM candidates WHERE id = ? AND status = 'pending'")
        .get(candidateId) as { data: string } | undefined;
      return row ? (JSON.parse(row.data) as MemoryCandidate) : undefined;
    });
    if (!snapshot) {
      // Unknown id → undefined; already-resolved → alreadyResolved marker.
      const any = await this.runMutation(() => {
        const row = this.db.prepare('SELECT data FROM candidates WHERE id = ?').get(candidateId) as
          | { data: string }
          | undefined;
        return row ? (JSON.parse(row.data) as MemoryCandidate) : undefined;
      });
      if (!any) return undefined;
      return { candidateId, decision, applied: false, alreadyResolved: true };
    }
    const targetId = snapshot.targetMemoryId
      ?? snapshot.tags.find((tag) => tag.startsWith('source:'))?.slice('source:'.length);
    const resolutionNote = reason ?? (decision === 'keep' ? 'Reviewed: keep' : `Reviewed: ${decision}`);
    // Atomic claim: only the caller that flips pending → terminal state owns
    // this resolution. Interleaved decisions see `alreadyResolved` instead of
    // double-applying memory mutations.
    const claimed = await this.runMutation(() => {
      const updated: MemoryCandidate = {
        ...snapshot,
        status: decision === 'keep' ? 'rejected' : 'accepted',
        reason: normalizeText(resolutionNote),
        updatedAt: this.nowIso(),
      };
      const result = this.db
        .prepare("UPDATE candidates SET data = ?, status = ?, updated_at = ? WHERE id = ? AND status = 'pending'")
        .run(JSON.stringify(updated), updated.status, updated.updatedAt, candidateId);
      return result.changes > 0;
    });
    if (!claimed) {
      return { candidateId, decision, applied: false, alreadyResolved: true };
    }
    let applied = false;
    if (decision !== 'keep' && targetId) {
      const target = await this.runMutation(() => {
        const row = this.db.prepare('SELECT data FROM memories WHERE id = ?').get(targetId) as
          | { data: string }
          | undefined;
        return row ? (JSON.parse(row.data) as SuperMemory) : undefined;
      });
      // Permanent memories refuse deletion (matches SuperMemoryStore.resolveCandidate
      // and deleteSuperMemory's force guard). Explicit archival is still permitted —
      // permanence protects against destructive removal, not lifecycle archival.
      const isPermanent = target && (target.persistence ?? 'long_lived') === 'permanent';
      if (target && (decision === 'archive' || !isPermanent)) {
        try {
          await this.updateSuper(targetId, { status: decision === 'delete' ? 'deleted' : 'archived' });
          applied = true;
        } catch {
          applied = false; // Target vanished between read and write.
        }
      }
    } else if (decision === 'keep') {
      applied = true; // Nothing to mutate — the memory is kept as-is.
    }
    this.audit('memory.candidate_resolved', {
      ...(targetId ? { memoryId: targetId } : {}),
      reason: resolutionNote,
      details: { candidateId, decision, applied },
    });
    return { candidateId, decision, ...(targetId ? { targetMemoryId: targetId } : {}), applied };
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

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
