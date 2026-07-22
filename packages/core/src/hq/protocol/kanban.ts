const HQ_KANBAN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const MAX_HQ_KANBAN_BOARDS = 250;
const MAX_HQ_KANBAN_BOARD_BYTES = 750_000;

export interface HqKanbanBoardRecord {
  boardId: string;
  revision: number;
  updatedAt: string;
  /** Opaque KanbanBoard JSON. Kept in core so @wrongstack/kanban remains standalone. */
  board: Record<string, unknown>;
}

export interface HqKanbanTombstone {
  boardId: string;
  revision: number;
  deletedAt: string;
}

/** Complete project state emitted by one client. Missing boards are not deletions. */
export interface HqKanbanSnapshotPayload {
  projectId: string;
  generatedAt: string;
  boards: HqKanbanBoardRecord[];
  tombstones: HqKanbanTombstone[];
}

/** Server-to-client snapshot after HQ has merged all known project writers. */
export interface HqServerKanbanSnapshotMessage {
  type: 'hq.kanban_snapshot';
  payload: HqKanbanSnapshotPayload;
}

export function isHqKanbanSnapshotPayload(value: unknown): value is HqKanbanSnapshotPayload {
  if (typeof value !== 'object' || value === null) return false;
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.projectId !== 'string' ||
    payload.projectId.length === 0 ||
    typeof payload.generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(payload.generatedAt)) ||
    !Array.isArray(payload.boards) ||
    !Array.isArray(payload.tombstones) ||
    payload.boards.length > MAX_HQ_KANBAN_BOARDS ||
    payload.tombstones.length > MAX_HQ_KANBAN_BOARDS
  ) {
    return false;
  }

  const seen = new Set<string>();
  for (const item of payload.boards) {
    if (!isBoardRecord(item) || seen.has(item.boardId)) return false;
    seen.add(item.boardId);
  }
  for (const item of payload.tombstones) {
    if (!isTombstone(item) || seen.has(item.boardId)) return false;
    seen.add(item.boardId);
  }
  return true;
}

function isBoardRecord(value: unknown): value is HqKanbanBoardRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (
    typeof record.boardId !== 'string' ||
    !HQ_KANBAN_ID_PATTERN.test(record.boardId) ||
    typeof record.revision !== 'number' ||
    !Number.isSafeInteger(record.revision) ||
    record.revision < 0 ||
    typeof record.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(record.updatedAt)) ||
    typeof record.board !== 'object' ||
    record.board === null ||
    Array.isArray(record.board)
  ) {
    return false;
  }
  const board = record.board as Record<string, unknown>;
  if (board.id !== record.boardId) return false;
  try {
    return new TextEncoder().encode(JSON.stringify(board)).byteLength <= MAX_HQ_KANBAN_BOARD_BYTES;
  } catch {
    return false;
  }
}

function isTombstone(value: unknown): value is HqKanbanTombstone {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.boardId === 'string' &&
    HQ_KANBAN_ID_PATTERN.test(record.boardId) &&
    typeof record.revision === 'number' &&
    Number.isSafeInteger(record.revision) &&
    record.revision >= 0 &&
    typeof record.deletedAt === 'string' &&
    Number.isFinite(Date.parse(record.deletedAt))
  );
}
