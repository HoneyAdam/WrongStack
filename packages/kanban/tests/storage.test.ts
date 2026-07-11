import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  boardMeta,
  createBoardObject,
  deleteBoard,
  getKanbanPath,
  getKanbanEventsPath,
  isValidBoardId,
  listBoardIds,
  listBoardSummaries,
  mutateBoard,
  readBoard,
  readKanbanEvents,
  resolveBoardRef,
  writeBoard,
} from '../src/storage.js';
import { createBoard } from '../src/manager.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stor-test-'));
});

async function makeBoard() {
  return createBoard(tmpDir, { title: 'Storage Test' });
}

function fixtureBoard() {
  const now = new Date().toISOString();
  return {
    id: 'test-board-1',
    title: 'Fixture Board',
    columns: [{ id: 'col-1', title: 'Column 1', order: 0, wipLimit: 0 }],
    tasks: [],
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

// ── createBoardObject ──────────────────────────────────────────────

describe('createBoardObject', () => {
  it('creates a board with provided columns', () => {
    const board = createBoardObject({
      title: 'Custom',
      columns: [{ id: 'my-col', title: 'My Col', order: 0, wipLimit: 0 }],
    });
    expect(board.title).toBe('Custom');
    expect(board.columns).toHaveLength(1);
    expect(board.columns[0]!.id).toBe('my-col');
  });

  it('uses default columns when none provided', () => {
    const board = createBoardObject({ title: 'Defaults' });
    expect(board.columns.length).toBeGreaterThanOrEqual(4);
    expect(board.columns[0]!.id).toBe('backlog');
  });
});

// ── boardMeta ──────────────────────────────────────────────────────

describe('boardMeta', () => {
  it('returns metadata from a board', () => {
    const now = new Date().toISOString();
    const board = {
      ...fixtureBoard(),
      description: 'A test',
      tags: ['alpha'],
      tasks: [
        { id: 't1', title: 'Task 1', columnId: 'col-1', order: 0, priority: 'high' as const, status: 'completed' as const, createdAt: now, updatedAt: now, completedAt: now },
        { id: 't2', title: 'Task 2', columnId: 'col-1', order: 1, priority: 'medium' as const, status: 'pending' as const, createdAt: now, updatedAt: now },
      ],
    };
    const meta = boardMeta(board);
    expect(meta.title).toBe('Fixture Board');
    expect(meta.description).toBe('A test');
    expect(meta.tags).toEqual(['alpha']);
    expect(meta.columnCount).toBe(1);
    expect(meta.taskCount).toBe(2);
    expect(meta.completedTaskCount).toBe(1);
  });
});

// ── listBoardIds ───────────────────────────────────────────────────

describe('listBoardIds', () => {
  it('returns empty list when kanban dir does not exist', async () => {
    const ids = await listBoardIds(path.join(tmpDir, 'no-such-dir'));
    expect(ids).toEqual([]);
  });

  it('lists board IDs from created boards', async () => {
    const board = await makeBoard();
    const ids = await listBoardIds(tmpDir);
    expect(ids).toContain(board.id);
  });
});

// ── readKanbanEvents ───────────────────────────────────────────────

describe('readKanbanEvents', () => {
  it('returns empty array for unknown board', async () => {
    const events = await readKanbanEvents(tmpDir, 'nonexistent');
    expect(events).toEqual([]);
  });

  it('returns empty array when events file does not exist', async () => {
    const board = await makeBoard();
    const events = await readKanbanEvents(tmpDir, board.id);
    expect(events).toEqual([]);
  });

  it('reads and parses events', async () => {
    const board = await makeBoard();
    const eventsPath = path.join(
      path.dirname(getKanbanPath(tmpDir, board.id)),
      `${board.id}.events.jsonl`,
    );
    const events = [
      { type: 'task.created', taskId: 't1', timestamp: new Date().toISOString() },
      { type: 'task.completed', taskId: 't1', timestamp: new Date().toISOString() },
    ];
    await fs.writeFile(
      eventsPath,
      events.map((e) => JSON.stringify(e)).join('\n') + '\n',
      'utf8',
    );
    const parsed = await readKanbanEvents(tmpDir, board.id);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].type).toBe('task.created');
    expect(parsed[1].type).toBe('task.completed');
  });

  it('re-throws non-ENOENT errors during readKanbanEvents', async () => {
    const board = await makeBoard();
    // Replace events file with a directory so readFile throws EISDIR
    const eventsPath = path.join(
      path.dirname(getKanbanPath(tmpDir, board.id)),
      `${board.id}.events.jsonl`,
    );
    await fs.writeFile(eventsPath, '', 'utf8');
    await fs.unlink(eventsPath);
    await fs.mkdir(eventsPath, { recursive: true });
    await expect(readKanbanEvents(tmpDir, board.id)).rejects.toThrow();
  });
});

// ── deleteBoard — error paths ─────────────────────────────────────

