/**
 * ChronicleMetricsStore — derived, queryable aggregates over the raw
 * Chronicle journal ("process, don't hoard").
 *
 * The journal is the durable evidence log; this store is a disposable
 * projection kept in `<chronicleDir>/metrics.db` (node:sqlite, WAL). Each
 * `refresh()` incrementally consumes only the journal bytes appended since
 * the previous run (per-partition byte offsets in `ingest_state`), so the
 * raw JSONL partitions can be purged by retention without losing metrics:
 *
 * - `provider_daily`  — provider×model×day attempt/success/failure/retry/
 *                       fallback counts, token totals, duration stats.
 * - `task_outcomes`   — one row per task (kanban/SDD/subagent) with status,
 *                       timing, retry counts, and board/run/session lineage.
 * - `file_lineage`    — one row per observed file mutation with full
 *                       session/agent/task/board/tool/model attribution.
 * - `token_cost`      — latest cumulative token.accounted cost snapshot per
 *                       scope (same latest-wins semantics as the query
 *                       engine's summary).
 *
 * The schema is a cache: on version mismatch it is dropped and re-ingested
 * from whatever journal partitions still exist.
 */

import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { withFileLock } from '../utils/atomic-write.js';
import { findChroniclePartitions } from './query.js';
import type { ChronicleEvent } from './types.js';

const SCHEMA_VERSION = 1;
const READ_CHUNK_BYTES = 1024 * 1024;

export interface ChronicleMetricsRefreshResult {
  ingestedEvents: number;
  ingestedBytes: number;
  sourceFiles: number;
  invalidLines: number;
}

export interface ChronicleProviderDailyRow {
  day: string;
  providerId: string;
  modelId: string;
  attempts: number;
  completed: number;
  failed: number;
  retries: number;
  fallbacks: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  avgDurationMs: number;
  maxDurationMs: number;
}

export interface ChronicleTaskOutcomeRow {
  taskId: string;
  runId: string;
  boardId: string;
  sessionId: string;
  agentId: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  retries: number;
  verificationFailures: number;
  filesTouched: number;
}

export interface ChronicleFileLineageRow {
  path: string;
  operation: string;
  occurredAt: string;
  sessionId: string;
  agentId: string;
  taskId: string;
  boardId: string;
  runId: string;
  toolName: string;
  providerId: string;
  modelId: string;
  source: string;
}

export interface ChronicleMetricsSummary {
  providers: { attempts: number; completed: number; failed: number; successRate: number };
  tasks: Record<string, number>;
  files: { mutations: number; uniquePaths: number };
  estimatedCostUsd: number;
}

// ─── node:sqlite lazy loader (mirrors SAGE's pattern, compacted) ────────────

let Ctor: typeof DatabaseSync | null | undefined;

