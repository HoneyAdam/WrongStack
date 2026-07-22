import { randomUUID } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { deriveHqProjectId } from '@wrongstack/core/hq';
import type {
  HqKanbanBoardRecord,
  HqKanbanSnapshotPayload,
  HqKanbanTombstone,
  HqPublisher,
} from '@wrongstack/core/hq';
import {
  deleteBoard,
  getKanbanDir,
  listBoardIds,
  readBoard,
  writeBoard,
  type KanbanBoard,
} from '@wrongstack/kanban';

interface LocalSyncState {
  boards: Record<string, { revision: number; updatedAt: string }>;
  tombstones: Record<string, HqKanbanTombstone>;
}

export interface KanbanHqSync {
  attachPublisher(publisher: HqPublisher): Promise<void>;
  handleRemote(snapshot: HqKanbanSnapshotPayload): Promise<void>;
  stop(): void;
}

const SYNC_STATE_FILE = '.hq-sync.json';

export function createKanbanHqSync(
  projectRoot: string,
  projectId = deriveHqProjectId(projectRoot),
): KanbanHqSync {
  const dir = getKanbanDir(projectRoot);
  const statePath = path.join(dir, SYNC_STATE_FILE);
  let publisher: HqPublisher | undefined;
  let watcher: FSWatcher | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let applyingRemote = false;
  let stopped = false;
  let operationChain: Promise<void> = Promise.resolve();

  const runExclusive = <T>(operation: () => Promise<T>): Promise<T> => {
    let resolveResult!: (value: T | PromiseLike<T>) => void;
    let rejectResult!: (reason?: unknown) => void;
    const result = new Promise<T>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    operationChain = operationChain.then(async () => {
      try {
        resolveResult(await operation());
      } catch (error) {
        rejectResult(error);
      }
    });
    return result;
  };

  const schedulePublish = (): void => {
    if (stopped || applyingRemote || publisher === undefined) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void runExclusive(publishLocal);
    }, 100);
    timer.unref?.();
  };

  const publishLocal = async (): Promise<void> => {
    const target = publisher;
    if (target === undefined || stopped) return;
    const state = await readState(statePath);
    const boards: HqKanbanBoardRecord[] = [];
    const present = new Set<string>();
    for (const boardId of await listBoardIds(projectRoot)) {
      const board = await readBoard(projectRoot, boardId);
      if (board === null) continue;
      present.add(boardId);
      const record = boardRecord(board);
      boards.push(record);
      state.boards[boardId] = { revision: record.revision, updatedAt: record.updatedAt };
      delete state.tombstones[boardId];
    }
    const now = new Date().toISOString();
    for (const [boardId, known] of Object.entries(state.boards)) {
      if (present.has(boardId) || state.tombstones[boardId] !== undefined) continue;
      state.tombstones[boardId] = {
        boardId,
        revision: known.revision + 1,
        deletedAt: now,
      };
    }
    await writeState(statePath, state);
    target.publishEvent({
      type: 'kanban.snapshot',
      payload: {
        projectId,
        generatedAt: now,
        boards,
        tombstones: Object.values(state.tombstones),
      } satisfies HqKanbanSnapshotPayload,
      maxSummaryLength: 100_000,
    });
  };

  const attachPublisher = async (next: HqPublisher): Promise<void> => {
    publisher = next;
    if (watcher === undefined) {
      await fs.mkdir(dir, { recursive: true });
      watcher = watch(dir, { persistent: false }, (_event, filename) => {
        if (filename === null || filename === SYNC_STATE_FILE || filename.endsWith('.events.jsonl')) {
          return;
        }
        if (filename.endsWith('.json')) schedulePublish();
      });
      watcher.on('error', () => {
        watcher?.close();
        watcher = undefined;
      });
    }
    await runExclusive(publishLocal);
  };

  const applyRemote = async (snapshot: HqKanbanSnapshotPayload): Promise<void> => {
    if (snapshot.projectId !== projectId || stopped) return;
    applyingRemote = true;
    try {
      const state = await readState(statePath);
      for (const remote of snapshot.boards) {
        const local = await readBoard(projectRoot, remote.boardId);
        if (local !== null && compareVersions(local.revision ?? 0, local.updatedAt, remote.revision, remote.updatedAt) >= 0) {
          continue;
        }
        await writeBoard(projectRoot, remote.board as unknown as KanbanBoard);
        state.boards[remote.boardId] = {
          revision: remote.revision,
          updatedAt: remote.updatedAt,
        };
        delete state.tombstones[remote.boardId];
      }
      for (const tombstone of snapshot.tombstones) {
        const local = await readBoard(projectRoot, tombstone.boardId);
        if (
          local !== null &&
          compareVersions(local.revision ?? 0, local.updatedAt, tombstone.revision, tombstone.deletedAt) >= 0
        ) {
          continue;
        }
        if (local !== null) await deleteBoard(projectRoot, tombstone.boardId);
        state.boards[tombstone.boardId] = {
          revision: Math.max(0, tombstone.revision - 1),
          updatedAt: tombstone.deletedAt,
        };
        state.tombstones[tombstone.boardId] = tombstone;
      }
      await writeState(statePath, state);
    } finally {
      applyingRemote = false;
    }
  };

  return {
    attachPublisher,
    handleRemote: (snapshot) => runExclusive(() => applyRemote(snapshot)),
    stop: () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      watcher?.close();
      watcher = undefined;
      publisher = undefined;
    },
  };
}

function boardRecord(board: KanbanBoard): HqKanbanBoardRecord {
  return {
    boardId: board.id,
    revision: board.revision ?? 0,
    updatedAt: board.updatedAt,
    board: structuredClone(board) as unknown as Record<string, unknown>,
  };
}

function compareVersions(aRevision: number, aTime: string, bRevision: number, bTime: string): number {
  if (aRevision !== bRevision) return aRevision - bRevision;
  return aTime.localeCompare(bTime);
}

async function readState(filePath: string): Promise<LocalSyncState> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as Partial<LocalSyncState>;
    return { boards: parsed.boards ?? {}, tombstones: parsed.tombstones ?? {} };
  } catch {
    return { boards: {}, tombstones: {} };
  }
}

async function writeState(filePath: string, state: LocalSyncState): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tempPath, filePath);
}
