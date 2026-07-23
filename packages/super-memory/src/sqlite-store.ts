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

import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { MemoryEntry, MemoryScope, MemoryStore } from '@wrongstack/core/types';
import { ensureDir, superMemoryCachePragmas, ulid, withFileLock } from '@wrongstack/core/utils';

import { verifyMemoryAnchors } from './anchors/verify.js';
import {
  ancestorPaths,
  normalizeProjectPath,
  normalizeSlashes,
  resolveSuperMemoryPaths,
} from './paths.js';
import {
  canonicalMemoryText,
  clamp01,
  normalizeAnchors,
  normalizeAudience,
  normalizeSources,
  normalizeTags,
  normalizeText,
  normalizeTextKey,
  scoreMemoryRelationship,
  validateRememberInput,
} from './store-helpers.js';
import type {
  CandidateDecision,
  CreateCandidateInput,
  LegacyImportResult,
  ListSuperPageOptions,
  ListSuperPageResult,
  MemoryAnchor,
  MemoryAudienceContext,
  MemoryCandidate,
  MemoryCandidateResolution,
  MemoryGraphEdge,
  MemoryGraphRelation,
  MemoryVerificationResult,
  RememberSuperMemoryInput,
  SessionConsolidationInput,
  SessionConsolidationResult,
  SuperMemory,
  SuperMemoryAuditRecord,
  SuperMemoryForPathOptions,
  SuperMemoryHygieneOptions,
  SuperMemoryHygieneReport,
  SuperMemoryManifest,
  SuperMemoryRecord,
  SuperMemorySearchOptions,
  SuperMemoryStats,
  SuperMemoryStatus,
  SuperMemoryStoreOptions,
  UpdateSuperMemoryInput,
} from './types.js';
import {
  DEFAULT_PERSISTENCE,
  legacyToSuperScope,
  legacyTypeToKind,
  SUPER_MEMORY_SCHEMA_VERSION,
  superToLegacyScope,
  toLegacyEntry,
} from './types.js';
import { computeResolution, rejectIfUnsafeInput, resolveTargetId } from './shared/candidate-lifecycle.js';
import { consolidateSession as sharedConsolidateSession } from './shared/session-consolidation.js';
import {
  VALID_MEMORY_STATUSES,
  DEFAULT_PAGE_STATUSES,
  clampPageLimit,
  encodePageCursor,
} from './shared/pagination.js';

// ─── Pagination helpers (mirror SuperMemoryStore.listSuperPage semantics) ──

/** Escape `%`, `_`, and `\` so a user query is treated literally inside LIKE (ESCAPE '\\'). */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

interface PageCursor {
  updatedAt: string;
  id: string;
}

/** Decode an opaque cursor token; returns undefined for missing/malformed input. */
function decodePageCursor(cursor: string | undefined): PageCursor | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      u?: unknown;
      i?: unknown;
    };
    if (typeof parsed.u === 'string' && typeof parsed.i === 'string') {
      return { updatedAt: parsed.u, id: parsed.i };
    }
  } catch {
    // Malformed cursor → treat as first page.
  }
  return undefined;
}

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
    const msg = typeof w === 'string' ? w : ((w as Error)?.message ?? '');
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

const SQLITE_SCHEMA_VERSION = 3;
const LEGACY_JSONL_MIGRATION_KEY = 'legacy_jsonl_migrated';

/** Local command helpers (mirror store-helpers; kept private to this module). */
function sqliteNormalizeCommand(command: string): string {
  return command.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}
function sqliteCommandFamily(command: string): string {
  return command.split(/\s+/).slice(0, 2).join(' ');
}

function initSchema(db: DatabaseSync): void {
  // WAL + NORMAL is the multi-process sweet spot used across WrongStack SQLite stores.
  // cache_size/temp_store/mmap reduce page-cache thrash on hot read paths (search, list, inject).
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA busy_timeout = 30000');
  db.exec('PRAGMA temp_store = MEMORY');
  // Cache/mmap follow WRONGSTACK_PERF_PROFILE (frugal = leaner RSS).
  const cache = superMemoryCachePragmas();
  db.exec(`PRAGMA cache_size = -${cache.cacheSizeKiB}`);
  db.exec(`PRAGMA mmap_size = ${cache.mmapBytes}`);
  db.exec('PRAGMA foreign_keys = ON');

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
      tags TEXT,
      canonical_text TEXT NOT NULL DEFAULT ''
    );
  `);

  db.exec('CREATE INDEX IF NOT EXISTS idx_status ON memories(status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_kind ON memories(kind)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_scope ON memories(scope)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_importance ON memories(importance DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_updated ON memories(updated_at DESC)');
  // Indexes that reference versioned columns are created after migrations.
  // CREATE TABLE IF NOT EXISTS does not add columns to an existing database,
  // so creating those indexes here would prevent the migration that adds the
  // columns from ever running.
  // Hot composite paths: ranked list and keyset pagination.
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_status_importance_updated ON memories(status, importance DESC, updated_at DESC)',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_status_updated_id ON memories(status, updated_at DESC, id DESC)',
  );

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
      updated_at TEXT NOT NULL,
      canonical_text TEXT NOT NULL DEFAULT ''
    );
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_candidates_status_created ON candidates(status, created_at DESC)',
  );
  // Shared-anchor lookups for findRelatedSuper / retrieveForPath.
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_edge_to_relation ON edges(to_node, relation)',
  );
}

// ─── Store ──────────────────────────────────────────────────────────────

/**
 * @deprecated Use `createSqliteMemoryPort` and depend on Core's `MemoryPort`.
 * This class remains public only for the compatibility window.
 */
function sqliteAnchorNode(anchor: MemoryAnchor): string | undefined {
  switch (anchor.type) {
    case 'file':
    case 'test':
    case 'git': {
      const normalizedPath = anchor.path ? normalizeSlashes(anchor.path) : undefined;
      return normalizedPath ? `file:${normalizedPath}` : undefined;
    }
    case 'directory': {
      const normalizedPath = anchor.path ? normalizeSlashes(anchor.path) : undefined;
      return normalizedPath ? `dir:${normalizedPath}` : undefined;
    }
    case 'symbol': {
      const normalizedPath = anchor.path ? normalizeSlashes(anchor.path) : undefined;
      return normalizedPath && anchor.symbol
        ? `symbol:${normalizedPath}#${anchor.symbol}`
        : undefined;
    }
    case 'package': {
      const normalizedPath = anchor.path ? normalizeSlashes(anchor.path) : undefined;
      return normalizedPath ? `dir:${normalizedPath}` : undefined;
    }
    case 'command':
      return anchor.command ? `command:${anchor.command.trim().replace(/\s+/g, ' ')}` : undefined;
    case 'agent':
      return anchor.role ? `agent:${anchor.role.trim().toLowerCase()}` : undefined;
  }
}

function sqliteAnchorRelation(anchor: MemoryAnchor): MemoryGraphRelation | undefined {
  switch (anchor.type) {
    case 'file':
    case 'test':
    case 'git':
      return 'about_file';
    case 'directory':
      return 'about_directory';
    case 'symbol':
      return 'about_symbol';
    case 'package':
      return 'about_package';
    case 'command':
      return 'about_command';
    case 'agent':
      return 'about_agent';
  }
}

export class SqliteSuperMemoryStore implements MemoryStore {
  readonly paths;
  private readonly projectRoot: string;
  private readonly now: () => Date;
  private readonly events: SuperMemoryStoreOptions['events'];
  private traceId?: string | undefined;
  private db!: DatabaseSync;
  private initialized = false;
  private initializing: Promise<void> | undefined;
  private mutationChain: Promise<unknown> = Promise.resolve();
  /**
   * Prepared-statement cache. `DatabaseSync.prepare()` recompiles SQL every call;
   * hot paths (remember, inject, search, list) re-use the same SQL thousands of
   * times per session, so compile once and reuse per connection.
   */
  private readonly stmtCache = new Map<string, ReturnType<DatabaseSync['prepare']>>();

  constructor(opts: SuperMemoryStoreOptions) {
    this.projectRoot = path.resolve(opts.projectRoot);
    this.paths = resolveSuperMemoryPaths(this.projectRoot, opts.directory);
    this.traceId = opts.traceId;
    this.now = opts.now ?? (() => new Date());
    this.events = opts.events;
  }

  withTraceId(traceId: string): this {
    this.traceId = traceId;
    return this;
  }

  /** Prepare-once helper: compile `sql` on first use, reuse thereafter. */
  private stmt(sql: string): ReturnType<DatabaseSync['prepare']> {
    let prepared = this.stmtCache.get(sql);
    if (prepared === undefined) {
      prepared = this.db.prepare(sql);
      this.stmtCache.set(sql, prepared);
    }
    return prepared;
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

    // Check schema version and apply migrations
    const row = this.stmt('SELECT value FROM schema_meta WHERE key = ?').get('version') as
      | { value?: number }
      | undefined;
    // Fresh DB: the schema was just created by initSchema() with the latest
    // version (including canonical_text), so skip all migrations.
    const currentVersion = row?.value ?? SQLITE_SCHEMA_VERSION;
    if (!row) {
      this.stmt('INSERT INTO schema_meta (key, value) VALUES (?, ?)')
        .run('version', SQLITE_SCHEMA_VERSION);
    }

    if (currentVersion < 2) {
      // Migration v1 → v2: add canonical_text column for O(1) dedup lookups.
      // The column is backfilled from the existing data JSON once, then
      // maintained by upsertMemory on every write.
      //
      // Wrapped in a transaction so a crash mid-backfill does not leave the
      // column added with partial backfill and schema_meta still at v1.
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.exec("ALTER TABLE memories ADD COLUMN canonical_text TEXT NOT NULL DEFAULT ''");
        // Backfill existing rows (safe to re-run — ALTER TABLE ADD COLUMN is
        // idempotent on the column itself, but backfill should only run once).
        const backfillRows = this.stmt("SELECT id, data FROM memories WHERE canonical_text = ''")
          .all() as Array<{ id: string; data: string }>;
        if (backfillRows.length > 0) {
          const stmt = this.stmt('UPDATE memories SET canonical_text = ? WHERE id = ?');
          for (const r of backfillRows) {
            const memory = JSON.parse(r.data) as SuperMemory;
            stmt.run(normalizeTextKey(memory.text), r.id);
          }
        }
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_canonical_text ON memories(canonical_text)');
        this.stmt('UPDATE schema_meta SET value = ? WHERE key = ?').run(2, 'version');
        this.db.exec('COMMIT');
      } catch (migrationErr) {
        this.db.exec('ROLLBACK');
        throw migrationErr;
      }
    }

    if (currentVersion < 3) {
      // Migration v2 → v3:
      // 1) candidates.canonical_text for O(1) pending dedup
      // 2) backfill typed about_* edges from anchors (JSONL-import gaps)
      // 3) supporting indexes for path/related lookups
      this.db.exec('BEGIN IMMEDIATE');
      try {
        try {
          this.db.exec(
            "ALTER TABLE candidates ADD COLUMN canonical_text TEXT NOT NULL DEFAULT ''",
          );
        } catch {
          // Column already present (fresh CREATE TABLE path or partial upgrade).
        }
        const candidateRows = this.stmt(
          "SELECT id, data FROM candidates WHERE canonical_text = ''",
        ).all() as Array<{ id: string; data: string }>;
        if (candidateRows.length > 0) {
          const upd = this.stmt('UPDATE candidates SET canonical_text = ? WHERE id = ?');
          for (const r of candidateRows) {
            try {
              const candidate = JSON.parse(r.data) as MemoryCandidate;
              upd.run(normalizeTextKey(candidate.text ?? ''), r.id);
            } catch {
              upd.run('', r.id);
            }
          }
        }
        this.db.exec(
          'CREATE INDEX IF NOT EXISTS idx_candidates_status_canonical ON candidates(status, canonical_text)',
        );
        this.db.exec(
          'CREATE INDEX IF NOT EXISTS idx_edge_to_relation ON edges(to_node, relation)',
        );

        // Rebuild about_* edges from persisted anchors so path/related queries
        // can use the edge index instead of full-table JSON LIKE scans.
        const memRows = this.stmt(
          "SELECT data FROM memories WHERE status != 'deleted'",
        ).all() as Array<{ data: string }>;
        for (const row of memRows) {
          try {
            this.syncAnchorEdges(this.rowToMemory(row));
          } catch {
            // Skip corrupt rows — they remain queryable via JSON fallbacks.
          }
        }

        this.stmt('UPDATE schema_meta SET value = ? WHERE key = ?').run(3, 'version');
        this.db.exec('COMMIT');
      } catch (migrationErr) {
        this.db.exec('ROLLBACK');
        throw migrationErr;
      }
    }