function loadDatabaseSync(): typeof DatabaseSync {
  if (Ctor) return Ctor;
  if (Ctor === null) throw new Error('node:sqlite is unavailable in this runtime');
  try {
    Ctor = (createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite'))
      .DatabaseSync;
    return Ctor;
  } catch (error) {
    Ctor = null;
    throw new Error(
      "Chronicle metrics need Node's built-in SQLite (node:sqlite, Node >= 22.5): " +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}

/** Non-throwing availability probe for callers that degrade gracefully. */
export function isChronicleMetricsAvailable(): boolean {
  try {
    loadDatabaseSync();
    return true;
  } catch {
    return false;
  }
}

// ─── Store ──────────────────────────────────────────────────────────────────

export class ChronicleMetricsStore {
  private readonly db: DatabaseSync;
  private readonly directory: string;
  private readonly dbPath: string;

  private constructor(directory: string) {
    this.directory = path.resolve(directory);
    this.dbPath = path.join(this.directory, 'metrics.db');
    const Database = loadDatabaseSync();
    this.db = new Database(this.dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.ensureSchema();
  }

  static open(chronicleDirectory: string): ChronicleMetricsStore {
    return new ChronicleMetricsStore(chronicleDirectory);
  }

  close(): void {
    this.db.close();
  }

  /** Incrementally ingest journal bytes appended since the last refresh.
   *  Safe across processes: guarded by a file lock on the database path. */
  async refresh(): Promise<ChronicleMetricsRefreshResult> {
    const result: ChronicleMetricsRefreshResult = {
      ingestedEvents: 0,
      ingestedBytes: 0,
      sourceFiles: 0,
      invalidLines: 0,
    };
    await withFileLock(this.dbPath, async () => {
      const files = await findChroniclePartitions(this.directory);
      const offsets = this.loadOffsets();
      for (const file of files) {
        const key = normalizeKey(path.relative(this.directory, file));
        const consumed = offsets.get(key) ?? 0;
        const ingested = await this.ingestFile(file, key, consumed, result);
        if (ingested) result.sourceFiles++;
      }
      this.pruneOffsets(files);
    });
    return result;
  }

  providerDaily(options: { from?: string; to?: string } = {}): ChronicleProviderDailyRow[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (options.from) {
      clauses.push('day >= ?');
      params.push(options.from.slice(0, 10));
    }
    if (options.to) {
      clauses.push('day <= ?');
      params.push(options.to.slice(0, 10));
    }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(
        `SELECT day, provider_id, model_id, attempts, completed, failed, retries, fallbacks,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
        duration_ms_total, duration_ms_max, duration_count
       FROM provider_daily${where} ORDER BY day DESC, provider_id, model_id`,
      )
      .all(...params) as Array<Record<string, string | number>>;
    return rows.map((row) => ({
      day: String(row.day),
      providerId: String(row.provider_id),
      modelId: String(row.model_id),
      attempts: Number(row.attempts),
      completed: Number(row.completed),
      failed: Number(row.failed),
      retries: Number(row.retries),
      fallbacks: Number(row.fallbacks),
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
      cacheReadTokens: Number(row.cache_read_tokens),
      cacheWriteTokens: Number(row.cache_write_tokens),
      avgDurationMs:
        Number(row.duration_count) > 0
          ? Number(row.duration_ms_total) / Number(row.duration_count)
          : 0,
      maxDurationMs: Number(row.duration_ms_max),
    }));
  }

  taskOutcomes(
    options: {
      runId?: string;
      boardId?: string;
      sessionId?: string;
      status?: string;
      limit?: number;
    } = {},
  ): ChronicleTaskOutcomeRow[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (options.runId) {
      clauses.push('t.run_id = ?');
      params.push(options.runId);
    }
    if (options.boardId) {
      clauses.push('t.board_id = ?');
      params.push(options.boardId);
    }
    if (options.sessionId) {
      clauses.push('t.session_id = ?');
      params.push(options.sessionId);
    }
    if (options.status) {
      clauses.push('t.status = ?');
      params.push(options.status);
    }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    params.push(clampLimit(options.limit, 100));
    const rows = this.db
      .prepare(
        `SELECT t.*, (SELECT COUNT(*) FROM file_lineage f WHERE f.task_id = t.task_id) AS files_touched
       FROM task_outcomes t${where}
       ORDER BY COALESCE(t.started_at, '') DESC LIMIT ?`,
      )
      .all(...params) as Array<Record<string, string | number | null>>;
    return rows.map((row) => ({
      taskId: String(row.task_id),
      runId: String(row.run_id),
      boardId: String(row.board_id),
      sessionId: String(row.session_id),
      agentId: String(row.agent_id),
      status: String(row.status),
      startedAt: row.started_at === null ? null : String(row.started_at),
      endedAt: row.ended_at === null ? null : String(row.ended_at),
      durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
      retries: Number(row.retries),
      verificationFailures: Number(row.verification_failures),
      filesTouched: Number(row.files_touched),
    }));
  }

  fileLineage(
    options: {
      path?: string;
      taskId?: string;
      boardId?: string;
      sessionId?: string;
      limit?: number;
    } = {},
  ): ChronicleFileLineageRow[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (options.path) {
      clauses.push('path = ?');
      params.push(normalizeKey(options.path));
    }
    if (options.taskId) {
      clauses.push('task_id = ?');
      params.push(options.taskId);
    }
    if (options.boardId) {
      clauses.push('board_id = ?');
      params.push(options.boardId);
    }
    if (options.sessionId) {
      clauses.push('session_id = ?');
      params.push(options.sessionId);
    }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    params.push(clampLimit(options.limit, 200));
    const rows = this.db
      .prepare(
        `SELECT path, operation, occurred_at, session_id, agent_id, task_id, board_id, run_id,
        tool_name, provider_id, model_id, source
       FROM file_lineage${where} ORDER BY occurred_at DESC LIMIT ?`,
      )
      .all(...params) as Array<Record<string, string>>;
    return rows.map((row) => ({
      path: row.path!,
      operation: row.operation!,
      occurredAt: row.occurred_at!,
      sessionId: row.session_id!,
      agentId: row.agent_id!,
      taskId: row.task_id!,
      boardId: row.board_id!,
      runId: row.run_id!,
      toolName: row.tool_name!,
      providerId: row.provider_id!,
      modelId: row.model_id!,
      source: row.source!,
    }));
  }

  summary(): ChronicleMetricsSummary {
    const provider = this.db
      .prepare(
        'SELECT COALESCE(SUM(attempts),0) a, COALESCE(SUM(completed),0) c, COALESCE(SUM(failed),0) f FROM provider_daily',
      )
      .get() as { a: number; c: number; f: number };
    const tasks: Record<string, number> = {};
    for (const row of this.db
      .prepare('SELECT status, COUNT(*) n FROM task_outcomes GROUP BY status')
      .all() as Array<{ status: string; n: number }>) {
      tasks[row.status] = Number(row.n);
    }
    const files = this.db
      .prepare('SELECT COUNT(*) n, COUNT(DISTINCT path) p FROM file_lineage')
      .get() as { n: number; p: number };
    const cost = this.db.prepare('SELECT COALESCE(SUM(cost),0) c FROM token_cost').get() as {
      c: number;
    };
    const terminal = Number(provider.c) + Number(provider.f);
    return {
      providers: {
        attempts: Number(provider.a),
        completed: Number(provider.c),
        failed: Number(provider.f),
        successRate: terminal > 0 ? Number(provider.c) / terminal : 0,
      },
      tasks,
      files: { mutations: Number(files.n), uniquePaths: Number(files.p) },
      estimatedCostUsd: Number(cost.c),
    };
  }

  // ─── Ingest internals ─────────────────────────────────────────────────────

  private ensureSchema(): void {
    const version = (this.db.prepare('PRAGMA user_version').get() as { user_version: number })
      .user_version;
    if (version !== 0 && version !== SCHEMA_VERSION) {
      // Derived cache — drop and re-ingest from whatever journal remains.
      this.db.exec(
        'DROP TABLE IF EXISTS ingest_state; DROP TABLE IF EXISTS provider_daily;' +
          'DROP TABLE IF EXISTS task_outcomes; DROP TABLE IF EXISTS file_lineage;' +
          'DROP TABLE IF EXISTS token_cost;',
      );
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ingest_state (
        file TEXT PRIMARY KEY,
        bytes INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS provider_daily (
        day TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        completed INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        retries INTEGER NOT NULL DEFAULT 0,
        fallbacks INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        duration_ms_total REAL NOT NULL DEFAULT 0,
        duration_ms_max REAL NOT NULL DEFAULT 0,
        duration_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, provider_id, model_id)
      );
      CREATE TABLE IF NOT EXISTS task_outcomes (
        task_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL DEFAULT '',
        board_id TEXT NOT NULL DEFAULT '',
        session_id TEXT NOT NULL DEFAULT '',
        agent_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'started',
        started_at TEXT,
        ended_at TEXT,
        duration_ms REAL,
        retries INTEGER NOT NULL DEFAULT 0,
        verification_failures INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS file_lineage (
        event_id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        operation TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        session_id TEXT NOT NULL DEFAULT '',
        agent_id TEXT NOT NULL DEFAULT '',
        task_id TEXT NOT NULL DEFAULT '',
        board_id TEXT NOT NULL DEFAULT '',
        run_id TEXT NOT NULL DEFAULT '',
        tool_name TEXT NOT NULL DEFAULT '',
        provider_id TEXT NOT NULL DEFAULT '',
        model_id TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_file_lineage_path ON file_lineage(path, occurred_at);
      CREATE INDEX IF NOT EXISTS idx_file_lineage_task ON file_lineage(task_id);
      CREATE TABLE IF NOT EXISTS token_cost (
        scope_key TEXT PRIMARY KEY,
        day TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        cost REAL NOT NULL
      );
      PRAGMA user_version = ${SCHEMA_VERSION};
    `);
  }

  private loadOffsets(): Map<string, number> {
    const rows = this.db.prepare('SELECT file, bytes FROM ingest_state').all() as Array<{
      file: string;
      bytes: number;
    }>;
    return new Map(rows.map((row) => [row.file, Number(row.bytes)]));
  }

  private pruneOffsets(existingFiles: string[]): void {
    const keep = new Set(
      existingFiles.map((file) => normalizeKey(path.relative(this.directory, file))),
    );
    for (const row of this.db.prepare('SELECT file FROM ingest_state').all() as Array<{
      file: string;
    }>) {
      if (!keep.has(row.file))
        this.db.prepare('DELETE FROM ingest_state WHERE file = ?').run(row.file);
    }
  }

  /** Read complete lines appended after `consumed` bytes. The trailing
   *  partial line of an actively-written partition is left for the next
   *  refresh — `ingest_state.bytes` only ever advances past full lines. */
  private async ingestFile(
    file: string,
    key: string,
    consumed: number,
    result: ChronicleMetricsRefreshResult,
  ): Promise<boolean> {
    let handle: fs.FileHandle;
    try {
      handle = await fs.open(file, 'r');
    } catch {
      return false;
    }
    try {
      const size = (await handle.stat()).size;
      if (size <= consumed) return false;
      let position = consumed;
      let remainder = Buffer.alloc(0);
      let advanced = consumed;
      this.db.exec('BEGIN');
      try {
        while (position < size) {
          const length = Math.min(READ_CHUNK_BYTES, size - position);
          const buffer = Buffer.allocUnsafe(length);
          const { bytesRead } = await handle.read(buffer, 0, length, position);
          if (bytesRead <= 0) break;
          position += bytesRead;
          const data =
            remainder.length > 0
              ? Buffer.concat([remainder, buffer.subarray(0, bytesRead)])
              : buffer.subarray(0, bytesRead);
          const lastNewline = data.lastIndexOf(0x0a);
          if (lastNewline < 0) {
            remainder = Buffer.from(data);
            continue;
          }
          // '\n' is a single byte in UTF-8, so complete-line slices always
          // fall on character boundaries.
          for (const line of data.subarray(0, lastNewline).toString('utf8').split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              this.ingestEvent(JSON.parse(trimmed) as ChronicleEvent);
              result.ingestedEvents++;
            } catch {
              result.invalidLines++;
            }
          }
          // `data` always begins at absolute offset `advanced` (remainder is
          // exactly the unconsumed bytes), so the newline index maps directly.
          advanced += lastNewline + 1;
          remainder = Buffer.from(data.subarray(lastNewline + 1));
        }
        this.db
          .prepare(
            'INSERT INTO ingest_state (file, bytes) VALUES (?, ?) ' +
              'ON CONFLICT(file) DO UPDATE SET bytes = excluded.bytes',
          )
          .run(key, advanced);
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
      result.ingestedBytes += advanced - consumed;
      return advanced > consumed;
    } finally {
      await handle.close();
    }
  }

  private ingestEvent(event: ChronicleEvent): void {
    if (typeof event?.eventType !== 'string' || !event.scope) return;
    const type = event.eventType;
    if (type.startsWith('provider.attempt.') || type === 'provider.fallback') {
      this.ingestProvider(event);
    } else if (type === 'token.accounted') {
      this.ingestTokenCost(event);
    } else if (/^(?:sdd|subagent|kanban)\.task[._]/.test(type)) {
      this.ingestTask(event);
    } else if (type === 'file.event' || /^file\.(?:tool|external)\./.test(type)) {
      this.ingestFileEvent(event);
    }
  }

  private ingestProvider(event: ChronicleEvent): void {
    const day = eventDay(event);
    const providerId = event.runtime?.providerId ?? '';
    const modelId = event.runtime?.modelId ?? '';
    this.db
      .prepare('INSERT OR IGNORE INTO provider_daily (day, provider_id, model_id) VALUES (?, ?, ?)')
      .run(day, providerId, modelId);
    const update = (sql: string, ...params: Array<string | number>) =>
      this.db
        .prepare(
          `UPDATE provider_daily SET ${sql} WHERE day = ? AND provider_id = ? AND model_id = ?`,
        )
        .run(...params, day, providerId, modelId);
    const duration = durationMs(event);
    switch (event.eventType) {
      case 'provider.attempt.started':
        update('attempts = attempts + 1');
        break;
      case 'provider.attempt.completed':
        update(
          'completed = completed + 1, input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, ' +
            'cache_read_tokens = cache_read_tokens + ?, cache_write_tokens = cache_write_tokens + ?, ' +
            'duration_ms_total = duration_ms_total + ?, duration_ms_max = MAX(duration_ms_max, ?), ' +
            'duration_count = duration_count + ?',
          numberAt(event, 'usage.input'),
          numberAt(event, 'usage.output'),
          numberAt(event, 'usage.cacheRead'),
          numberAt(event, 'usage.cacheWrite'),
          duration,
          duration,
          duration > 0 ? 1 : 0,
        );
        break;
      case 'provider.attempt.failed':
        update(
          'failed = failed + 1, retries = retries + ?, duration_ms_total = duration_ms_total + ?, ' +
            'duration_ms_max = MAX(duration_ms_max, ?), duration_count = duration_count + ?',
          event.attributes?.retryScheduled === true ? 1 : 0,
          duration,
          duration,
          duration > 0 ? 1 : 0,
        );
        break;
      case 'provider.fallback':
        update('fallbacks = fallbacks + 1');
        break;
      default:
        break;
    }
  }

  private ingestTokenCost(event: ChronicleEvent): void {
    const cost = readPath(event.attributes ?? {}, 'cost.total');
    if (typeof cost !== 'number' || !Number.isFinite(cost)) return;
    const scopeKey = `${event.scope.projectId ?? ''}\0${event.scope.sessionId ?? ''}\0${event.scope.agentId ?? ''}`;
    const occurredAt = event.occurredAt ?? event.observedAt;
    // Latest-wins per scope: token.accounted carries a cumulative snapshot.
    this.db
      .prepare(
        `INSERT INTO token_cost (scope_key, day, occurred_at, sequence, cost) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(scope_key) DO UPDATE SET
         day = excluded.day, occurred_at = excluded.occurred_at,
         sequence = excluded.sequence, cost = excluded.cost
       WHERE excluded.occurred_at > token_cost.occurred_at
          OR (excluded.occurred_at = token_cost.occurred_at AND excluded.sequence > token_cost.sequence)`,
      )
      .run(scopeKey, eventDay(event), occurredAt, event.sequence, cost);
  }

  private ingestTask(event: ChronicleEvent): void {
    const attributes = event.attributes ?? {};
    const taskId = event.scope.taskId ?? stringAt(attributes, 'taskId');
    if (!taskId) return;
    const occurredAt = event.occurredAt ?? event.observedAt;
    this.db.prepare('INSERT OR IGNORE INTO task_outcomes (task_id) VALUES (?)').run(taskId);
    const set = (sql: string, ...params: Array<string | number>) =>
      this.db.prepare(`UPDATE task_outcomes SET ${sql} WHERE task_id = ?`).run(...params, taskId);
    // Lineage columns: last non-empty observation wins.
    const lineage: Array<[string, string | undefined]> = [
      ['run_id', stringAt(attributes, 'runId')],
      ['board_id', event.scope.kanbanBoardId ?? stringAt(attributes, 'boardId')],
      ['session_id', event.scope.sessionId],
      ['agent_id', event.scope.agentId ?? stringAt(attributes, 'subagentId')],
    ];
    for (const [column, value] of lineage) {
      if (value) set(`${column} = ?`, value);
    }
    const base = event.eventType.replace(/^(?:sdd|subagent|kanban)\.task[._]/, '');
    switch (base) {
      case 'started':
        set("status = 'started', started_at = COALESCE(started_at, ?)", occurredAt);
        break;
      case 'completed':
        set(
          "status = 'completed', ended_at = ?, duration_ms = ?",
          occurredAt,
          numberOrDuration(event, attributes),
        );
        break;
      case 'failed':
        set("status = 'failed', ended_at = ?", occurredAt);
        break;
      case 'retrying':
        set('retries = retries + 1');
        break;
      case 'verification_failed':
        set('verification_failures = verification_failures + 1');
        break;
      case 'merged':
        set("status = 'merged'");
        break;
      case 'conflict':
        set("status = 'conflict'");
        break;
      default:
        break;
    }
  }

  private ingestFileEvent(event: ChronicleEvent): void {
    const attributes = event.attributes ?? {};
    const operation = stringAt(attributes, 'operation') ?? '';
    if (!operation || operation === 'read') return;
    const filePath = event.resource?.path ?? stringAt(attributes, 'filePath');
    if (!filePath) return;
    this.db
      .prepare(
        `INSERT OR IGNORE INTO file_lineage
        (event_id, path, operation, occurred_at, session_id, agent_id, task_id, board_id, run_id,
         tool_name, provider_id, model_id, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.eventId,
        normalizeKey(filePath),
        operation,
        event.occurredAt ?? event.observedAt,
        event.scope.sessionId ?? '',
        event.scope.agentId ?? '',
        event.scope.taskId ?? stringAt(attributes, 'taskId') ?? '',
        event.scope.kanbanBoardId ?? stringAt(attributes, 'boardId') ?? '',
        stringAt(attributes, 'runId') ?? '',
        stringAt(attributes, 'toolName') ?? '',
        event.runtime?.providerId ?? stringAt(attributes, 'provider') ?? '',
        event.runtime?.modelId ?? stringAt(attributes, 'model') ?? '',
        stringAt(attributes, 'source') ?? (event.eventType === 'file.event' ? 'tool' : 'external'),
      );
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function eventDay(event: ChronicleEvent): string {
  return (event.occurredAt ?? event.observedAt).slice(0, 10);
}

function durationMs(event: ChronicleEvent): number {
  const value = Number(event.durationNs ?? 0) / 1_000_000;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function numberOrDuration(event: ChronicleEvent, attributes: Record<string, unknown>): number {
  const explicit = attributes.durationMs;
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit;
  return durationMs(event);
}

function numberAt(event: ChronicleEvent, dotPath: string): number {
  const value = readPath(event.attributes ?? {}, dotPath);
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readPath(value: Record<string, unknown>, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (current, part) =>
        current && typeof current === 'object'
          ? (current as Record<string, unknown>)[part]
          : undefined,
      value,
    );
}

function stringAt(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function clampLimit(limit: number | undefined, fallback: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return fallback;
  return Math.min(Math.floor(limit), 10_000);
}

function normalizeKey(value: string): string {
  return value.replaceAll('\\', '/');
}
