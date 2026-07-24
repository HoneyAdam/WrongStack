import { type FSWatcher, watch } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  HqKanbanBoardRecord,
  HqKanbanSnapshotPayload,
  HqKanbanTombstone,
  HqPublisher,
} from '@wrongstack/core/hq';
import { deriveHqProjectId } from '@wrongstack/core/hq';
import { atomicWrite } from '@wrongstack/core/utils';
import {
  deleteBoard,
  getKanbanDir,
  isValidBoardId,
  type KanbanBoard,
  listBoardIds,
  readBoard,
  writeBoard,
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
// The HQ WebSocket server deliberately caps inbound frames at 1 MiB. Keep
// project-state payloads comfortably below that limit so the event envelope,
// UTF-8 expansion, and future protocol metadata still have headroom.
const MAX_KANBAN_SNAPSHOT_PAYLOAD_BYTES = 512 * 1024;
const KANBAN_TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// --- File-watcher guard limits ---
// Cap the number of boards read per publish cycle so a large project doesn't
// open hundreds of JSON files in a single burst. Remaining boards spill to
// the next cycle.
const MAX_BOARDS_PER_PUBLISH = 50;
// Reject unreasonably long filenames in the watcher callback before they reach
// isValidBoardId. +5 accounts for the ".json" suffix check.
const MAX_BOARD_ID_LENGTH = 128;

export function createKanbanHqSync(
  projectRoot: string,
  projectId = deriveHqProjectId(projectRoot),
): KanbanHqSync {
  const dir = getKanbanDir(projectRoot);
  const statePath = path.join(dir, SYNC_STATE_FILE);
  let publisher: HqPublisher | undefined;
  let watcher: FSWatcher | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pendingBoardIds = new Set<string>();
  let fullRescanPending = false;
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

  // Schedule the next publish cycle with a fixed debounce. The caller
  // (schedulePublish) already collapses rapid events into one batch, and
  // runExclusive serializes execution — no Date.now()-based interval is
  // needed because the 100ms debounce plus serialization chain already
  // prevents back-to-back publish bursts.
  const scheduleNext = (): void => {
    if (stopped || timer !== undefined || applyingRemote) return;
    timer = setTimeout(() => {
      timer = undefined;
      const rescan = fullRescanPending;
      const dirtyBoardIds = [...pendingBoardIds];
      fullRescanPending = false;
      pendingBoardIds.clear();
      void runExclusive(() => publishLocal(false, rescan ? undefined : dirtyBoardIds));
    }, 100);
    timer.unref?.();
  };

  const schedulePublish = (boardId: string | null): void => {
    if (stopped || applyingRemote || publisher === undefined) return;
    if (boardId === null) fullRescanPending = true;
    else pendingBoardIds.add(boardId);
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    scheduleNext();
  };

  const publishLocal = async (
    fullSnapshot: boolean,
    dirtyBoardIds?: readonly string[],
  ): Promise<void> => {
    const target = publisher;
    if (target === undefined || stopped) return;
    const state = await readState(statePath);
    const prunedTombstones = pruneExpiredTombstones(state, Date.now());
    let stateChanged = fullSnapshot || prunedTombstones;
    const boards: HqKanbanBoardRecord[] = [];
    const tombstones: HqKanbanTombstone[] = [];
    const fullScan = fullSnapshot || dirtyBoardIds === undefined;
    const allBoardIds: readonly string[] = fullScan
      ? await listBoardIds(projectRoot)
      : dirtyBoardIds;
    let boardIds = allBoardIds;

    // Batch limit: only cap true delta publishes, never a full scan (initial
    // snapshot OR full rescan). When fullScan is true, ALL boards must be
    // loaded into `present` so the deletion-detection loop below does NOT
    // false-tombstone the boards this cycle didn't reach.
    if (!fullScan && boardIds.length > MAX_BOARDS_PER_PUBLISH) {
      for (const id of boardIds.slice(MAX_BOARDS_PER_PUBLISH)) {
        pendingBoardIds.add(id);
      }
      scheduleNext();
      boardIds = boardIds.slice(0, MAX_BOARDS_PER_PUBLISH);
    }

    const present = new Set<string>();
    const now = new Date().toISOString();
    for (const boardId of boardIds) {
      const board = await readBoard(projectRoot, boardId);
      if (board === null) {
        const known = state.boards[boardId];
        if (known !== undefined && state.tombstones[boardId] === undefined) {
          const tombstone = {
            boardId,
            revision: known.revision + 1,
            deletedAt: now,
          };
          state.tombstones[boardId] = tombstone;
          tombstones.push(tombstone);
          stateChanged = true;
        }
        continue;
      }
      present.add(boardId);
      const record = boardRecord(board);
      const known = state.boards[boardId];
      const hadTombstone = state.tombstones[boardId] !== undefined;
      if (
        fullSnapshot ||
        hadTombstone ||
        known === undefined ||
        compareVersions(
          known.revision,
          known.updatedAt,
          record.revision,
          record.updatedAt,
        ) !== 0
      ) {
        boards.push(record);
      }
      if (
        known === undefined ||
        known.revision !== record.revision ||
        known.updatedAt !== record.updatedAt ||
        hadTombstone
      ) {
        stateChanged = true;
      }
      state.boards[boardId] = { revision: record.revision, updatedAt: record.updatedAt };
      delete state.tombstones[boardId];
    }
    if (fullScan) {
      for (const [boardId, known] of Object.entries(state.boards)) {
        if (
          present.has(boardId) ||
          state.tombstones[boardId] !== undefined ||
          isExpiredVersion(known.updatedAt, Date.now())
        ) {
          continue;
        }
        const tombstone = {
          boardId,
          revision: known.revision + 1,
          deletedAt: now,
        };
        state.tombstones[boardId] = tombstone;
        tombstones.push(tombstone);
        stateChanged = true;
      }
    }
    if (stateChanged) await writeState(statePath, state);

    // A filesystem event caused by applying an HQ snapshot often arrives after
    // `applyingRemote` has been cleared. The persisted state fingerprint above
    // lets that event collapse to an empty delta instead of echoing the entire
    // project back to HQ and starting an N-client broadcast storm.
    if (!fullSnapshot && boards.length === 0 && tombstones.length === 0) return;

    for (const payload of chunkSnapshotPayload(
      projectId,
      now,
      boards,
      fullSnapshot ? Object.values(state.tombstones) : tombstones,
    )) {
      target.publishEvent({
        type: 'kanban.snapshot',
        payload,
        maxSummaryLength: 100_000,
      });
    }
  };

  const attachPublisher = (next: HqPublisher): Promise<void> => {
    publisher = next;
    return runExclusive(async () => {
      if (watcher === undefined) {
        await fs.mkdir(dir, { recursive: true });
        watcher = watch(dir, { persistent: false }, (_event, filename) => {
          if (filename === null) {
            schedulePublish(null);
            return;
          }
          // Reject pathologically long filenames before any allocation or
          // id validation — protects against inotify spam from non-kanban
          // tooling that writes temp files into the kanban directory.
          if (filename.length > MAX_BOARD_ID_LENGTH + 5) return; // +5 for ".json"
          if (filename === SYNC_STATE_FILE || filename.endsWith('.events.jsonl')) return;
          if (!filename.endsWith('.json')) return;
          const boardId = filename.slice(0, -'.json'.length);
          if (isValidBoardId(boardId)) schedulePublish(boardId);
        });
        watcher.on('error', () => {
          watcher?.close();
          watcher = undefined;
        });
      }
      await publishLocal(true);
    });
  };

  const applyRemote = async (snapshot: HqKanbanSnapshotPayload): Promise<void> => {
    if (snapshot.projectId !== projectId || stopped) return;
    applyingRemote = true;
    try {
      const state = await readState(statePath);
      for (const remote of snapshot.boards) {
        const local = await readBoard(projectRoot, remote.boardId);
        if (
          local !== null &&
          compareVersions(
            local.revision ?? 0,
            local.updatedAt,
            remote.revision,
            remote.updatedAt,
          ) >= 0
        ) {
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
          compareVersions(
            local.revision ?? 0,
            local.updatedAt,
            tombstone.revision,
            tombstone.deletedAt,
          ) >= 0
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
      pendingBoardIds.clear();
      fullRescanPending = false;
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

function chunkSnapshotPayload(
  projectId: string,
  generatedAt: string,
  boards: HqKanbanBoardRecord[],
  tombstones: HqKanbanTombstone[],
): HqKanbanSnapshotPayload[] {
  const chunks: HqKanbanSnapshotPayload[] = [];
  const emptyPayload = (): HqKanbanSnapshotPayload => ({
    projectId,
    generatedAt,
    boards: [],
    tombstones: [],
  });
  const emptyPayloadBytes = Buffer.byteLength(JSON.stringify(emptyPayload()), 'utf8');
  let currentBoards: HqKanbanBoardRecord[] = [];
  let currentTombstones: HqKanbanTombstone[] = [];
  let currentBytes = emptyPayloadBytes;

  const pushCurrent = (): void => {
    if (currentBoards.length === 0 && currentTombstones.length === 0) return;
    chunks.push({
      projectId,
      generatedAt,
      boards: currentBoards,
      tombstones: currentTombstones,
    });
    currentBoards = [];
    currentTombstones = [];
    currentBytes = emptyPayloadBytes;
  };

  const append = (
    kind: 'boards' | 'tombstones',
    item: HqKanbanBoardRecord | HqKanbanTombstone,
  ): void => {
    const itemBytes = Buffer.byteLength(JSON.stringify(item), 'utf8');
    const itemCount = kind === 'boards' ? currentBoards.length : currentTombstones.length;
    const additionalBytes = itemBytes + (itemCount > 0 ? 1 : 0);
    if (emptyPayloadBytes + itemBytes > MAX_KANBAN_SNAPSHOT_PAYLOAD_BYTES) {
      process.emitWarning(
        `Kanban ${kind === 'boards' ? 'board' : 'tombstone'} ${item.boardId} exceeds the ${MAX_KANBAN_SNAPSHOT_PAYLOAD_BYTES}-byte snapshot chunk target`,
        { code: 'WRONGSTACK_HQ_KANBAN_OVERSIZED_RECORD' },
      );
    }
    if (
      (currentBoards.length > 0 || currentTombstones.length > 0) &&
      currentBytes + additionalBytes > MAX_KANBAN_SNAPSHOT_PAYLOAD_BYTES
    ) {
      pushCurrent();
    }
    if (kind === 'boards') {
      currentBoards.push(item as HqKanbanBoardRecord);
    } else {
      currentTombstones.push(item as HqKanbanTombstone);
    }
    currentBytes +=
      itemBytes +
      (kind === 'boards'
        ? currentBoards.length > 1
          ? 1
          : 0
        : currentTombstones.length > 1
          ? 1
          : 0);
  };

  for (const board of boards) append('boards', board);
  for (const tombstone of tombstones) append('tombstones', tombstone);
  pushCurrent();

  // An empty snapshot is meaningful on first attach: it registers the project
  // state channel even when the project has no boards yet.
  return chunks.length > 0 ? chunks : [emptyPayload()];
}

function compareVersions(
  aRevision: number,
  aTime: string,
  bRevision: number,
  bTime: string,
): number {
  if (aRevision !== bRevision) return aRevision - bRevision;
  return aTime.localeCompare(bTime);
}

function isExpiredVersion(timestamp: string, now: number): boolean {
  const parsed = Date.parse(timestamp);
  return !Number.isNaN(parsed) && parsed <= now - KANBAN_TOMBSTONE_RETENTION_MS;
}

function pruneExpiredTombstones(state: LocalSyncState, now: number): boolean {
  let changed = false;
  for (const [boardId, tombstone] of Object.entries(state.tombstones)) {
    if (!isExpiredVersion(tombstone.deletedAt, now)) continue;
    delete state.tombstones[boardId];
    delete state.boards[boardId];
    changed = true;
  }
  return changed;
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
  await atomicWrite(filePath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}