    // These indexes depend on columns introduced by schema migrations. Create
    // them only after every required ALTER TABLE has completed. This is also
    // needed for a fresh database, where no migration block runs.
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_canonical_text ON memories(canonical_text)');
    this.db.exec(
      'CREATE INDEX IF NOT EXISTS idx_status_scope_canonical ON memories(status, scope, canonical_text)',
    );
    this.db.exec(
      'CREATE INDEX IF NOT EXISTS idx_candidates_status_canonical ON candidates(status, canonical_text)',
    );

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

    // Import every legacy JSONL memory artifact exactly once. This also runs
    // when the database already contains rows, because older releases allowed
    // users to switch back to JSONL and create revisions after SQLite existed.
    await this.migrateFromJsonl();

    this.initialized = true;
  }

  // ─── JSONL migration ────────────────────────────────────────────────

  private async migrateFromJsonl(): Promise<void> {
    const legacyPaths = [
      this.paths.memoriesLog,
      this.paths.candidatesLog,
      this.paths.edgesLog,
      this.paths.auditLog,
    ];
    if (!legacyPaths.some((filePath) => fs.existsSync(filePath))) return;

    const alreadyMigrated = this.stmt('SELECT value FROM schema_meta WHERE key = ?')
      .get(LEGACY_JSONL_MIGRATION_KEY);
    if (alreadyMigrated) return;

    const readLegacy = async <T>(filePath: string): Promise<T[]> => {
      let raw: string;
      try {
        raw = await fs.promises.readFile(filePath, 'utf8');
      } catch {
        // Legacy file doesn't exist or can't be read — treat as empty.
        return [];
      }
      const result: T[] = [];
      const lines = raw.split('\n');
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const trimmed = lines[lineIndex]!.trim();
        if (!trimmed) continue;
        try { result.push(JSON.parse(trimmed) as T); }
        catch { throw new Error(`Corrupt legacy JSONL in ${filePath} at line ${lineIndex + 1}`); }
      }
      return result;
    };

    const [memoryRows, candidateRows, edgeRows, auditRows] = await Promise.all([
      readLegacy<unknown>(this.paths.memoriesLog),
      readLegacy<unknown>(this.paths.candidatesLog),
      readLegacy<unknown>(this.paths.edgesLog),
      readLegacy<unknown>(this.paths.auditLog),
    ]);

    const latestMemories = new Map<string, SuperMemory>();
    for (const row of memoryRows) {
      if (!isMigratableMemoryRecord(row)) continue;
      const incoming = row.memory;
      const current = latestMemories.get(incoming.id);
      if (!current || shouldReplaceMigratedMemory(current, incoming)) {
        latestMemories.set(incoming.id, incoming);
      }
    }

    const latestCandidates = new Map<string, MemoryCandidate>();
    for (const row of candidateRows) {
      if (isMigratableCandidate(row)) latestCandidates.set(row.id, row);
    }

    const latestEdges = new Map<string, MemoryGraphEdge>();
    for (const row of edgeRows) {
      if (isMigratableEdge(row)) latestEdges.set(row.id, row);
    }

    const audits = auditRows.filter(isMigratableAuditRecord);
    let migratedMemories = 0;
    let migratedCandidates = 0;
    let migratedEdges = 0;

    this.db.exec('BEGIN IMMEDIATE');
    try {
      // A second process may have completed migration while this process was
      // reading the source files. Re-check under SQLite's write transaction.
      const migratedByPeer = this.stmt('SELECT value FROM schema_meta WHERE key = ?')
        .get(LEGACY_JSONL_MIGRATION_KEY);
      if (migratedByPeer) {
        this.db.exec('COMMIT');
        return;
      }

      for (const incoming of latestMemories.values()) {
        const existingRow = this.stmt('SELECT data FROM memories WHERE id = ?')
          .get(incoming.id) as { data: string } | undefined;
        const existing = existingRow ? this.rowToMemory(existingRow) : undefined;
        if (existing && !shouldReplaceMigratedMemory(existing, incoming)) continue;
        this.upsertMemory(incoming);
        // Ensure about_* edges exist so path/related queries use the edge index.
        this.syncAnchorEdges(incoming);
        migratedMemories++;
      }

      const upsertCandidate = this.stmt(
        `INSERT OR REPLACE INTO candidates
          (id, data, status, created_at, updated_at, canonical_text)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const candidate of latestCandidates.values()) {
        const existingRow = this.stmt('SELECT data FROM candidates WHERE id = ?')
          .get(candidate.id) as { data: string } | undefined;
        if (existingRow) {
          const existing = JSON.parse(existingRow.data) as MemoryCandidate;
          if (existing.updatedAt.localeCompare(candidate.updatedAt) > 0) continue;
        }
        upsertCandidate.run(
          candidate.id,
          JSON.stringify(candidate),
          candidate.status,
          candidate.createdAt,
          candidate.updatedAt,
          normalizeTextKey(candidate.text ?? ''),
        );
        migratedCandidates++;
      }

      const upsertEdge = this.stmt(
        `INSERT INTO edges (from_node, to_node, relation, weight, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(from_node, to_node, relation) DO UPDATE SET
           weight = excluded.weight`,
      );
      const deleteEdge = this.stmt(
        'DELETE FROM edges WHERE from_node = ? AND to_node = ? AND relation = ?',
      );
      for (const edge of latestEdges.values()) {
        if (edge.deletedAt) {
          deleteEdge.run(edge.from, edge.to, edge.relation);
          continue;
        }
        upsertEdge.run(edge.from, edge.to, edge.relation, edge.weight, edge.createdAt);
        migratedEdges++;
      }

      const insertAudit = this.stmt(
        'INSERT INTO audit_log (event, at, trace_id, data) VALUES (?, ?, ?, ?)',
      );
      for (const audit of audits) {
        insertAudit.run(audit.event, audit.at, audit.traceId ?? null, JSON.stringify(audit));
      }

      insertAudit.run(
        'memory.legacy_jsonl_migrated',
        this.nowIso(),
        this.traceId ?? null,
        JSON.stringify({
          memories: migratedMemories,
          candidates: migratedCandidates,
          edges: migratedEdges,
          auditRecords: audits.length,
        }),
      );
      this.stmt('INSERT INTO schema_meta (key, value) VALUES (?, 1)')
        .run(LEGACY_JSONL_MIGRATION_KEY);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ─── Core helpers ───────────────────────────────────────────────────

  private nowIso(): string {
    return this.now().toISOString();
  }

  private rowToMemory(row: { data: string }): SuperMemory {
    return JSON.parse(row.data) as SuperMemory;
  }

  /** Prefix used for graph node ids referencing memories. */
  private static readonly NODE_ID_PREFIX = 'mem:';

  /** Build the canonical graph node id for a memory. */
  private static toNodeId(memoryId: string): string {
    return `${SqliteSuperMemoryStore.NODE_ID_PREFIX}${memoryId}`;
  }

  /**
   * Reconstruct the human-readable structural evidence (`<anchorType>:<path>`)
   * for an `about_*` anchor edge from its relation and target node. The JSONL
   * store stored evidence on each edge; the SQLite edges table doesn't carry it,
   * so we derive it on read for the host-facing graph surface.
   */
  private static edgeEvidence(
    relation: string,
    toNode: string,
  ): { evidence: string[] } | undefined {
    const match = /^about_(\w+)$/.exec(relation);
    if (!match) return undefined;
    const anchorType = match[1];
    const anchorPath = toNode.replace(/^(file|dir|symbol):/, '');
    return { evidence: [`${anchorType}:${anchorPath}`] };
  }

  /** SQL GLOB matching every graph node id owned by a memory. */
  private static readonly MEMORY_NODE_GLOB = `${SqliteSuperMemoryStore.NODE_ID_PREFIX}*`;

  /**
   * Cascade-delete all graph edges referencing a given node id.
   * Called from forget(), clear(), and deleteSuperMemory() so the edge
   * cleanup logic is maintained in one place.
   */
  private cascadeDeleteEdges(nodeId: string): void {
    this.stmt('DELETE FROM edges WHERE from_node = ? OR to_node = ?').run(nodeId, nodeId);
  }

  /**
   * Serialize mutations with the file lock and a single SQLite write transaction.
   * Multi-statement paths (remember merge, cascade delete, counter batch) commit
   * once instead of once per prepared statement.
   */
  private runMutation<T>(work: () => T): Promise<T> {
    const next = this.mutationChain
      .catch(() => undefined)
      .then(async () =>
        withFileLock(
          path.join(this.paths.locksDir, 'store-mutation'),
          async () => {
            this.db.exec('BEGIN IMMEDIATE');
            try {
              const result = work();
              this.db.exec('COMMIT');
              return result;
            } catch (err) {
              try {
                this.db.exec('ROLLBACK');
              } catch {
                // No open transaction (e.g. BEGIN itself failed).
              }
              throw err;
            }
          },
          {
            timeoutMs: 60_000,
            staleMs: 30 * 60_000,
          },
        ),
      );
    this.mutationChain = next;
    return next as Promise<T>;
  }

  // ─── Public API ─────────────────────────────────────────────────────

  /**
   * Store (or merge) a Super Memory record.
   *
   * **Field precedence for the dual-bridge API:**
   * - `scope` (SuperMemoryScope) and `kind` (SuperMemoryKind) are the primary
   *   fields. `legacyScope` (MemoryScope) and `type` (MemoryType) are read-only
   *   bridges for backward compatibility with the legacy `MemoryStore` API.
   * - When `scope` is omitted, it is derived from `legacyScope` via
   *   `legacyToSuperScope()`.  Defaults to `'project'` when neither is given.
   * - When `kind` is omitted, it is derived from `type` via
   *   `legacyTypeToKind()`.  Defaults to `'fact'` when neither is given.
   * - **`kind` always wins over `type`**, and **`scope` always wins over
   *   `legacyScope`**.  Callers supplying both should ensure they are
   *   semantically consistent.
   */
  async rememberSuper(input: RememberSuperMemoryInput): Promise<SuperMemory> {
    validateRememberInput(input);
    const normalizedText = normalizeText(input.text);
    if (!normalizedText) throw new Error('Super Memory text must not be empty.');
    rejectIfUnsafeInput(input);
    await this.initialize();

    // Default to project scope when neither `scope` (SuperMemoryScope) nor
    // `legacyScope` (MemoryScope) is given. This fallback is intentional:
    // legacy callers such as `remember('text')` and the migration pipeline
    // do not pass an explicit scope, and `'project-memory'` is the correct
    // default for those paths. See `RememberSuperMemoryInput` for field docs.
    const scope = input.scope ?? legacyToSuperScope(input.legacyScope ?? 'project-memory');
    // Preserve undefined legacyScope when not provided — matches
    // SuperMemoryStore.rememberSuper (store.ts:290). The effective legacy
    // scope is always resolved at query time via
    // `memory.legacyScope ?? superToLegacyScope(memory.scope)`, so storing
    // undefined is safe and avoids a silent scope/legacyScope divergence.
    const legacyScope = input.legacyScope;
    const kind = input.kind ?? legacyTypeToKind(input.type);
    const tags = normalizeTags(input.tags);
    const anchors = normalizeAnchors(this.projectRoot, input.anchors ?? []);
    const audience = normalizeAudience(input.audience);
    const sources = normalizeSources(input.sources ?? [{ type: 'user' }]);
    const nowIso = this.nowIso();

    return this.runMutation(() => {
      // Check for duplicate by canonical text via indexed column.
      // The canonical_text column (populated by upsertMemory) stores
      // normalizeTextKey(text) so dedup is a single indexed lookup instead
      // of an O(N) full-table scan.
      const canonical = normalizeTextKey(normalizedText);
      // Audience-scoped memories dedupe only within their own audience: same
      // text + scope but different roles/tasks are distinct records. Mirrors the
      // JSONL store's memoryIdentity, which folds audienceIdentity into the key.
      // The stored `audience` column is JSON.stringify(normalizeAudience(...)),
      // matching this key exactly (both run through normalizeAudience).
      const audienceKey = audience ? JSON.stringify(audience) : null;
      const row = this.stmt(
          `SELECT data FROM memories
           WHERE status IN ('active','stale') AND scope = ? AND canonical_text = ?
             AND audience IS ?
           LIMIT 1`,
        )
        .get(scope, canonical, audienceKey) as { data: string } | undefined;

      if (row) {
        const existing = this.rowToMemory(row);
        // Merge
        const merged: SuperMemory = {
          ...existing,
          // Preserve existing legacyScope on merge (first-write wins),
          // matching SuperMemoryStore (store.ts) merge behaviour where
          // legacyScope is excluded from the mergedPatch and the original
          // value is never overwritten.
          legacyScope: existing.legacyScope,
          tags: [...new Set([...existing.tags, ...tags])],
          anchors: [
            ...new Map(
              [...existing.anchors, ...anchors].map((a) => [JSON.stringify(a), a]),
            ).values(),
          ] as MemoryAnchor[],
          ...(audience ? { audience } : {}),
          sources: [
            ...new Map(
              [...existing.sources, ...sources].map((s) => [JSON.stringify(s), s]),
            ).values(),
          ],
          supersedes: [...new Set([...(existing.supersedes ?? []), ...(input.supersedes ?? [])])],
          contradicts: [
            ...new Set([...(existing.contradicts ?? []), ...(input.contradicts ?? [])]),
          ],
          importance: Math.max(
            existing.importance,
            clamp01(input.importance ?? importanceFromPriority(input.priority)),
          ),
          confidence: Math.max(existing.confidence, input.confidence ?? 0.8),
          freshness: Math.max(existing.freshness, input.freshness ?? 1),
          updatedAt: nowIso,
          revision: existing.revision + 1,
        };
        this.upsertMemory(merged);
        this.syncAnchorEdges(merged);
        this.events?.emit(
          'memory.merged',
          this.eventPayload({ memoryId: merged.id, mergedIds: [] }),
        );
        return merged;
      }

      // Create new
      const memory: SuperMemory = {
        id: ulid(),
        revision: 1,
        text: normalizedText,

        kind,
        scope,
        legacyScope,
        status: 'active',
        tags,
        anchors,
        sources,
        audience,
        importance: clamp01(input.importance ?? importanceFromPriority(input.priority)),
        confidence: clamp01(input.confidence ?? 0.8),
        freshness: clamp01(input.freshness ?? 1),
        persistence: input.persistence,
        supersedes: input.supersedes,
        contradicts: input.contradicts,
        supersededBy: undefined,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      this.upsertMemory(memory);
      this.syncAnchorEdges(memory);
      this.events?.emit(
        'memory.accepted',
        this.eventPayload({
          memoryId: memory.id,
          kind: memory.kind,
          persistence: memory.persistence ?? DEFAULT_PERSISTENCE,
          confidence: memory.confidence,
          freshness: memory.freshness,
        }),
      );
      return memory;
    });
  }

  // ─── Legacy MemoryStore compatibility ──────────────────────────────

  async readAll(): Promise<string> {
    const sections: string[] = [];
    for (const scope of ['project-agents', 'project-memory', 'user-memory'] as const) {
      const body = await this.read(scope);
      if (body) sections.push(`## ${legacyScopeLabel(scope)}\n\n${body}`);
    }
    return sections.join('\n\n');
  }

  async read(scope: MemoryScope): Promise<string> {
    return (await this.list(scope))
      .map((entry) => {
        const tags = entry.tags?.length ? ` ${entry.tags.map((tag) => `#${tag}`).join(' ')}` : '';
        const type = entry.type
          ? ` [${entry.type}${entry.priority ? `|${entry.priority}` : ''}]`
          : '';
        return `- [${entry.ts}]${type} ${entry.text}${tags}`;
      })
      .join('\n');
  }

  async remember(
    text: string,
    scope: MemoryScope = 'project-memory',
    metadata?: Omit<Partial<MemoryEntry>, 'scope' | 'text' | 'ts'>,
  ): Promise<void> {
    await this.rememberSuper({
      text,
      legacyScope: scope,
      scope: legacyToSuperScope(scope),
      type: metadata?.type,
      tags: metadata?.tags,
      priority: metadata?.priority,
      confidence: metadata?.confidence,
      sources: metadata?.source
        ? [{ type: 'legacy_memory', excerptHash: metadata.source }]
        : undefined,
    });
  }

  async forget(query: string, scope: MemoryScope = 'project-memory'): Promise<number> {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return 0;
    await this.initialize();
    const superScope = legacyToSuperScope(scope);
    return this.runMutation(() => {
      const rows = this.stmt(
          "SELECT data FROM memories WHERE status != 'deleted' AND (scope = ? OR json_extract(data, '$.legacyScope') = ?)",
        )
        .all(superScope, scope) as Array<{ data: string }>;
      let removed = 0;
      const skippedPermanent: string[] = [];
      for (const row of rows) {
        const memory = this.rowToMemory(row);
        if ((memory.legacyScope ?? superToLegacyScope(memory.scope)) !== scope) continue;
        if (!matchesLegacyForget(memory, normalized)) continue;
        if ((memory.persistence ?? DEFAULT_PERSISTENCE) === 'permanent') {
          skippedPermanent.push(memory.id);
          continue;
        }
        this.upsertMemory({
          ...memory,
          status: 'deleted',
          revision: memory.revision + 1,
          updatedAt: this.nowIso(),
        });
        // Cascade-delete graph edges so orphan rows don't accumulate.
        this.cascadeDeleteEdges(SqliteSuperMemoryStore.toNodeId(memory.id));
        removed++;
      }
      if (removed > 0) {
        this.audit('memory.deleted', { reason: query, details: { removed, scope } });
        this.events?.emit('memory.forgotten', { scope, query, removed });
      }
      if (skippedPermanent.length > 0) {
        this.audit('memory.forget_skipped_permanent', {
          reason: query,
          details: { skipped: skippedPermanent, scope },
        });
      }
      return removed;
    });
  }

  async consolidate(scope: MemoryScope): Promise<void> {
    await this.initialize();
    await this.runMutation(() => {
      // Push scope filter into SQL using the indexed `scope` column so the
      // consolidator does not incur O(N) full-table JSON parses every call.
      // The JS fallback on the effective legacy scope still catches edge
      // cases where an explicit legacyScope differs from the column value.
      const superScope = legacyToSuperScope(scope);
      const rows = this.stmt(
          "SELECT data FROM memories WHERE status IN ('active','stale') AND (scope = ? OR json_extract(data, '$.legacyScope') = ?)",
        )
        .all(superScope, scope) as Array<{ data: string }>;
      const groups = new Map<string, SuperMemory[]>();
      for (const row of rows) {
        const memory = this.rowToMemory(row);
        if ((memory.legacyScope ?? superToLegacyScope(memory.scope)) !== scope) continue;
        const key = normalizeTextKey(memory.text);
        const group = groups.get(key);
        if (group) group.push(memory);
        else groups.set(key, [memory]);
      }
      let removed = 0;
      for (const group of groups.values()) {
        if (group.length < 2) continue;
        const [keeper, ...duplicates] = [...group].sort(
          (a, b) => b.importance - a.importance || b.confidence - a.confidence,
        );
        if (!keeper) continue;
        const updatedKeeper: SuperMemory = {
          ...keeper,
          tags: [...new Set(group.flatMap((memory) => memory.tags))],
          supersedes: [
            ...new Set([...(keeper.supersedes ?? []), ...duplicates.map((memory) => memory.id)]),
          ],
          revision: keeper.revision + 1,
          updatedAt: this.nowIso(),
        };
        this.upsertMemory(updatedKeeper);
        this.syncAnchorEdges(updatedKeeper);
        for (const duplicate of duplicates) {
          const supersededDuplicate: SuperMemory = {
            ...duplicate,
            status: 'superseded',
            supersededBy: keeper.id,
            revision: duplicate.revision + 1,
            updatedAt: this.nowIso(),
          };
          this.upsertMemory(supersededDuplicate);
          this.syncAnchorEdges(supersededDuplicate);
          removed++;
        }
      }
      if (removed > 0) this.events?.emit('memory.consolidated', { scope, removed });
      this.audit('memory.consolidation_completed', { details: { scope, removed } });
    });
  }

  async clear(scope?: MemoryScope): Promise<void> {
    await this.initialize();
    const superScope = scope ? legacyToSuperScope(scope) : undefined;
    await this.runMutation(() => {
      const scopeClause = scope
        ? " AND (scope = ? OR json_extract(data, '$.legacyScope') = ?)"
        : '';
      const params: string[] = scope ? [superScope!, scope] : [];
      const rows = this.stmt(`SELECT data FROM memories WHERE status != 'deleted'${scopeClause}`)
        .all(...params) as Array<{ data: string }>;
      const skippedPermanent: string[] = [];
      const clearedIds: string[] = [];
      for (const row of rows) {
        const memory = this.rowToMemory(row);
        const legacyScope = memory.legacyScope ?? superToLegacyScope(memory.scope);
        if (scope && legacyScope !== scope) continue;
        if ((memory.persistence ?? DEFAULT_PERSISTENCE) === 'permanent') {
          skippedPermanent.push(memory.id);
          continue;
        }
        this.upsertMemory({
          ...memory,
          status: 'deleted',
          revision: memory.revision + 1,
          updatedAt: this.nowIso(),
        });
        // Cascade-delete graph edges so orphan rows don't accumulate
        // (matches forget() and deleteSuperMemory()).
        this.cascadeDeleteEdges(SqliteSuperMemoryStore.toNodeId(memory.id));
        clearedIds.push(memory.id);
      }
      if (clearedIds.length > 0) {
        this.events?.emit('memory.cleared', { scope });
      }
      if (skippedPermanent.length > 0) {
        this.audit('memory.clear_skipped_permanent', {
          details: { skipped: skippedPermanent, scope: scope ?? 'all' },
        });
      }
      this.audit('memory.bulk_clear_completed', {
        details: {
          scope: scope ?? 'all',
          deleted: clearedIds.length,
          skippedPermanent: skippedPermanent.length,
        },
      });
    });
  }

  async list(scope: MemoryScope = 'project-memory', limit?: number): Promise<MemoryEntry[]> {
    await this.initialize();
    const superScope = legacyToSuperScope(scope);
    const rows = this.stmt(
        "SELECT data FROM memories WHERE status = 'active' AND (scope = ? OR json_extract(data, '$.legacyScope') = ?) ORDER BY created_at DESC",
      )
      .all(superScope, scope) as Array<{ data: string }>;
    const entries = rows
      .map((row) => this.rowToMemory(row))
      .filter((memory) => (memory.legacyScope ?? superToLegacyScope(memory.scope)) === scope)
      .map(toLegacyEntry);
    return limit === undefined ? entries : entries.slice(0, Math.max(0, limit));
  }

  private upsertMemory(m: SuperMemory): void {
    // Prefer INSERT … ON CONFLICT DO UPDATE over DELETE+INSERT:
    // - Keeps the same INTEGER rowid so the external-content FTS shadow table
    //   stays aligned without delete/reinsert churn.
    // - AFTER UPDATE triggers correctly rebuild the FTS row (unlike INSERT OR
    //   REPLACE, which skips AFTER DELETE when recursive triggers are off).
    // - One statement instead of two on the hot remember/update path.
    this.stmt(
      `INSERT INTO memories
        (id, data, status, kind, scope, importance, confidence, freshness, updated_at, created_at, audience, tags, canonical_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        data = excluded.data,
        status = excluded.status,
        kind = excluded.kind,
        scope = excluded.scope,
        importance = excluded.importance,
        confidence = excluded.confidence,
        freshness = excluded.freshness,
        updated_at = excluded.updated_at,
        created_at = excluded.created_at,
        audience = excluded.audience,
        tags = excluded.tags,
        canonical_text = excluded.canonical_text`,
    ).run(
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
      normalizeTextKey(m.text),
    );
  }

  /**
   * Maintain typed anchor graph edges for the SQLite-backed store.
   *
   * The canonical JSONL store only rebuilds anchor edges inside its
   * `addAutomaticEdges` consolidation / relationship-proposal pass and
   * skips the rebuild on plain text or tag-only updates. The SQLite port
   * additionally keeps edge weights and soft-delete state in lock-step
   * with memory rows; this is new SQLite-side behavior, not a 1:1 parity
   * of the canonical pass.
   *
   * Responsibility split:
   * - `syncAnchorEdges` (this method) only touches the `about_*` relation
   *   family (file / directory / symbol / package / command / agent).
   *   Callers invoke it after inserts and after updates that change anchors,
   *   confidence, or eligibility for the active/stale anchor graph.
   * - `cascadeDeleteEdges` (used by forget / clear / deleteSuperMemory)
   *   drops *all* outgoing and incoming edges for the memory node, which
   *   is required when a row is fully removed but is overkill for a
   *   plain upsert. The overlap on `about_*` is intentional and safe:
   *   the edge rewrite runs inside `runMutation` so it is serialized,
   *   and `ON CONFLICT … DO UPDATE` makes the inserts idempotent.
   */
  private syncAnchorEdges(memory: SuperMemory): void {
    const from = SqliteSuperMemoryStore.toNodeId(memory.id);
    // The DELETE runs unconditionally so a status flip out of the
    // injectable active/stale set clears the typed anchor subgraph; the
    // early return below then skips re-insertion. Superseded, contradicted,
    // archived, and deleted rows remain queryable for history/audit but must
    // not participate in shared-anchor graph expansion.
    const deleted = this.stmt(
      "DELETE FROM edges WHERE from_node = ? AND relation GLOB 'about_*' RETURNING to_node, relation, created_at",
    ).all(from) as Array<{ to_node: string; relation: string; created_at: string }>;
    const createdAtByEdge = new Map(
      deleted.map((edge) => [`${edge.to_node}\0${edge.relation}`, edge.created_at]),
    );
    if (memory.status !== 'active' && memory.status !== 'stale') return;
    const insert = this.stmt(
      `INSERT INTO edges (from_node, to_node, relation, weight, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(from_node, to_node, relation) DO UPDATE SET
         weight = excluded.weight`,
    );
    for (const anchor of memory.anchors) {
      const target = sqliteAnchorNode(anchor);
      const relation = sqliteAnchorRelation(anchor);
      if (target && relation) {
        const createdAt = createdAtByEdge.get(`${target}\0${relation}`) ?? this.nowIso();
        insert.run(from, target, relation, memory.confidence, createdAt);
      }

      // Structural hierarchy edges (symbol→file, file→dir, dir→dir ancestors).
      // These mirror the JSONL store's addAutomaticEdges so `graph <path>` can
      // walk from a bare path to symbol-anchored memories and stats report the
      // full anchor subgraph, not just the single about_* edge. They are code
      // structure (shared across memories, not memory-scoped), so they are NOT
      // cleared by the about_* DELETE above and are idempotent via ON CONFLICT.
      if (!anchor.path) continue;
      const anchoredPath = normalizeSlashes(anchor.path);
      const isDirectory = anchor.type === 'directory' || anchor.type === 'package';
      const fileNode = `file:${anchoredPath}`;
      const directoryPath = isDirectory
        ? anchoredPath
        : normalizeSlashes(path.posix.dirname(anchoredPath));
      const now = this.nowIso();
      if (anchor.type === 'symbol' && anchor.symbol) {
        insert.run(`symbol:${anchoredPath}#${anchor.symbol}`, fileNode, 'related_to', memory.confidence, now);
      }
      if (!isDirectory) {
        insert.run(fileNode, `dir:${directoryPath}`, 'related_to', 1, now);
      }
      const directories = ancestorPaths(directoryPath);
      for (let i = 0; i < directories.length - 1; i++) {
        insert.run(`dir:${directories[i]}`, `dir:${directories[i + 1]}`, 'related_to', 1, now);
      }
    }
  }

  async updateSuper(id: string, input: UpdateSuperMemoryInput): Promise<SuperMemory> {
    await this.initialize();
    return this.runMutation(() => {
      const row = this.stmt('SELECT data FROM memories WHERE id = ?').get(id) as
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
        ...(input.anchors !== undefined && {
          anchors: normalizeAnchors(this.projectRoot, input.anchors),
        }),
        ...(input.importance !== undefined && {
          importance: Math.max(0, Math.min(1, input.importance)),
        }),
        ...(input.confidence !== undefined && {
          confidence: Math.max(0, Math.min(1, input.confidence)),
        }),
        ...(input.freshness !== undefined && {
          freshness: Math.max(0, Math.min(1, input.freshness)),
        }),
        ...(input.audience !== undefined && { audience: normalizeAudience(input.audience) }),
        ...(input.supersedes !== undefined && { supersedes: input.supersedes }),
        ...(input.contradicts !== undefined && { contradicts: input.contradicts }),
        revision: existing.revision + 1,
        updatedAt: this.nowIso(),
      };
      this.upsertMemory(updated);
      const statusAffectsAnchorEdges =
        input.status !== undefined && existing.status !== updated.status;
      if (
        input.anchors !== undefined ||
        input.confidence !== undefined ||
        statusAffectsAnchorEdges
      ) {
        this.syncAnchorEdges(updated);
      }
      this.events?.emit(
        'memory.updated',
        this.eventPayload({
          memoryId: updated.id,
          status: updated.status,
          kind: updated.kind,
          persistence: updated.persistence ?? DEFAULT_PERSISTENCE,
          confidence: updated.confidence,
          freshness: updated.freshness,
        }),
      );
      if (existing.status !== 'deleted' && updated.status === 'deleted') {
        this.events?.emit(
          'memory.deleted',
          this.eventPayload({
            memoryId: updated.id,
            reason: 'Memory status changed to deleted.',
            persistence: updated.persistence ?? DEFAULT_PERSISTENCE,
            removedEdges: 0,
            contextPolicy:
              updated.contextPolicy === 'never' ? ('never' as const) : ('eligible' as const),
          }),
        );
      }
      return updated;
    });
  }

  async deleteSuper(id: string, reason?: string): Promise<{ deleted: true; id: string }> {
    // Soft-delete shim. The SQLite backend used to ship its own
    // un-audited-by-force SQL path here; it now routes through
    // `deleteSuperMemory` (which sets status: 'deleted', preserving
    // the tombstone for audit/recovery) so the same force/permanent
    // guard, edge cascade, audit entry, and event payload apply to
    // every caller.
    // Pass `force: true` because this method historically implied
    // "operator-driven, no questions asked" (it predates the guard).
    await this.deleteSuperMemory(id, reason ?? 'Manually deleted via SQLite API.', {
      force: true,
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
      const stmt = this.stmt(
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
      const stmt = this.stmt(
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
    const automaticContext = opts?.includeStatuses === undefined;
    const statusFilter = opts?.includeStatuses ?? ['active'];
    const scopeFilter = opts?.scope;
    const scopeClause = scopeFilter ? ' AND scope = ?' : '';
    const scopeParams = scopeFilter ? [scopeFilter] : [];
    // Automatic context retrieval (includeAudienceScoped:false) must exclude
    // role/task-scoped memories; explicit search (default true) returns them.
    // Mirrors retrieveForPath / findRelatedSuper and the legacy JSONL store.
    const includeAudienceScoped = opts?.includeAudienceScoped !== false;
    const audienceFilter = (memory: SuperMemory): boolean =>
      includeAudienceScoped || !memory.audience;
    // When includeStatuses is not explicitly provided (automatic context
    // retrieval), exclude memories marked contextPolicy='never' — mirrors
    // the canonical SuperMemoryStore.searchSuper (store.ts:1992).
    const neverInjectClause = automaticContext
      ? ` AND (json_extract(data, '$.contextPolicy') IS NULL OR json_extract(data, '$.contextPolicy') != 'never')`
      : '';

    // Empty query → direct table scan (bypasses FTS5 which is slower for list-all)
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      const placeholders = statusFilter.map(() => '?').join(',');
      const rows = this.stmt(
          `SELECT data FROM memories
           WHERE status IN (${placeholders})${scopeClause}${neverInjectClause}
           ORDER BY importance DESC, updated_at DESC
           LIMIT ?`,
        )
        .all(...statusFilter, ...scopeParams, limit) as Array<{ data: string }>;
      return rows.map((r) => this.rowToMemory(r)).filter(audienceFilter);
    }

    // Try FTS5 first
    try {
      const placeholders = statusFilter.map(() => '?').join(',');
      const terms = query
        .split(/\s+/)
        .filter(Boolean)
        .map((t) => `"${t.replace(/"/g, '""')}"*`);
      const runFts = (ftsQuery: string): Array<{ data: string }> =>
        this.stmt(
            `SELECT m.data FROM memories m
             JOIN memories_fts f ON m.rowid = f.rowid
             WHERE m.status IN (${placeholders})${scopeFilter ? ' AND m.scope = ?' : ''}${neverInjectClause}
             AND memories_fts MATCH ?
             ORDER BY bm25(memories_fts) DESC, m.importance DESC
             LIMIT ?`,
          )
          .all(...statusFilter, ...scopeParams, ftsQuery, limit) as Array<{ data: string }>;
      // AND first (space-joined) keeps precise multi-term queries precise. If
      // that matches nothing, fall back to OR so a noisy multi-word query (a
      // task description, a shell command line) still surfaces a memory that
      // shares only some terms — the JSONL store ranked by token overlap and
      // kept anything scoring > 0. Precise queries never reach the fallback.
      let rows = runFts(terms.join(' '));
      if (rows.length === 0 && terms.length > 1) {
        rows = runFts(terms.join(' OR '));
      }
      return rows.map((r) => this.rowToMemory(r)).filter(audienceFilter);
    } catch {
      // FTS5 unavailable — LIKE fallback
    }

    // LIKE fallback
    const likePattern = `%${query.replace(/[%_]/g, (c) => '\\' + c)}%`;
    const placeholders = statusFilter.map(() => '?').join(',');
    const rows = this.stmt(
        `SELECT data FROM memories
         WHERE status IN (${placeholders})${scopeClause}${neverInjectClause}
         AND LOWER(json_extract(data, '$.text')) LIKE ? ESCAPE '\\'
         ORDER BY importance DESC
         LIMIT ?`,
      )
      .all(...statusFilter, ...scopeParams, likePattern, limit) as Array<{ data: string }>;
    return rows.map((r) => this.rowToMemory(r)).filter(audienceFilter);
  }

  async retrieveForPath(paths: string[], opts?: SuperMemoryForPathOptions): Promise<SuperMemory[]> {
    await this.initialize();
    const limit = opts?.limit ?? 20;
    const includeAncestors = opts?.includeAncestors ?? true;

    if (paths.length === 0) return [];

    // Anchors are stored project-relative (normalizeAnchors runs on write), so
    // query paths must be relativized against the project root before matching —
    // callers such as the tool-call middleware pass absolute paths. Paths that
    // fall outside the project root cannot map to any stored anchor and are
    // dropped. Mirrors the legacy JSONL store's normalizeProjectPath step.
    const relPaths: string[] = [];
    for (const p of paths) {
      try {
        relPaths.push(normalizeProjectPath(this.projectRoot, p));
      } catch {
        /* path outside the project root — no stored anchor can match it */
      }
    }
    if (relPaths.length === 0) return [];

    // Automatic tool-result injection passes includeAudienceScoped:false so that
    // role/task-scoped memories stay out of ordinary retrieval — they surface
    // only through the explicit retrieveForAudience path. Mirrors searchSuper /
    // findRelatedSuper and the legacy JSONL store.
    const includeAudienceScoped = opts?.includeAudienceScoped !== false;
    const audienceFilter = (memory: SuperMemory): boolean =>
      includeAudienceScoped || !memory.audience;

    // Primary path: use the typed anchor edge index (about_file / about_directory /
    // about_symbol / …) instead of a full-table LIKE over the JSON blob.
    const targets = new Set<string>();
    const symbolGlobs: string[] = [];
    for (const normalized of relPaths) {
      targets.add(`file:${normalized}`);
      symbolGlobs.push(`symbol:${normalized}#*`);
      if (includeAncestors) {
        const parts = normalized.split('/').filter(Boolean);
        for (let i = parts.length; i >= 1; i--) {
          const ancestor = parts.slice(0, i).join('/');
          targets.add(`file:${ancestor}`);
          targets.add(`dir:${ancestor}`);
        }
      }
    }
    const targetList = [...targets];
    if (targetList.length === 0) return [];

    const targetPlaceholders = targetList.map(() => '?').join(',');
    const globClause =
      symbolGlobs.length > 0
        ? `OR ${symbolGlobs.map(() => 'e.to_node GLOB ?').join(' OR ')}`
        : '';
    const edgeRows = this.stmt(
      `SELECT DISTINCT m.data
       FROM memories m
       INNER JOIN edges e ON e.from_node = ('${SqliteSuperMemoryStore.NODE_ID_PREFIX}' || m.id)
       WHERE m.status IN ('active', 'stale')
         AND (
           e.to_node IN (${targetPlaceholders})
           ${globClause}
         )
       ORDER BY m.importance DESC, m.updated_at DESC
       LIMIT ?`,
    ).all(...targetList, ...symbolGlobs, limit) as Array<{ data: string }>;

    if (edgeRows.length > 0) {
      return edgeRows.map((r) => this.rowToMemory(r)).filter(audienceFilter);
    }

    // Fallback: legacy rows / anchors not yet reflected as graph edges.
    const conditions: string[] = [];
    const params: (string | number)[] = ['active', 'stale'];
    for (const normalized of relPaths) {
      params.push(`%"path":"${normalized.replace(/[%_\\]/g, '\\$&')}"%`);
      conditions.push("LOWER(data) LIKE ? ESCAPE '\\'");
      if (includeAncestors) {
        const parts = normalized.split('/').filter(Boolean);
        for (let i = parts.length; i >= 1; i--) {
          const ancestor = parts.slice(0, i).join('/');
          params.push(`%"path":"${ancestor.replace(/[%_\\]/g, '\\$&')}"%`);
          conditions.push("LOWER(data) LIKE ? ESCAPE '\\'");
        }
      }
    }
    const rows = this.stmt(
      `SELECT data FROM memories
       WHERE status IN (?, ?)
       AND (${conditions.join(' OR ')})
       ORDER BY importance DESC, updated_at DESC
       LIMIT ?`,
    ).all(...params, limit) as Array<{ data: string }>;
    return rows.map((r) => this.rowToMemory(r)).filter(audienceFilter);
  }

  /**
   * Build the minimal candidate id set that can score > 0 against `seeds`.
   * Covers graph neighbors, shared anchor edge targets (incl. path ancestors),
   * tag overlap, and command-family matches — avoids full-table JSON parse.
   */
  private collectRelatedCandidateIds(
    seeds: readonly SuperMemory[],
    graphRelatedIds: ReadonlySet<string>,
    statuses: readonly SuperMemoryStatus[],
  ): string[] {
    const ids = new Set<string>(graphRelatedIds);
    const statusPlaceholders = statuses.map(() => '?').join(',');

    // ── Shared anchor targets (edges + in-memory anchor nodes) ─────────
    const targets = new Set<string>();
    const seedNodeIds = seeds.map((s) => SqliteSuperMemoryStore.toNodeId(s.id));
    if (seedNodeIds.length > 0) {
      const ph = seedNodeIds.map(() => '?').join(',');
      const edgeTargets = this.stmt(
        `SELECT DISTINCT to_node AS n FROM edges
         WHERE from_node IN (${ph}) AND relation GLOB 'about_*'`,
      ).all(...seedNodeIds) as Array<{ n: string }>;
      for (const row of edgeTargets) targets.add(row.n);
    }
    for (const seed of seeds) {
      for (const anchor of seed.anchors) {
        const node = sqliteAnchorNode(anchor);
        if (node) targets.add(node);
        if (anchor.path) {
          const normalized = normalizeSlashes(anchor.path);
          const parts = normalized.split('/').filter(Boolean);
          // Ancestors so parent-dir anchors score against nested file seeds.
          for (let i = 1; i < parts.length; i++) {
            const ancestor = parts.slice(0, i).join('/');
            targets.add(`file:${ancestor}`);
            targets.add(`dir:${ancestor}`);
          }
        }
      }
    }
    if (targets.size > 0) {
      const targetList = [...targets];
      // Chunk IN lists to stay under SQLite variable limits on huge projects.
      const CHUNK = 400;
      for (let i = 0; i < targetList.length; i += CHUNK) {
        const chunk = targetList.slice(i, i + CHUNK);
        const ph = chunk.map(() => '?').join(',');
        const froms = this.stmt(
          `SELECT DISTINCT from_node AS n FROM edges
           WHERE to_node IN (${ph})
             AND from_node GLOB ?
             AND relation GLOB 'about_*'`,
        ).all(...chunk, SqliteSuperMemoryStore.MEMORY_NODE_GLOB) as Array<{ n: string }>;
        for (const row of froms) {
          ids.add(row.n.slice(SqliteSuperMemoryStore.NODE_ID_PREFIX.length));
        }
      }
    }

    // ── Tag overlap via the denormalized tags column ───────────────────
    const tags = new Set(seeds.flatMap((s) => s.tags));
    for (const tag of tags) {
      // tags is JSON.stringify([...]) — match the quoted token.
      const pattern = `%"${escapeLikePattern(tag)}"%`;
      const rows = this.stmt(
        `SELECT id FROM memories
         WHERE status IN (${statusPlaceholders})
           AND tags LIKE ? ESCAPE '\\'`,
      ).all(...statuses, pattern) as Array<{ id: string }>;
      for (const row of rows) ids.add(row.id);
    }

    // ── Command-family matches (prefix of first two tokens) ────────────
    const families = new Set<string>();
    for (const seed of seeds) {
      for (const anchor of seed.anchors) {
        if (anchor.command) {
          families.add(sqliteCommandFamily(sqliteNormalizeCommand(anchor.command)));
        }
      }
    }
    if (families.size > 0) {
      const cmdEdges = this.stmt(
        `SELECT DISTINCT from_node AS n, to_node AS t FROM edges
         WHERE relation = 'about_command' AND from_node GLOB ?`,
      ).all(SqliteSuperMemoryStore.MEMORY_NODE_GLOB) as Array<{ n: string; t: string }>;
      for (const edge of cmdEdges) {
        const cmd = edge.t.startsWith('command:') ? edge.t.slice('command:'.length) : '';
        if (cmd && families.has(sqliteCommandFamily(sqliteNormalizeCommand(cmd)))) {
          ids.add(edge.n.slice(SqliteSuperMemoryStore.NODE_ID_PREFIX.length));
        }
      }
    }

    for (const seed of seeds) ids.delete(seed.id);
    return [...ids];
  }

  /** SQLite equivalent of JSONL graph/metadata expansion. */
  async findRelatedSuper(
    memoryIds: string[],
    opts: {
      limit?: number;
      maxDepth?: number;
      includeStatuses?: SuperMemoryStatus[];
      includeAudienceScoped?: boolean;
    } = {},
  ): Promise<SuperMemory[]> {
    await this.initialize();
    if (memoryIds.length === 0) return [];

    const statuses = opts.includeStatuses ?? ['active'];
    const seedPlaceholders = memoryIds.map(() => '?').join(',');
    // Load only the seed rows first — avoid full-table parse when seeds miss.
    const seedRows = this.stmt(
      `SELECT data FROM memories WHERE id IN (${seedPlaceholders})`,
    ).all(...memoryIds) as Array<{ data: string }>;
    const seedIds = new Set(memoryIds);
    const seeds = seedRows
      .map((row) => this.rowToMemory(row))
      .filter((memory) => seedIds.has(memory.id));
    if (seeds.length === 0) return [];

    const graphRelatedIds = new Set<string>();
    for (const edge of await this.traverseGraph(
      seeds.map((memory) => SqliteSuperMemoryStore.toNodeId(memory.id)),
      { maxDepth: opts.maxDepth ?? 3, limit: Math.max(100, (opts.limit ?? 20) * 20) },
    )) {
      for (const node of [edge.from, edge.to]) {
        if (node.startsWith(SqliteSuperMemoryStore.NODE_ID_PREFIX))
          graphRelatedIds.add(node.slice(SqliteSuperMemoryStore.NODE_ID_PREFIX.length));
      }
    }

    // Targeted candidate pool — only ids that can score > 0 against seeds.
    const candidateIds = this.collectRelatedCandidateIds(seeds, graphRelatedIds, statuses);
    if (candidateIds.length === 0) return [];

    const statusPlaceholders = statuses.map(() => '?').join(',');
    const candidates: SuperMemory[] = [];
    const CHUNK = 400;
    for (let i = 0; i < candidateIds.length; i += CHUNK) {
      const chunk = candidateIds.slice(i, i + CHUNK);
      const idPh = chunk.map(() => '?').join(',');
      const rows = this.stmt(
        `SELECT data FROM memories
         WHERE id IN (${idPh}) AND status IN (${statusPlaceholders})`,
      ).all(...chunk, ...statuses) as Array<{ data: string }>;
      for (const row of rows) candidates.push(this.rowToMemory(row));
    }

    return candidates
      .filter((memory) => !seedIds.has(memory.id))
      .filter((memory) => memory.contextPolicy !== 'never')
      .filter((memory) => opts.includeAudienceScoped !== false || !memory.audience)
      .map((memory) => ({ memory, score: scoreMemoryRelationship(memory, seeds, graphRelatedIds) }))
      .filter((item) => item.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.memory.importance - a.memory.importance ||
          b.memory.confidence - a.memory.confidence,
      )
      .slice(0, Math.max(1, Math.min(opts.limit ?? 20, 100)))
      .map((item) => item.memory);
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
    const rows = this.stmt(
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
        if (a.taskTypes?.length && !a.taskTypes.some((t) => t.toLowerCase() === taskType))
          return false;
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

    const rows = this.stmt(sql).all(...(params as (string | number)[])) as Array<{
      data: string;
    }>;
    return rows.map((r) => this.rowToMemory(r));
  }

  /**
   * Paginated, status-filtered listing (SQLite backend). Mirrors
   * `SuperMemoryStore.listSuperPage`: defaults to EXCLUDING `deleted`, returns a
   * bounded page plus an opaque `updatedAt`/`id` cursor, and reports total +
   * whole-store `statusCounts` for UI tab badges.
   *
   * Ordering: `updated_at DESC, id DESC`. Cursor pagination uses the tuple
   * comparison `(updated_at, id) < (cursorUpdatedAt, cursorId)` which the
   * composite DESC index can serve without scanning skipped pages.
   */
  async listSuperPage(options: ListSuperPageOptions = {}): Promise<ListSuperPageResult> {
    await this.initialize();

    // Whole-store status counts (ignores filters) for tab badges.
    const statusCounts: Record<string, number> = {};
    const statusRows = this.stmt('SELECT status, COUNT(*) AS n FROM memories GROUP BY status')
      .all() as Array<{ status: string; n: number }>;
    for (const r of statusRows) statusCounts[r.status] = r.n;

    // Resolve status filter (default: all except 'deleted').
    const requested =
      options.statuses && options.statuses.length > 0
        ? options.statuses.filter((s) => VALID_MEMORY_STATUSES.has(s))
        : DEFAULT_PAGE_STATUSES;
    const statuses = requested.length > 0 ? requested : DEFAULT_PAGE_STATUSES;
    const kind = options.kind && options.kind !== 'all' ? options.kind : undefined;
    const query = options.query?.trim().toLowerCase();
    const limit = clampPageLimit(options.limit);

    const where: string[] = [];
    const params: unknown[] = [];

    where.push(`status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
    if (kind) {
      where.push('kind = ?');
      params.push(kind);
    }
    if (query) {
      where.push("LOWER(json_extract(data, '$.text')) LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLikePattern(query)}%`);
    }

    const whereClause = `WHERE ${where.join(' AND ')}`;

    // Total matching the filter (across all pages).
    const totalRow = this.stmt(`SELECT COUNT(*) AS n FROM memories ${whereClause}`)
      .get(...(params as (string | number)[])) as { n: number };
    const total = totalRow.n;

    // Cursor: keyset pagination on the DESC ordering.
    const cursor = decodePageCursor(options.cursor);
    const pageParams = [...params];
    let cursorClause = '';
    if (cursor) {
      // (updated_at, id) strictly "after" the cursor in DESC order.
      cursorClause = ' AND (updated_at < ? OR (updated_at = ? AND id < ?))';
      pageParams.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
    }

    // Fetch limit+1 to detect whether another page follows.
    const rows = this.stmt(
        `SELECT data, updated_at, id FROM memories ${whereClause}${cursorClause}
         ORDER BY updated_at DESC, id DESC
         LIMIT ?`,
      )
      .all(...(pageParams as (string | number)[]), limit + 1) as Array<{
      data: string;
      updated_at: string;
      id: string;
    }>;

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const memories = pageRows.map((r) => this.rowToMemory({ data: r.data }));
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && lastRow ? encodePageCursor({ updatedAt: lastRow.updated_at, id: lastRow.id }) : null;

    return { memories, nextCursor, total, statusCounts };
  }

  async getStats(): Promise<SuperMemoryStats> {
    await this.initialize();
    const totalRow = this.stmt('SELECT COUNT(*) AS n FROM memories').get() as { n: number };
    const byStatus: Record<string, number> = {};
    const statusRows = this.stmt('SELECT status, COUNT(*) AS n FROM memories GROUP BY status')
      .all() as Array<{ status: string; n: number }>;
    for (const r of statusRows) byStatus[r.status] = r.n;

    const byKind: Record<string, number> = {};
    const kindRows = this.stmt('SELECT kind, COUNT(*) AS n FROM memories GROUP BY kind')
      .all() as Array<{ kind: string; n: number }>;
    for (const r of kindRows) byKind[r.kind] = r.n;

    const edgeRow = this.stmt('SELECT COUNT(*) AS n FROM edges').get() as { n: number };

    return {
      total: totalRow.n,
      byStatus: byStatus as SuperMemoryStats['byStatus'],
      byKind,
      edges: edgeRow.n,
    };
  }

  // ─── Graph ──────────────────────────────────────────────────────────

  async addGraphEdge(
    from: string,
    to: string,
    relation: MemoryGraphRelation,
    weight = 1,
  ): Promise<void> {
    await this.initialize();
    const edgeId = `edge_${ulid()}`;
    this.stmt(
        `INSERT INTO edges (from_node, to_node, relation, weight, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(from_node, to_node, relation) DO UPDATE SET weight = weight + excluded.weight`,
      )
      .run(from, to, relation, weight, this.nowIso());
    this.events?.emit(
      'memory.graph_edge_added',
      this.eventPayload({ edgeId, from, to, relation, weight }),
    );
  }

  async traverseGraph(
    starts: string[],
    opts?: { maxDepth?: number; limit?: number },
  ): Promise<MemoryGraphEdge[]> {
    await this.initialize();
    const maxDepth = Math.min(opts?.maxDepth ?? 2, 6);
    const limit = Math.min(opts?.limit ?? 100, 1000);

    const visitedNodes = new Set(starts);
    const visitedEdges = new Set<string>();
    const result: MemoryGraphEdge[] = [];
    // Level-order BFS: one SQL round-trip per depth instead of per node.
    let frontier = [...new Set(starts)];
    let depth = 0;

    while (frontier.length > 0 && result.length < limit && depth < maxDepth) {
      const nextFrontier: string[] = [];
      // Chunk large frontiers to stay under SQLite variable limits.
      const CHUNK = 200;
      for (let i = 0; i < frontier.length; i += CHUNK) {
        const chunk = frontier.slice(i, i + CHUNK);
        const ph = chunk.map(() => '?').join(',');
        // from_node OR to_node IN (frontier) — bidirectional adjacency.
        const rows = this.stmt(
          `SELECT from_node, to_node, relation, weight FROM edges
           WHERE from_node IN (${ph}) OR to_node IN (${ph})`,
        ).all(...chunk, ...chunk) as Array<{
          from_node: string;
          to_node: string;
          relation: MemoryGraphRelation;
          weight: number;
        }>;
        const frontierSet = new Set(chunk);
        for (const r of rows) {
          if (result.length >= limit) break;
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
            ...(SqliteSuperMemoryStore.edgeEvidence(r.relation, r.to_node) ?? {}),
          });
          const next =
            frontierSet.has(r.from_node) && !frontierSet.has(r.to_node)
              ? r.to_node
              : frontierSet.has(r.to_node) && !frontierSet.has(r.from_node)
                ? r.from_node
                : // Both endpoints in frontier (or neither uniquely) — expand both.
                  null;
          if (next) {
            if (!visitedNodes.has(next)) {
              visitedNodes.add(next);
              nextFrontier.push(next);
            }
          } else {
            for (const n of [r.from_node, r.to_node]) {
              if (!visitedNodes.has(n)) {
                visitedNodes.add(n);
                nextFrontier.push(n);
              }
            }
          }
        }
      }
      frontier = nextFrontier;
      depth += 1;
    }
    return result;
  }

  /**
   * Resolve a free-form graph query (a node id, a bare memory id, a project
   * path, or arbitrary text) into start nodes, then traverse. Restores the
   * host-facing `graphFor` surface the legacy JSONL store exposed and that the
   * `/memory graph` command and the webui graph handler still call.
   */
  async graphFor(query: string, maxDepth = 2, limit = 100): Promise<MemoryGraphEdge[]> {
    await this.initialize();
    const starts = new Set<string>();
    const trimmed = query.trim();
    if (/^(mem|file|dir|symbol|command|session|tool|agent):/.test(trimmed)) {
      starts.add(normalizeSlashes(trimmed));
    } else if (/^[A-Za-z0-9_]+$/.test(trimmed)) {
      // A bare id (ULID or legacy mem_… form) — try it as a memory node.
      starts.add(SqliteSuperMemoryStore.toNodeId(trimmed));
    }
    try {
      const normalizedPath = normalizeProjectPath(this.projectRoot, query);
      starts.add(`file:${normalizedPath}`);
      starts.add(`dir:${normalizedPath}`);
      // Symbol anchors live under `symbol:<path>#<name>` — seed every symbol
      // node owned by this path so `graph <path>` also surfaces memories that
      // are anchored to a symbol within the file rather than the file itself.
      const symbolNodes = this.stmt(
        'SELECT DISTINCT to_node FROM edges WHERE to_node GLOB ?',
      ).all(`symbol:${normalizedPath}#*`) as Array<{ to_node: string }>;
      for (const row of symbolNodes) starts.add(row.to_node);
    } catch {
      /* query is not a project-relative path — skip path-based starts */
    }
    for (const memory of await this.searchSuper(query, { limit: 20 })) {
      starts.add(SqliteSuperMemoryStore.toNodeId(memory.id));
    }
    // Seed each seed-memory's own anchor nodes so a single-memory query reaches
    // its anchor-siblings within one hop (they share the anchor node), matching
    // the JSONL store where shared-anchor memories were directly connected.
    // Batch all candidate memory ids into a single query to avoid N+1.
    const memIds: string[] = [];
    for (const start of starts) {
      if (start.startsWith(SqliteSuperMemoryStore.NODE_ID_PREFIX)) {
        memIds.push(start.slice(SqliteSuperMemoryStore.NODE_ID_PREFIX.length));
      }
    }
    if (memIds.length > 0) {
      const placeholders = memIds.map(() => '?').join(',');
      const batchRows = this.stmt(
        `SELECT data FROM memories WHERE id IN (${placeholders})`,
      ).all(...memIds) as Array<{ data: string }>;
      const memAnchorMap = batchRows.map((r) => this.rowToMemory(r));
      for (const memory of memAnchorMap) {
        if (!memory) continue;
        for (const anchor of memory.anchors) {
          const node = sqliteAnchorNode(anchor);
          if (node) starts.add(node);
        }
      }
    }
    if (starts.size === 0) return [];
    return this.traverseGraph([...starts], { maxDepth, limit });
  }

  /**
   * Re-check the filesystem anchors of one memory (or every non-deleted memory)
   * and reconcile status: a memory whose anchors have vanished flips
   * active→stale; a stale memory whose anchors reappear flips back to active.
   * Restores the standalone `verify` surface the JSONL store exposed and that
   * `/memory verify` still calls. The SQLite hygiene pass runs the same probe
   * inline, but the host-facing surface needs it as a discrete operation.
   */
  async verify(memoryId?: string, signal?: AbortSignal): Promise<MemoryVerificationResult[]> {
    signal?.throwIfAborted();
    await this.initialize();
    const rows = (
      memoryId
        ? this.stmt("SELECT data FROM memories WHERE id = ? AND status != 'deleted'").all(memoryId)
        : this.stmt("SELECT data FROM memories WHERE status != 'deleted'").all()
    ) as Array<{ data: string }>;
    const memories = rows.map((r) => this.rowToMemory(r));

    const results: MemoryVerificationResult[] = [];
    const updates: SuperMemory[] = [];
    const verificationRunAt = this.nowIso();
    for (const memory of memories) {
      signal?.throwIfAborted();
      const result = await verifyMemoryAnchors(this.projectRoot, memory, verificationRunAt, signal);
      results.push(result);
      if (result.status === 'stale' && memory.status === 'active') {
        // Active memory whose anchors vanished → stale
        updates.push({ ...memory, status: 'stale', lastVerifiedAt: result.checkedAt });
      } else if (result.status === 'verified') {
        // Only flip stale → active. Superseded, archived, contradicted,
        // and deleted are terminal regardless of anchor state.
        switch (memory.status) {
          case 'stale':
            updates.push({ ...memory, status: 'active', lastVerifiedAt: result.checkedAt, freshness: 1 });
            break;
          case 'active':
            updates.push({ ...memory, lastVerifiedAt: result.checkedAt, freshness: 1 });
            break;
          default:
            // Terminal statuses (superseded, archived, contradicted, deleted):
            // update lastVerifiedAt for audit trail but preserve the status.
            if (memory.anchors.length > 0) {
              updates.push({ ...memory, lastVerifiedAt: result.checkedAt });
            }
            break;
        }
      } else if (memory.anchors.length > 0 && memory.lastVerifiedAt !== result.checkedAt) {
        // Anchorless memories are not verifiable — don't churn a revision.
        updates.push({ ...memory, lastVerifiedAt: result.checkedAt });
      }
    }
    if (updates.length > 0) {
      await this.runMutation(() => {
        for (const memory of updates) {
          this.upsertMemory(memory);
          this.syncAnchorEdges(memory);
        }
      });
    }
    return results;
  }

  // ─── Audit ──────────────────────────────────────────────────────────

  private audit(event: string, data?: Record<string, unknown>): void {
    this.stmt('INSERT INTO audit_log (event, at, trace_id, data) VALUES (?, ?, ?, ?)')
      .run(event, this.nowIso(), this.traceId ?? null, data ? JSON.stringify(data) : null);
  }

  private eventPayload<T extends object>(payload: T): T & { traceId?: string | undefined } {
    return this.traceId ? { ...payload, traceId: this.traceId } : payload;
  }

  // ─── Hygiene ────────────────────────────────────────────────────────

  async hygiene(opts?: SuperMemoryHygieneOptions): Promise<SuperMemoryHygieneReport> {
    await this.initialize();
    const startedAt = this.nowIso();

    // ── Phase 1: Anchor verification ────────────────────────────────
    const active = await this.listMemories({ status: 'active', limit: 10000 });
    const stale: string[] = [];
    const verified: string[] = [];

    // Resolve duplicate anchor paths once, then probe them with bounded async
    // concurrency. The previous nested existsSync loop could block the process
    // for thousands of filesystem calls during a large hygiene run.
    const anchorPaths = new Set<string>();
    for (const m of active) {
      for (const anchor of m.anchors) {
        if (
          anchor.path &&
          (anchor.type === 'file' ||
            anchor.type === 'symbol' ||
            anchor.type === 'test' ||
            anchor.type === 'git')
        ) {
          anchorPaths.add(path.resolve(this.projectRoot, anchor.path));
        }
      }
    }
    const pathsToVerify = [...anchorPaths];
    const existingPaths = new Set<string>();
    let nextPath = 0;
    const verifyWorker = async (): Promise<void> => {
      while (nextPath < pathsToVerify.length) {
        const anchorPath = pathsToVerify[nextPath++]!;
        try {
          await fs.promises.access(anchorPath);
          existingPaths.add(anchorPath);
        } catch {
          // Missing or inaccessible anchors are stale.
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(32, pathsToVerify.length) }, () => verifyWorker()),
    );

    for (const m of active) {
      const allValid = m.anchors.every(
        (anchor) =>
          !anchor.path ||
          !(
            anchor.type === 'file' ||
            anchor.type === 'symbol' ||
            anchor.type === 'test' ||
            anchor.type === 'git'
          ) ||
          existingPaths.has(path.resolve(this.projectRoot, anchor.path)),
      );
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
    // Batch all dedup writes into one serialized transaction — each group can touch many rows.
    await this.runMutation(() => {
      for (const group of groups.values()) {
        if (group.length < 2) continue;
        const sorted = [...group].sort(
          (a, b) =>
            b.importance - a.importance ||
            b.confidence - a.confidence ||
            a.createdAt.localeCompare(b.createdAt),
        );
        const keeper = sorted[0]!;
        const duplicates = sorted.slice(1);
        // Merge tags/anchors/sources into keeper
        const updatedKeeper: SuperMemory = {
          ...keeper,
          tags: [...new Set(sorted.flatMap((m) => m.tags))],
          anchors: [
            ...new Map(
              [...sorted.flatMap((m) => m.anchors)].map((a) => [JSON.stringify(a), a]),
            ).values(),
          ] as MemoryAnchor[],
          sources: [...new Set(sorted.flatMap((m) => m.sources.map((s) => JSON.stringify(s))))].map(
            (s) => JSON.parse(s),
          ),
          supersedes: [...new Set([...(keeper.supersedes ?? []), ...duplicates.map((m) => m.id)])],
          updatedAt: this.nowIso(),
        };
        this.upsertMemory(updatedKeeper);
        this.syncAnchorEdges(updatedKeeper);
        for (const dup of duplicates) {
          const supersededDup: SuperMemory = {
            ...dup,
            status: 'superseded',
            supersededBy: keeper.id,
            updatedAt: this.nowIso(),
          };
          this.upsertMemory(supersededDup);
          this.syncAnchorEdges(supersededDup);
          // Add graph edge (best-effort — the edges table may not exist in all configs)
          try {
            this.stmt(
              'INSERT INTO edges (from_node, to_node, relation, weight, created_at) VALUES (?, ?, ?, ?, ?)',
            ).run(
              SqliteSuperMemoryStore.toNodeId(keeper.id),
              SqliteSuperMemoryStore.toNodeId(dup.id),
              'supersedes',
              1,
              this.nowIso(),
            );
          } catch {
            /* edges table may be absent */
          }
          deduplicated++;
          superseded++;
        }
      }
      this.audit('memory.hygiene_dedup', { details: { deduplicated, superseded } });
    });

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
      existingCandidates.filter((c) => c.status === 'pending').map((c) => c.targetMemoryId ?? ''),
    );
    const candidateEmittedFor = new Set<string>();

    let reviewCandidatesCreated = 0;

    // Query non-deleted, non-superseded memories for candidate evaluation
    const candidates = await this.listMemories({ status: 'all', limit: 10000 });
    for (const m of candidates) {
      if (m.status === 'deleted' || m.status === 'superseded' || m.status === 'contradicted')
        continue;

      const age = nowMs - Date.parse(m.lastAccessedAt ?? m.updatedAt);
      const persistence = m.persistence ?? DEFAULT_PERSISTENCE;
      let reason: string | undefined;
      let suggestedAction: 'delete' | 'archive' | 'investigate' = 'investigate';

      if (m.scope === 'session' && m.expiresAt && Date.parse(m.expiresAt) <= nowMs) {
        reason = 'expires_at_passed';
        suggestedAction = 'delete';
      } else if (m.expiresAt && Date.parse(m.expiresAt) <= nowMs) {
        reason = 'expires_at_passed';
        suggestedAction = 'delete';
      } else if (
        m.status === 'active' &&
        m.scope !== 'session' &&
        (m.injectionCount ?? 0) >= unusedMinInjections &&
        (m.useCount ?? 0) === 0 &&
        nowMs - Date.parse(m.updatedAt) >= unusedMs
      ) {
        reason = 'injected_never_used';
        suggestedAction = 'delete';
      } else if (
        (m.status === 'stale' && age >= retentionMs) ||
        (m.confidence < 0.5 && age >= lowConfidenceMs)
      ) {
        reason = m.confidence < 0.5 ? 'confidence_low' : 'freshness_low';
        suggestedAction = 'investigate';
      }

      // Permanent memories are exempt from time/usage rules
      if (
        reason &&
        persistence !== 'permanent' &&
        !candidateEmittedFor.has(m.id) &&
        !existingPendingKeys.has(m.id)
      ) {
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
          tags: [
            ...m.tags,
            `review:${reason}`,
            `suggested:${suggestedAction}`,
            `persistence:${persistence}`,
          ],
          anchors: m.anchors,
          sources: [{ type: 'session' }],
          createdAt: this.nowIso(),
          updatedAt: this.nowIso(),
        });
        this.audit('memory.review_candidate_created', {
          memoryId: m.id,
          reason,
          details: {
            suggestedAction,
            ageDays,
            persistence,
            status: m.status,
            confidence: m.confidence,
          },
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
      // The physical purge is JSONL-only; SQLite ignores purgeDeletedAfterDays.
      purgedDeleted: 0,
      verified: verified.length,
      // SQLite does not run the JSONL store's SimHash near-dedup pass.
      transitiveMerges: 0,
    };
    this.audit('memory.hygiene_completed', {
      details: report as unknown as Record<string, unknown>,
    });
    return report;
  }

  // ─── Candidates ─────────────────────────────────────────────────────

  async addCandidate(candidate: MemoryCandidate): Promise<void> {
    await this.initialize();
    this.stmt(
      `INSERT OR REPLACE INTO candidates
        (id, data, status, created_at, updated_at, canonical_text)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      candidate.id,
      JSON.stringify(candidate),
      candidate.status,
      candidate.createdAt,
      candidate.updatedAt,
      normalizeTextKey(candidate.text ?? ''),
    );
  }

  /**
   * Public proposal channel — mirrors `SuperMemoryStore.createCandidate`.
   * Lets agents (e.g. the Mnemosyne custodian) file review proposals into
   * the ReviewQueue instead of applying destructive changes directly.
   */
  async createCandidate(input: CreateCandidateInput): Promise<MemoryCandidate> {
    validateRememberInput(input);
    // Reject secrets/credentials before any store operation.
    rejectIfUnsafeInput(input);
    await this.initialize();
    const text = normalizeText(input.text);
    if (!text) throw new Error('Super Memory candidate text must not be empty.');
    const scope = input.scope ?? 'project';
    const key = normalizeTextKey(text);
    // Check+insert under runMutation to prevent race conditions.
    // Dedup is scoped to `pending` candidates only so accepted/rejected
    // proposals don't permanently block re-submission.
    // Uses the indexed canonical_text column for O(1) lookup instead of
    // loading every pending candidate row.
    return this.runMutation(() => {
      const rows = this.stmt(
        `SELECT data FROM candidates
         WHERE status = 'pending' AND canonical_text = ?
         ORDER BY created_at DESC`,
      ).all(key) as Array<{ data: string }>;
      for (const row of rows) {
        try {
          const existing = JSON.parse(row.data) as MemoryCandidate;
          if (existing.scope === scope) return existing;
        } catch {
          // Skip corrupt rows.
        }
      }
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
      this.stmt(
        `INSERT OR REPLACE INTO candidates
          (id, data, status, created_at, updated_at, canonical_text)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        candidate.id,
        JSON.stringify(candidate),
        candidate.status,
        candidate.createdAt,
        candidate.updatedAt,
        key,
      );
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
    const rows = this.stmt(sql).all() as Array<{ data: string }>;
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
      const row = this.stmt("SELECT data FROM candidates WHERE id = ? AND status = 'pending'")
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
      const row = this.stmt("SELECT data FROM candidates WHERE id = ? AND status = 'pending'")
        .get(candidateId) as { data: string } | undefined;
      if (!row) return;
      const current = JSON.parse(row.data) as MemoryCandidate;
      const updated: MemoryCandidate = {
        ...current,
        status: 'accepted',
        memoryId: memory.id,
        updatedAt: this.nowIso(),
      };
      this.stmt(
        `INSERT OR REPLACE INTO candidates
          (id, data, status, created_at, updated_at, canonical_text)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        updated.id,
        JSON.stringify(updated),
        updated.status,
        updated.createdAt,
        updated.updatedAt,
        normalizeTextKey(updated.text ?? ''),
      );
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
      const row = this.stmt("SELECT data FROM candidates WHERE id = ? AND status = 'pending'")
        .get(candidateId) as { data: string } | undefined;
      if (!row) return false;
      const candidate = JSON.parse(row.data) as MemoryCandidate;
      const updated: MemoryCandidate = {
        ...candidate,
        status: 'rejected',
        reason: normalizeText(reason),
        updatedAt: this.nowIso(),
      };
      this.stmt(
        `INSERT OR REPLACE INTO candidates
          (id, data, status, created_at, updated_at, canonical_text)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        updated.id,
        JSON.stringify(updated),
        updated.status,
        updated.createdAt,
        updated.updatedAt,
        normalizeTextKey(updated.text ?? ''),
      );
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
      const row = this.stmt("SELECT data FROM candidates WHERE id = ? AND status = 'pending'")
        .get(candidateId) as { data: string } | undefined;
      return row ? (JSON.parse(row.data) as MemoryCandidate) : undefined;
    });
    if (!snapshot) {
      // Unknown id → undefined; already-resolved → alreadyResolved marker.
      const any = await this.runMutation(() => {
        const row = this.stmt('SELECT data FROM candidates WHERE id = ?').get(candidateId) as
          | { data: string }
          | undefined;
        return row ? (JSON.parse(row.data) as MemoryCandidate) : undefined;
      });
      if (!any) return undefined;
      return { candidateId, decision, applied: false, alreadyResolved: true };
    }
    const targetId = resolveTargetId(snapshot);
    const target: SuperMemory | null = targetId
      ? await this.runMutation(() => {
          const row = this.stmt('SELECT data FROM memories WHERE id = ?').get(targetId) as
            | { data: string }
            | undefined;
          return row ? (JSON.parse(row.data) as SuperMemory) : null;
        })
      : null;
    const policy = computeResolution(snapshot, decision, reason, target ?? null);
    // Atomic claim: only the caller that flips pending → terminal state owns
    // this resolution. Interleaved decisions see `alreadyResolved` instead of
    // double-applying memory mutations.
    const claimed = await this.runMutation(() => {
      const updated: MemoryCandidate = {
        ...snapshot,
        status: policy.candidateStatus,
        reason: policy.reason,
        updatedAt: this.nowIso(),
      };
      const result = this.stmt(
          "UPDATE candidates SET data = ?, status = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
        )
        .run(JSON.stringify(updated), updated.status, updated.updatedAt, candidateId);
      return result.changes > 0;
    });
    if (!claimed) {
      return { candidateId, decision, applied: false, alreadyResolved: true };
    }
    let applied = false;
    if (policy.mutation.kind === 'delete_memory' && policy.mutation.targetId) {
      try {
        await this.updateSuper(policy.mutation.targetId, { status: 'deleted' });
        applied = true;
      } catch (err) {
        // Row may have been deleted between read and update (concurrent access),
        // so applied:false is legitimate. Log the cause for debugging.
        console.warn('[sqlite-store] delete_memory mutation failed for candidate', candidateId, err);
        applied = false;
      }
    } else if (policy.mutation.kind === 'archive_memory' && policy.mutation.targetId) {
      try {
        await this.updateSuper(policy.mutation.targetId, { status: 'archived' });
        applied = true;
      } catch (err) {
        // Row may have been deleted between read and update (concurrent access),
        // so applied:false is legitimate. Log the cause for debugging.
        console.warn('[sqlite-store] archive_memory mutation failed for candidate', candidateId, err);
        applied = false;
      }
    } else if (decision === 'keep') {
      applied = true;
    }
    this.audit('memory.candidate_resolved', {
      ...(policy.mutation.targetId ? { memoryId: policy.mutation.targetId } : {}),
      reason: policy.reason,
      details: { candidateId, decision, applied },
    });
    return { candidateId, decision, ...(policy.mutation.targetId ? { targetMemoryId: policy.mutation.targetId } : {}), applied };
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
    await this.initialize();
    const dedupSet = new Set<string>();
    const memories = this.stmt(
        "SELECT data FROM memories WHERE json_extract(data, '$.status') IN ('active', 'stale') AND json_extract(data, '$.scope') = 'project'",
      )
      .all() as Array<{ data: string }>;
    for (const row of memories) {
      const memory = JSON.parse(row.data) as SuperMemory;
      dedupSet.add(canonicalMemoryText(memory.text));
    }
    for (const candidate of await this.listCandidates()) {
      if (candidate.scope === 'project') dedupSet.add(canonicalMemoryText(candidate.text));
    }
    // Note: sharedConsolidateSession defensively copies `dedupSet` internally
    // (new Set(initialDedupSet)), so the original set is not mutated by the
    // shared loop — the copy is for isolation, not for load-bearing semantics.
    return sharedConsolidateSession(
      { createCandidate: (i) => this.createCandidate(i), acceptCandidate: (id) => this.acceptCandidate(id) },
      dedupSet,
      input,
    );
  }

  // ─── Alias methods matching SuperMemoryStore's public API ──────────
  // The WebUI/TUI memory handlers use a duck-type check (isSuperMemoryStore)
  // that probes for these exact method names. The SQLite store implemented
  // the same logic under different names (getStats, listMemories, updateSuper,
  // deleteSuper). These thin aliases bridge the naming gap so the duck-type
  // check passes and memory.super.* handlers route correctly.

  async stats(): Promise<SuperMemoryStats> {
    return this.getStats();
  }

  async listSuper(statuses?: SuperMemoryStatus[]): Promise<SuperMemory[]> {
    await this.initialize();
    if (statuses && statuses.length > 0) {
      // Validate against the known set so unknown statuses raise instead of
      // silently returning an empty result (mirrors listSuperPage at line 848).
      const valid = statuses.filter((s) => VALID_MEMORY_STATUSES.has(s));
      if (valid.length === 0) return [];
      const placeholders = valid.map(() => '?').join(',');
      const rows = this.stmt(
          `SELECT data FROM memories WHERE status IN (${placeholders}) ORDER BY updated_at DESC`,
        )
        .all(...valid) as Array<{ data: string }>;
      return rows.map((r) => this.rowToMemory(r));
    }
    const rows = this.stmt('SELECT data FROM memories ORDER BY updated_at DESC')
      .all() as Array<{ data: string }>;
    return rows.map((r) => this.rowToMemory(r));
  }

  async getSuperMemory(id: string): Promise<SuperMemory | null> {
    await this.initialize();
    const row = this.stmt('SELECT data FROM memories WHERE id = ?').get(id) as
      | { data: string }
      | undefined;
    return row ? this.rowToMemory(row) : null;
  }

  async updateSuperMemory(id: string, patch: UpdateSuperMemoryInput): Promise<SuperMemory> {
    return this.updateSuper(id, patch);
  }

  async search(
    query: string,
    scope: MemoryScope = 'project-memory',
    limit?: number,
  ): Promise<MemoryEntry[]> {
    const memories = await this.searchSuper(query, {
      scope: legacyToSuperScope(scope),
      limit,
      // Do NOT pass includeStatuses — let searchSuper apply its default
      // (['active']) AND the contextPolicy !== 'never' filter that only
      // fires when includeStatuses is undefined (automatic context).
      // Mirrors canonical SuperMemoryStore.search (store.ts:2253-2259).
    });
    return memories
      .filter((memory) => memory.contextPolicy !== 'never')
      .filter((memory) => (memory.legacyScope ?? superToLegacyScope(memory.scope)) === scope)
      .map(toLegacyEntry);
  }

  async deleteSuperMemory(
    id: string,
    reason = 'Manually deleted via API.',
    options: { force?: boolean; neverInject?: boolean } = {},
  ): Promise<void> {
    // All mutation-state-dependent checks (not-found, idempotency, and the
    // force/permanent guard) live INSIDE runMutation so they read the same
    // row snapshot that the actual delete operates on. This prevents a TOCTOU
    // race where a concurrent write flips the row's status or persistence
    // between the guard check and the mutation (multiple peer reviews flagged
    // this as the canonical store reads inside the mutation for the same reason).
    await this.runMutation(() => {
      const row = this.stmt('SELECT data FROM memories WHERE id = ?').get(id) as
        | { data: string }
        | undefined;
      if (!row) throw new Error(`Super Memory "${id}" not found.`);
      const fresh = this.rowToMemory(row);
      if (fresh.status === 'deleted') return; // Idempotent

      // Mirror the canonical guard from SuperMemoryStore.deleteSuperMemory
      // (packages/super-memory/src/store.ts:1569-1597). All checks run
      // on the fresh snapshot inside the mutation lock.
      if (!options.force) {
        if (fresh.persistence === 'permanent') {
          throw new Error(
            `Super Memory "${id}" is marked 'permanent' and cannot be deleted. ` +
              `Pass { force: true } to override; the override will be recorded in the audit log.`,
          );
        }
        throw new Error(
          `Super Memory "${id}" cannot be deleted without explicit authorization. ` +
            `Pass { force: true } to the memory_delete tool, or resolve a review candidate ` +
            `via memory_candidates({ action: 'resolve', decision: 'delete' }). ` +
            `The force flag is recorded in the audit log.`,
        );
      }

      const nodeId = SqliteSuperMemoryStore.toNodeId(id);
      const edgeCount = this.stmt('SELECT COUNT(*) AS n FROM edges WHERE from_node = ? OR to_node = ?')
        .get(nodeId, nodeId) as { n: number };

      // Cascade: clean up references in other memories. Mirrors the reference
      // cleanup logic of SuperMemoryStore.cascadeDeleteUnlocked (store.ts:1650-1671),
      // but uses direct upsertMemory() instead of updateMemory() — so these
      // cascade updates do NOT write an appendRecord audit entry. This is an
      // accepted divergence: the canonical JSONL store's appendRecord writes a
      // history line per mutation, but the SQLite store has no equivalent
      // append-only audit log for individual mutations within a runMutation
      // block. The outer memory.deleted audit entry (below) is the authoritative
      // record.
      // Only load rows that actually reference `id` — avoids parsing every
      // memory blob on delete for large stores.
      const refs = this.stmt(
        `SELECT id, data FROM memories
         WHERE id != ?
           AND status != 'deleted'
           AND (
             json_extract(data, '$.supersededBy') = ?
             OR EXISTS (
               SELECT 1 FROM json_each(COALESCE(json_extract(data, '$.supersedes'), '[]'))
               WHERE value = ?
             )
             OR EXISTS (
               SELECT 1 FROM json_each(COALESCE(json_extract(data, '$.contradicts'), '[]'))
               WHERE value = ?
             )
           )`,
      ).all(id, id, id, id) as Array<{ id: string; data: string }>;
      for (const ref of refs) {
        const other = this.rowToMemory(ref);
        const patch: Partial<SuperMemory> = {};
        if (other.supersedes?.includes(id)) {
          patch.supersedes = other.supersedes.filter((s) => s !== id);
        }
        if (other.contradicts?.includes(id)) {
          patch.contradicts = other.contradicts.filter((c) => c !== id);
        }
        if (other.supersededBy === id) {
          patch.supersededBy = undefined;
        }
        if (Object.keys(patch).length > 0) {
          // Preserve updatedAt so the hygiene scanner's freshness scores
          // are not artificially reset by a cascade reference cleanup
          // (matches SuperMemoryStore.cascadeDeleteUnlocked:1668).
          const updated: SuperMemory = {
            ...other,
            ...patch,
            revision: other.revision + 1,
          };
          this.upsertMemory(updated);
        }
      }

      // Soft-delete: set status to 'deleted' (preserve tombstone for audit/recovery).
      // Matches SuperMemoryStore.cascadeDeleteUnlocked behaviour (store.ts:1673-1677).
      const softDeleted: SuperMemory = {
        ...fresh,
        status: 'deleted',
        revision: fresh.revision + 1,
        updatedAt: this.nowIso(),
        ...(options.neverInject === true ? { contextPolicy: 'never' as const } : {}),
      };
      this.upsertMemory(softDeleted);
      this.cascadeDeleteEdges(nodeId);

      this.audit('memory.deleted', {
        memoryId: id,
        reason,
        details: {
          removedEdges: edgeCount.n,
          force: options.force === true,
          contextPolicy: options.neverInject === true ? 'never' : 'eligible',
        },
      });
      this.events?.emit(
        'memory.deleted',
        this.eventPayload({
          memoryId: id,
          reason,
          persistence: fresh.persistence ?? DEFAULT_PERSISTENCE,
          removedEdges: edgeCount.n,
          contextPolicy: options.neverInject === true ? ('never' as const) : ('eligible' as const),
        }),
      );
      this.events?.emit(
        'memory.updated',
        this.eventPayload({
          memoryId: id,
          status: 'deleted',
          contextPolicy: options.neverInject === true ? ('never' as const) : ('eligible' as const),
        }),
      );
    });
  }

  close(): void {
    this.stmtCache.clear();
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // Already closed — idempotent.
      }
    }
  }
}

