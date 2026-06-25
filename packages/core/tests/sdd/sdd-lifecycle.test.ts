import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SddBoardSnapshot } from '../../src/sdd/board-types.js';
import { SddBoardStore } from '../../src/sdd/sdd-board-store.js';
import {
  destroySddProject,
  rollbackSddRunFromDisk,
} from '../../src/sdd/sdd-lifecycle.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sdd-lifecycle-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
});

function snapshot(over: Partial<SddBoardSnapshot> = {}): SddBoardSnapshot {
  return {
    runId: 'run-1',
    graphId: 'g1',
    title: 'T',
    status: 'idle',
    startedAt: 0,
    updatedAt: 0,
    progress: {
      total: 1,
      completed: 1,
      failed: 0,
      inProgress: 0,
      pending: 0,
      blocked: 0,
      review: 0,
      percentComplete: 100,
    },
    wave: 0,
    tasks: [],
    columns: [],
    ...over,
  };
}

describe('destroySddProject', () => {
  it('deletes specs / task-graphs / boards dirs + the session file', async () => {
    const paths = {
      projectSpecs: path.join(tmp, 'specs'),
      projectTaskGraphs: path.join(tmp, 'task-graphs'),
      projectSddSession: path.join(tmp, 'sdd-session.json'),
      projectSddBoards: path.join(tmp, 'sdd-boards'),
    };
    await fs.mkdir(paths.projectSpecs, { recursive: true });
    await fs.writeFile(path.join(paths.projectSpecs, 's.json'), '{}');
    await fs.mkdir(paths.projectTaskGraphs, { recursive: true });
    await fs.mkdir(paths.projectSddBoards, { recursive: true });
    await fs.writeFile(paths.projectSddSession, '{}');

    const res = await destroySddProject({ projectRoot: tmp, paths });

    expect(res.deleted.sort()).toEqual(['boards', 'session', 'specs', 'task-graphs']);
    await expect(fs.access(paths.projectSpecs)).rejects.toBeDefined();
    await expect(fs.access(paths.projectSddSession)).rejects.toBeDefined();
    await expect(fs.access(paths.projectSddBoards)).rejects.toBeDefined();
    // Not a git repo → cleanup removes nothing but never throws.
    expect(res.worktreesRemoved).toBe(0);
  });

  it('skips missing artifacts without throwing', async () => {
    const paths = {
      projectSpecs: path.join(tmp, 'nope-specs'),
      projectTaskGraphs: path.join(tmp, 'nope-graphs'),
      projectSddSession: path.join(tmp, 'nope-session.json'),
      projectSddBoards: path.join(tmp, 'nope-boards'),
    };
    const res = await destroySddProject({ projectRoot: tmp, paths });
    // Missing dirs are removed idempotently (rm force) but the file unlink fails.
    expect(res.deleted).not.toContain('session');
  });
});

describe('rollbackSddRunFromDisk', () => {
  const boardsDir = () => path.join(tmp, 'sdd-boards');

  it('reports when there is no board to roll back', async () => {
    const res = await rollbackSddRunFromDisk({ projectRoot: tmp, boardsDir: boardsDir() });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/no SDD board/i);
  });

  it('reports when the run recorded no merged commits', async () => {
    const store = new SddBoardStore({ baseDir: boardsDir() });
    await store.saveSnapshot(snapshot({ baseBranch: 'main', mergedCommits: [] }));
    const res = await rollbackSddRunFromDisk({ projectRoot: tmp, boardsDir: boardsDir() });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/no merged commits/i);
  });

  it('reports when the run recorded no base branch', async () => {
    const store = new SddBoardStore({ baseDir: boardsDir() });
    await store.saveSnapshot(snapshot({ mergedCommits: [{ taskId: 't', sha: 'abc', title: 'x' }] }));
    const res = await rollbackSddRunFromDisk({ projectRoot: tmp, boardsDir: boardsDir() });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/base branch/i);
  });
});
