import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  CURRENT_KANBAN_VERSION,
  DEFAULT_COLUMNS,
  type KanbanBoard,
  type KanbanBoardMeta,
  type KanbanBoardSummary,
  type KanbanEvent,
} from './types.js';
import { normalizeKanbanBoundaryPolicy } from './boundary.js';
import { atomicWrite, withFileLock } from './utils/atomic-write.js';

const KANBANS_DIR = 'kanbans';
const BOARD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function getKanbanDir(projectRoot: string): string {
  return path.join(projectRoot, '.wrongstack', KANBANS_DIR);
}

export function getKanbanPath(projectRoot: string, boardId: string): string {
  assertValidBoardId(boardId);
  const dir = path.resolve(getKanbanDir(projectRoot));
  const resolved = path.resolve(dir, `${boardId}.json`);
  const rel = path.relative(dir, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw invalidBoardId(boardId);
  }
  return resolved;
}

export function getKanbanEventsPath(projectRoot: string, boardId: string): string {
  assertValidBoardId(boardId);
  const dir = path.resolve(getKanbanDir(projectRoot));
  const resolved = path.resolve(dir, `${boardId}.events.jsonl`);
  const rel = path.relative(dir, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw invalidBoardId(boardId);
  }
  return resolved;
}

export function isValidBoardId(boardId: string): boolean {
  return BOARD_ID_RE.test(boardId) && !boardId.includes('..');
}

export function assertValidBoardId(boardId: string): void {
  if (!isValidBoardId(boardId)) throw invalidBoardId(boardId);
}

function invalidBoardId(boardId: string): Error {
  return new Error(`Invalid kanban board id: ${boardId}`);
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch (err) {
    if (isEnoent(err)) return false;
    throw err;
  }
}

export async function listBoardIds(projectRoot: string): Promise<string[]> {
  const dir = getKanbanDir(projectRoot);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name.slice(0, -5))
      .filter(isValidBoardId)
      .sort();
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }
}

/**
 * Resolve either a full board id or a unique id prefix.
 */
export async function resolveBoardRef(
  projectRoot: string,
  boardRef: string,
): Promise<string | null> {
  assertValidBoardId(boardRef);
  if (await pathExists(getKanbanPath(projectRoot, boardRef))) return boardRef;

  const matches = (await listBoardIds(projectRoot)).filter((id) => id.startsWith(boardRef));
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(`Ambiguous kanban board id "${boardRef}": ${matches.slice(0, 5).join(', ')}`);
  }
  return matches[0] ?? null;
}