function importanceFromPriority(priority: MemoryEntry['priority']): number {
  switch (priority) {
    case 'critical':
      return 1;
    case 'high':
      return 0.8;
    case 'low':
      return 0.3;
    case 'medium':
    case undefined:
      return 0.6;
    default: {
      // Unknown priority — defensively fall back to medium (0.6) instead of
      // throwing on a hot path where unvalidated input could reach here
      // (e.g. JSON deserialization of persisted data from a future version).
      return 0.6;
    }
  }
}

function legacyScopeLabel(scope: MemoryScope): string {
  switch (scope) {
    case 'project-agents':
      return 'Project AGENTS.md';
    case 'project-memory':
      return 'Project Memory';
    case 'user-memory':
      return 'User Memory';
    default: {
      // Exhaustive — all union cases handled above.
      // Throw so a future MemoryScope addition is caught at runtime
      // instead of silently producing `## undefined` in readAll() output.
      const _exhaustive: never = scope;
      throw new Error(`Unknown scope: ${_exhaustive}`);
    }
  }
}

function matchesLegacyForget(memory: SuperMemory, normalizedQuery: string): boolean {
  const searchable = [
    memory.id,
    memory.text,
    ...memory.tags,
    ...memory.anchors.flatMap((anchor) => [anchor.path, anchor.symbol, anchor.command]),
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  return searchable.includes(normalizedQuery);
}

function isMigratableMemoryRecord(value: unknown): value is SuperMemoryRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<SuperMemoryRecord>;
  const memory = record.memory as Partial<SuperMemory> | undefined;
  return (
    record.recordType === 'memory' &&
    !!memory &&
    typeof memory.id === 'string' &&
    Number.isInteger(memory.revision) &&
    (memory.revision ?? 0) >= 1 &&
    typeof memory.status === 'string' &&
    typeof memory.kind === 'string' &&
    typeof memory.scope === 'string' &&
    typeof memory.text === 'string' &&
    typeof memory.importance === 'number' &&
    Number.isFinite(memory.importance) &&
    typeof memory.confidence === 'number' &&
    Number.isFinite(memory.confidence) &&
    typeof memory.freshness === 'number' &&
    Number.isFinite(memory.freshness) &&
    Array.isArray(memory.tags) &&
    Array.isArray(memory.anchors) &&
    Array.isArray(memory.sources) &&
    typeof memory.createdAt === 'string' &&
    typeof memory.updatedAt === 'string'
  );
}

