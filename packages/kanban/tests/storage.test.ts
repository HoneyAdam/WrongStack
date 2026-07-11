import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  boardMeta,
  createBoardObject,
  deleteBoard,
  getKanbanPath,
  listBoardIds,
  listBoardSummaries,
  mutateBoard,
  readBoard,
  readKanbanEvents,
  resolveBoardRef,
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
});

// ── readBoard — null returns ───────────────────────────────────────

describe('readBoard', () => {
  it('returns null for unknown board', async () => {
    expect(await readBoard(tmpDir, 'nonexistent')).toBeNull();
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