export async function readBoard(
  projectRoot: string,
  boardRef: string,
): Promise<KanbanBoard | null> {
  const boardId = await resolveBoardRef(projectRoot, boardRef);
  if (!boardId) return null;
  try {
    const raw = await fs.readFile(getKanbanPath(projectRoot, boardId), 'utf8');
    return normalizeBoard(JSON.parse(raw) as KanbanBoard);
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

export async function writeBoard(projectRoot: string, board: KanbanBoard): Promise<void> {
  const normalized = normalizeBoard(board);
  const filePath = getKanbanPath(projectRoot, normalized.id);
  await withFileLock(filePath, async () => {
    await writeBoardUnlocked(filePath, normalized);
  });
}

/**
 * Maximum number of event log entries before rotation is triggered.
 * After reaching this threshold, the oldest entries are pruned to
 * EVENT_LOG_TRIM_TO to prevent unbounded file growth.
 */
export const EVENT_LOG_MAX_ENTRIES = 10_000;

/**
 * Target entry count after a rotation trim. Keeps the most recent
 * entries so recent audit history is always available.
 */
export const EVENT_LOG_TRIM_TO = 5_000;

export async function appendKanbanEvent(
  projectRoot: string,
  boardId: string,
  event: KanbanEvent,
): Promise<void> {
  const filePath = getKanbanEventsPath(projectRoot, boardId);
  await withFileLock(filePath, async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8');
    // Trim the event log to prevent unbounded growth (best-effort).
    // The size pre-check avoids reading the full file on every append.
    await trimKanbanEventLog(filePath);
  });
}

/**
 * Best-effort: read the events file, prune old entries if the count
 * exceeds EVENT_LOG_MAX_ENTRIES, and rewrite with only the most recent
 * EVENT_LOG_TRIM_TO entries. A failure here must never break event
 * recording — the catch handler ensures that.
 */
async function trimKanbanEventLog(filePath: string): Promise<void> {
  try {
    const stat = await fs.stat(filePath);
    // Quick heuristic: files under 512 KB are unlikely to exceed 10K JSON lines.
    // Avoids reading the full file on every append for quiet boards.
    if (stat.size < 512_000) return;
    const raw = await fs.readFile(filePath, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    if (lines.length <= EVENT_LOG_MAX_ENTRIES) return;
    const trimmed = lines.slice(-EVENT_LOG_TRIM_TO);
    await atomicWrite(filePath, `${trimmed.join('\n')}\n`, { encoding: 'utf8' });
  } catch {
    // Best-effort only: log-space management must never interrupt event recording.
  }
}

export async function readKanbanEvents(
  projectRoot: string,
  boardRef: string,
): Promise<KanbanEvent[]> {
  const boardId = await resolveBoardRef(projectRoot, boardRef);
  if (!boardId) return [];
  try {
    const raw = await fs.readFile(getKanbanEventsPath(projectRoot, boardId), 'utf8');
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as KanbanEvent);
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }
}

export async function deleteBoard(projectRoot: string, boardRef: string): Promise<boolean> {
  const boardId = await resolveBoardRef(projectRoot, boardRef);
  if (!boardId) return false;
  const filePath = getKanbanPath(projectRoot, boardId);
  return withFileLock(filePath, async () => {
    try {
      await fs.unlink(filePath);
      try {
        await fs.unlink(getKanbanEventsPath(projectRoot, boardId));
      } catch (eventsErr) {
        if (!isEnoent(eventsErr)) throw eventsErr;
      }
      return true;
    } catch (err) {
      if (isEnoent(err)) return false;
      throw err;
    }
  });
}

export async function mutateBoard<T>(
  projectRoot: string,
  boardRef: string,
  mutator: (board: KanbanBoard) => T | Promise<T>,
): Promise<{ board: KanbanBoard; result: T } | null> {
  const boardId = await resolveBoardRef(projectRoot, boardRef);
  if (!boardId) return null;
  const filePath = getKanbanPath(projectRoot, boardId);
  return withFileLock(filePath, async () => {
    let board: KanbanBoard;
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      board = normalizeBoard(JSON.parse(raw) as KanbanBoard);
    } catch (err) {
      if (isEnoent(err)) return null;
      throw err;
    }
    const readRevision = board.revision ?? 0;
    // Many high-frequency callers (notably the Kanban supervisor) use a
    // mutator that returns `null` when there is nothing to repair. Previously
    // even those no-op passes bumped the revision and rewrote the whole board.
    // Besides needless disk churn, each write wakes every directory watcher
    // and can create a self-sustaining render/lock workload in long-lived CLI
    // processes. Compare the canonical board payload so only real mutations
    // reach the filesystem; the mutator's result is still returned unchanged.
    const beforeMutation = JSON.stringify(board);
    const result = await mutator(board);
    const afterMutation = JSON.stringify(board);
    // Stale-write detection: re-read the on-disk revision under the same file
    // lock to catch cross-process modifications since our initial read. If the
    // revision changed, another agent or process mutated the board while we
    // were computing, and our mutation is based on stale state. This check
    // runs for both no-op and mutating paths so a silent no-op cannot mask a
    // concurrent write that happened during the mutator's async execution.
    const currentRaw = await fs.readFile(filePath, 'utf8');
    const currentBoard = JSON.parse(currentRaw) as KanbanBoard;
    const currentRevision = currentBoard.revision ?? 0;
    if (currentRevision !== readRevision) {
      throw new Error(
        `Stale write detected for board "${boardId}": on-disk revision ${currentRevision} ` +
          `does not match read revision ${readRevision}. The board was modified ` +
          'by another process since it was loaded. Rerun the operation.',
      );
    }
    if (afterMutation === beforeMutation) {
      // Genuine no-op: revision is still current but the mutator produced no
      // change. Skip the revision bump and the write entirely — every write
      // wakes directory watchers and creates churn for long-lived processes.
      return { board, result };
    }
    board.revision = (board.revision ?? 0) + 1;
    await writeBoardUnlocked(filePath, normalizeBoard(board));
    return { board, result };
  });
}

export function summarizeBoard(board: KanbanBoard): KanbanBoardSummary {
  const total = board.tasks.length;
  const completed = board.tasks.filter((task) => task.status === 'completed').length;
  const lastActivity = latestActivity(board);
  return {
    id: board.id,
    title: board.title,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
    columnCount: board.columns.length,
    taskCount: total,
    completedTaskCount: completed,
    ...(board.description !== undefined ? { description: board.description } : {}),
    ...(board.tags !== undefined ? { tags: board.tags } : {}),
    ...(board.presence !== undefined
      ? { presence: board.presence.map((entry) => ({ ...entry })) }
      : {}),
    ...(lastActivity !== undefined ? { lastActivity } : {}),
  };
}