describe('deleteBoard', () => {
  it('returns false for unknown board', async () => {
    expect(await deleteBoard(tmpDir, 'nonexistent')).toBe(false);
  });

  it('removes a board cleanly (events file may not exist)', async () => {
    const board = await makeBoard();
    const result = await deleteBoard(tmpDir, board.id);
    expect(result).toBe(true);
    // Verify board file is gone
    expect(await readBoard(tmpDir, board.id)).toBeNull();
  });

  it('re-throws non-ENOENT errors during delete', async () => {
    const board = await makeBoard();
    // Replace the board file with a directory so unlink throws EISDIR
    const boardPath = getKanbanPath(tmpDir, board.id);
    await fs.unlink(boardPath);
    await fs.mkdir(boardPath, { recursive: true });
    await expect(deleteBoard(tmpDir, board.id)).rejects.toThrow();
  });

  it('re-throws non-ENOENT errors from events unlink during delete', async () => {
    const board = await makeBoard();
    // Replace events file with a directory so unlink throws EISDIR
    const eventsDir = path.dirname(getKanbanPath(tmpDir, board.id));
    const eventsPath = path.join(eventsDir, `${board.id}.events.jsonl`);
    await fs.writeFile(eventsPath, '', 'utf8');
    await fs.unlink(eventsPath);
    await fs.mkdir(eventsPath, { recursive: true });
    await expect(deleteBoard(tmpDir, board.id)).rejects.toThrow();
  });

  it('returns false when board file vanishes between resolve and lock', async () => {
    const board = await makeBoard();
    const boardPath = getKanbanPath(tmpDir, board.id);
    // Delete the file after resolveBoardRef but before the locked unlink
    await fs.unlink(boardPath);
    const result = await deleteBoard(tmpDir, board.id);
    expect(result).toBe(false);
  });
});

// ── mutateBoard — error paths ─────────────────────────────────────

describe('mutateBoard', () => {
  it('returns null for unknown board ref', async () => {
    const result = await mutateBoard(tmpDir, 'nonexistent', () => 'ok');
    expect(result).toBeNull();
  });

  it('returns null when board file is deleted during operation', async () => {
    const board = await makeBoard();
    // Delete the board file so mutateBoard finds it via resolveBoardRef
    // but the actual readFile gets ENOENT
    const boardPath = getKanbanPath(tmpDir, board.id);
    // First verify the file exists, then delete it
    await fs.access(boardPath);
    await fs.unlink(boardPath);
    const result = await mutateBoard(tmpDir, board.id, () => 'ok');
    expect(result).toBeNull();
  });

  it('re-throws non-ENOENT errors during mutateBoard', async () => {
    const board = await makeBoard();
    // Replace board file with a directory so readFile throws EISDIR
    const boardPath = getKanbanPath(tmpDir, board.id);
    await fs.unlink(boardPath);
    await fs.mkdir(boardPath, { recursive: true });
    await expect(mutateBoard(tmpDir, board.id, () => 'ok')).rejects.toThrow();
  });
});

// ── readBoard — null returns ───────────────────────────────────────

describe('readBoard', () => {
  it('returns null for unknown board', async () => {
    expect(await readBoard(tmpDir, 'nonexistent')).toBeNull();
  });

  it('re-throws non-ENOENT errors during readBoard', async () => {
    const board = await makeBoard();
    // Replace board file with a directory so readFile throws EISDIR
    const boardPath = getKanbanPath(tmpDir, board.id);
    await fs.unlink(boardPath);
    await fs.mkdir(boardPath, { recursive: true });
    await expect(readBoard(tmpDir, board.id)).rejects.toThrow();
  });
});

// ── resolveBoardRef ────────────────────────────────────────────────

describe('resolveBoardRef', () => {
  it('returns null for unknown board', async () => {
    expect(await resolveBoardRef(tmpDir, 'nonexistent')).toBeNull();
  });

  it('resolves by full id', async () => {
    const board = await makeBoard();
    expect(await resolveBoardRef(tmpDir, board.id)).toBe(board.id);
  });

  it('resolves by unique prefix', async () => {
    const board = await makeBoard();
    const prefix = board.id.slice(0, 8);
    const resolved = await resolveBoardRef(tmpDir, prefix);
    expect(resolved).toBe(board.id);
  });

  it('throws on ambiguous prefix', async () => {
    // Create two boards with a shared prefix
    const b1 = await createBoard(tmpDir, { title: 'Board AA' });
    const b2 = await createBoard(tmpDir, { title: 'Board AB' });
    // Both have unique ids but we can test ambiguity by using a prefix
    // that matches both. Since UUIDs are random, we need a different approach:
    // directly create board files with predictable ids
    const sharedPrefix = 'ambig-';
    const now = new Date().toISOString();
    await fs.mkdir(path.join(tmpDir, '.wrongstack', 'kanbans'), { recursive: true });
    const writeBoardFile = async (id: string) => {
      const boardPath = getKanbanPath(tmpDir, id);
      await fs.writeFile(boardPath, JSON.stringify({
        id, title: `Board ${id}`, columns: [{ id: 'c1', title: 'C1', order: 0, wipLimit: 0 }],
        tasks: [], createdAt: now, updatedAt: now, version: 1,
      }), 'utf8');
    };
    await writeBoardFile(`${sharedPrefix}aaa`);
    await writeBoardFile(`${sharedPrefix}bbb`);
    await expect(resolveBoardRef(tmpDir, sharedPrefix)).rejects.toThrow(
      'Ambiguous kanban board id',
    );
  });
});