/** Match the JSONL replay rule while never replacing a newer SQLite revision. */
function shouldReplaceMigratedMemory(current: SuperMemory, incoming: SuperMemory): boolean {
  if (incoming.revision !== current.revision) return incoming.revision > current.revision;
  return current.status === 'deleted' && incoming.status !== 'deleted';
}

function isMigratableCandidate(value: unknown): value is MemoryCandidate {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MemoryCandidate>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.status === 'string' &&
    typeof candidate.text === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string'
  );
}

function isMigratableEdge(value: unknown): value is MemoryGraphEdge {
  if (!value || typeof value !== 'object') return false;
  const edge = value as Partial<MemoryGraphEdge>;
  return (
    typeof edge.id === 'string' &&
    typeof edge.from === 'string' &&
    typeof edge.to === 'string' &&
    typeof edge.relation === 'string' &&
    typeof edge.weight === 'number' &&
    Number.isFinite(edge.weight) &&
    typeof edge.createdAt === 'string'
  );
}

function isMigratableAuditRecord(value: unknown): value is SuperMemoryAuditRecord {
  if (!value || typeof value !== 'object') return false;
  const audit = value as Partial<SuperMemoryAuditRecord>;
  return typeof audit.event === 'string' && typeof audit.at === 'string';
}

/**
 * Canonical text key for deduplication. Mirrors SuperMemoryStore's
 * internal helper so both stores produce identical dedup keys.
 */
// canonicalMemoryText moved to store-helpers.ts