export function boardMeta(board: KanbanBoard): KanbanBoardMeta {
  const summary = summarizeBoard(board);
  return {
    id: summary.id,
    title: summary.title,
    columnCount: summary.columnCount,
    taskCount: summary.taskCount,
    completedTaskCount: summary.completedTaskCount,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    ...(summary.description !== undefined ? { description: summary.description } : {}),
    ...(summary.tags !== undefined ? { tags: summary.tags } : {}),
    ...(summary.presence !== undefined
      ? { presence: summary.presence.map((entry) => ({ ...entry })) }
      : {}),
    ...(summary.lastActivity !== undefined ? { lastActivity: summary.lastActivity } : {}),
  };
}

export interface CreateBoardObjectOptions {
  title: string;
  description?: string | undefined;
  tags?: string[] | undefined;
  columns?: KanbanBoard['columns'] | undefined;
  generatedBy?: string | undefined;
  supervisor?: KanbanBoard['supervisor'] | undefined;
  lifecycle?: KanbanBoard['lifecycle'] | undefined;
  boundary?: KanbanBoard['boundary'] | undefined;
}

export function createBoardObject(opts: CreateBoardObjectOptions): KanbanBoard {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title: opts.title,
    columns: opts.columns?.length
      ? opts.columns.map((column, index) => ({ ...column, order: column.order ?? index }))
      : DEFAULT_COLUMNS.map((column) => ({ ...column })),
    tasks: [],
    createdAt: now,
    updatedAt: now,
    version: CURRENT_KANBAN_VERSION,
    revision: 0,
    ...(opts.description !== undefined ? { description: opts.description } : {}),
    ...(opts.tags !== undefined ? { tags: opts.tags } : {}),
    ...(opts.generatedBy !== undefined ? { generatedBy: opts.generatedBy } : {}),
    ...(opts.supervisor !== undefined ? { supervisor: { ...opts.supervisor } } : {}),
    ...(opts.lifecycle !== undefined
      ? { lifecycle: { ...opts.lifecycle, columns: { ...opts.lifecycle.columns } } }
      : {}),
    ...(opts.boundary !== undefined
      ? { boundary: normalizeKanbanBoundaryPolicy(opts.boundary) }
      : {}),
  };
}

export async function listBoardSummaries(projectRoot: string): Promise<KanbanBoardSummary[]> {
  const summaries: KanbanBoardSummary[] = [];
  for (const id of await listBoardIds(projectRoot)) {
    const board = await readBoard(projectRoot, id);
    if (board) summaries.push(summarizeBoard(board));
  }
  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function normalizeBoard(board: KanbanBoard): KanbanBoard {
  const now = new Date().toISOString();
  const columns = [...(board.columns?.length ? board.columns : DEFAULT_COLUMNS)]
    .map((column, index) => ({
      ...column,
      order: column.order ?? index,
    }))
    .sort((a, b) => a.order - b.order)
    .map((column, index) => ({ ...column, order: index }));
  const columnIds = new Set(columns.map((column) => column.id));
  const fallbackColumnId = columns[0]?.id ?? 'backlog';
  const tasks = normalizeTaskOrders(
    (board.tasks ?? []).map((task, index) => ({
      ...task,
      columnId: columnIds.has(task.columnId) ? task.columnId : fallbackColumnId,
      order: task.order ?? index,
      priority: task.priority ?? 'medium',
      status: task.status ?? 'pending',
      createdAt: task.createdAt ?? now,
      updatedAt: task.updatedAt ?? now,
    })),
  );
  return {
    ...board,
    version: board.version ?? CURRENT_KANBAN_VERSION,
    revision: board.revision ?? 0,
    createdAt: board.createdAt ?? now,
    updatedAt: board.updatedAt ?? now,
    columns,
    tasks,
  };
}

function latestActivity(board: KanbanBoard): string | undefined {
  return [board.updatedAt, ...board.tasks.map((task) => task.updatedAt)]
    .filter(Boolean)
    .sort()
    .reverse()[0];
}

async function writeBoardUnlocked(filePath: string, board: KanbanBoard): Promise<void> {
  await atomicWrite(filePath, `${JSON.stringify(board, null, 2)}\n`, { encoding: 'utf8' });
}

function normalizeTaskOrders(tasks: KanbanBoard['tasks']): KanbanBoard['tasks'] {
  const byColumn = new Map<string, KanbanBoard['tasks']>();
  for (const task of tasks) {
    const columnTasks = byColumn.get(task.columnId) ?? [];
    columnTasks.push(task);
    byColumn.set(task.columnId, columnTasks);
  }
  for (const columnTasks of byColumn.values()) {
    columnTasks
      .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
      .forEach((task, index) => {
        task.order = index;
      });
  }
  return tasks;
}