// ── listBoardSummaries ─────────────────────────────────────────────

describe('listBoardSummaries', () => {
  it('returns empty list when no boards', async () => {
    const summaries = await listBoardSummaries(tmpDir);
    expect(summaries).toEqual([]);
  });

  it('lists created boards sorted by updatedAt', async () => {
    await createBoard(tmpDir, { title: 'Board A' });
    await createBoard(tmpDir, { title: 'Board B' });
    const summaries = await listBoardSummaries(tmpDir);
    expect(summaries.length).toBeGreaterThanOrEqual(2);
    // Should be sorted descending by updatedAt
    for (let i = 1; i < summaries.length; i++) {
      expect(summaries[i - 1]!.updatedAt >= summaries[i]!.updatedAt).toBe(true);
    }
  });
});

// ── isValidBoardId ──────────────────────────────────────────────────

describe('isValidBoardId', () => {
  it('accepts valid board IDs', () => {
    expect(isValidBoardId('abc123')).toBe(true);
    expect(isValidBoardId('my-board_123')).toBe(true);
    expect(isValidBoardId('A')).toBe(true);
  });

  it('rejects invalid board IDs', () => {
    expect(isValidBoardId('')).toBe(false);
    expect(isValidBoardId('-start')).toBe(false);
    expect(isValidBoardId('has..dots')).toBe(false);
    expect(isValidBoardId('has spaces')).toBe(false);
  });
});

// ── writeBoard ──────────────────────────────────────────────────────

describe('writeBoard', () => {
  it('writes a board and can be read back', async () => {
    const board = createBoardObject({ title: 'Write Test' });
    await writeBoard(tmpDir, board);
    const read = await readBoard(tmpDir, board.id);
    expect(read).not.toBeNull();
    expect(read!.title).toBe('Write Test');
  });
});

// ── appendKanbanEvent ───────────────────────────────────────────────

describe('appendKanbanEvent', () => {
  it('appends an event and reads it back', async () => {
    const { appendKanbanEvent } = await import('../src/storage.js');
    const board = await makeBoard();
    const event = { type: 'task.moved' as const, taskId: 't1', fromColumn: 'c1', toColumn: 'c2', timestamp: new Date().toISOString() };
    await appendKanbanEvent(tmpDir, board.id, event);
    const events = await readKanbanEvents(tmpDir, board.id);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('task.moved');
  });
});

// ── assertValidBoardId (invalid path) ───────────────────────────────

describe('getKanbanPath with invalid board ID', () => {
  it('throws for invalid board id with dots', () => {
    expect(() => getKanbanPath(tmpDir, '..%2Fevil')).toThrow('Invalid kanban board id');
  });

  it('throws for invalid board id with slashes', () => {
    expect(() => getKanbanPath(tmpDir, '../../../etc/passwd')).toThrow('Invalid kanban board id');
  });
});

// ── boolean conditional branches ────────────────────────────────────

describe('createBoardObject conditional branches', () => {
  it('creates board without description, tags, or generatedBy', () => {
    const board = createBoardObject({ title: 'Minimal' });
    expect(board.title).toBe('Minimal');
    expect(board.description).toBeUndefined();
    expect(board.tags).toBeUndefined();
    expect(board.generatedBy).toBeUndefined();
  });

  it('creates board with all optional fields', async () => {
    const board = createBoardObject({
      title: 'Full',
      description: 'desc',
      tags: ['tag1'],
      generatedBy: 'test',
    });
    expect(board.description).toBe('desc');
    expect(board.tags).toEqual(['tag1']);
    expect(board.generatedBy).toBe('test');
  });
});

// ── boardMeta with undefined optionals ──────────────────────────────

describe('boardMeta with undefined fields', () => {
  it('handles board without description, tags, or tasks', () => {
    const board = createBoardObject({ title: 'Bare' });
    // Remove optional fields to hit the undefined branches
    delete (board as any).description;
    delete (board as any).tags;
    const meta = boardMeta(board);
    expect(meta.title).toBe('Bare');
    expect((meta as any).description).toBeUndefined();
    expect((meta as any).tags).toBeUndefined();
    expect(meta.taskCount).toBe(0);
    expect(meta.completedTaskCount).toBe(0);
  });

  it('boardMeta with tasks including completed', () => {
    const now = new Date().toISOString();
    const board = createBoardObject({ title: 'Stats' });
    board.tasks = [
      { id: 't1', title: 'Done', columnId: 'backlog', order: 0, priority: 'high', status: 'completed', createdAt: now, updatedAt: now, completedAt: now },
      { id: 't2', title: 'Pending', columnId: 'backlog', order: 1, priority: 'low', status: 'pending', createdAt: now, updatedAt: now },
    ];
    const meta = boardMeta(board);
    expect(meta.taskCount).toBe(2);
    expect(meta.completedTaskCount).toBe(1);
  });
});
