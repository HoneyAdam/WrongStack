import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { EventBus } from '../../src/kernel/events.js';
import {
  emptyTaskFile,
  loadTasks,
  mutateTasks,
  saveTasks,
} from '../../src/storage/task-store.js';

// vi.mock is hoisted above imports.  We use vi.importActual inside the factory
// to lazily get the real module, avoiding TDZ issues.  The returned plain object
// replaces 'node:fs/promises' before the second import runs.
vi.mock('node:fs/promises', async () => {
  const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');

  // In-memory store so writes and reads share state within a test.
  const store: Record<string, string> = {};

  const mockFs = {
    mkdtemp: async (prefix: string) => {
      const dir = await real.mkdtemp(prefix);
      store[dir] = '';
      return dir;
    },
    readFile: vi.fn(async (filepath: string) => {
      if (store[filepath] !== undefined) return store[filepath];
      return await real.readFile(filepath, 'utf8');
    }),
    writeFile: vi.fn(async (filepath: string, data: string) => {
      store[filepath] = data;
      try { await real.writeFile(filepath, data, 'utf8'); } catch { /* best-effort */ }
    }),
    rename: real.rename,
    access: vi.fn(async (filepath: string) => {
      if (store[filepath] !== undefined) return;
      try { await real.access(filepath); } catch { /* fall through */ }
      if (store[filepath] === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    }),
    unlink: vi.fn(async (filepath: string) => {
      delete store[filepath];
      try { await real.unlink(filepath); } catch { /* best-effort */ }
    }),
    mkdir: real.mkdir,
    readdir: real.readdir,
    rm: vi.fn(async (filepath: string, opts?: { recursive?: boolean; force?: boolean }) => {
      if (opts?.recursive) {
        for (const key of Object.keys(store)) {
          if (key.startsWith(filepath)) delete store[key];
        }
      } else {
        delete store[filepath];
      }
      try { await real.rm(filepath, opts); } catch { /* best-effort */ }
    }),
    chmod: real.chmod,
  };
  return mockFs;
});

import * as fsp from 'node:fs/promises';

function makeTask(overrides: Partial<import('../../src/utils/task-format.js').TaskItem> = {}): import('../../src/utils/task-format.js').TaskItem {
  return {
    id: 't1',
    title: 'Test task',
    type: 'feature',
    priority: 'high',
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('task-store', () => {
  // ── Basic persistence tests ────────────────────────────────────────────────

  it('round-trips tasks through save and load', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wstack-tasks-'));
    const fp = path.join(dir, 'sess.tasks.json');
    try {
      const taskFile: import('../../src/storage/task-store.js').TaskFile = {
        ...emptyTaskFile('sess'),
        tasks: [makeTask({ id: 't1', title: 'first' }), makeTask({ id: 't2', title: 'second' })],
      };
      await saveTasks(fp, taskFile);
      const loaded = await loadTasks(fp);
      expect(loaded?.tasks).toHaveLength(2);
      expect(loaded?.tasks[0]?.title).toBe('first');
      expect(loaded?.tasks[1]?.title).toBe('second');
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('loadTasks returns null when file is missing', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wstack-tasks-'));
    try {
      const loaded = await loadTasks(path.join(dir, 'missing.json'));
      expect(loaded).toBeNull();
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('loadTasks returns null when version is wrong', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wstack-tasks-'));
    const fp = path.join(dir, 'bad.json');
    try {
      await fsp.writeFile(fp, JSON.stringify({ version: 999, sessionId: 'sess', updatedAt: new Date().toISOString(), tasks: [] }), 'utf8');
      expect(await loadTasks(fp)).toBeNull();
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('loadTasks returns null when file is not valid JSON', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wstack-tasks-'));
    const fp = path.join(dir, 'bad.json');
    try {
      await fsp.writeFile(fp, 'not-json{', 'utf8');
      expect(await loadTasks(fp)).toBeNull();
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('mutateTasks creates a new file when none exists', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wstack-tasks-'));
    const fp = path.join(dir, 'new.tasks.json');
    try {
      const result = await mutateTasks(fp, 'sess', (file) => {
        file.tasks.push(makeTask({ id: 't1', title: 'created' }));
        return file;
      });
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0]?.title).toBe('created');
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('mutateTasks updates an existing file', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wstack-tasks-'));
    const fp = path.join(dir, 'sess.tasks.json');
    try {
      await saveTasks(fp, { ...emptyTaskFile('sess'), tasks: [makeTask({ id: 't1', title: 'original' })] });
      const result = await mutateTasks(fp, 'sess', (file) => {
        file.tasks[0]!.title = 'updated';
        return file;
      });
      expect(result.tasks[0]?.title).toBe('updated');
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  // ── storage.* event tests ─────────────────────────────────────────────────

  it('emits storage.read with outcome success when loadTasks finds a valid file', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wstack-tasks-'));
    const fp = path.join(dir, 'sess.tasks.json');
    const events: EventBus = { emit: vi.fn() } as never;
    try {
      await fsp.writeFile(fp, JSON.stringify({ version: 1, sessionId: 'sess', updatedAt: new Date().toISOString(), tasks: [makeTask()] }), 'utf8');
      await loadTasks(fp, events);
      expect(events.emit).toHaveBeenCalledWith('storage.read', expect.objectContaining({
        store: 'tasks',
        operation: 'load',
        outcome: 'success',
        sessionId: '~boot~',
      }));
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('emits storage.read with outcome failure when loadTasks finds invalid schema', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wstack-tasks-'));
    const fp = path.join(dir, 'bad.tasks.json');
    const events: EventBus = { emit: vi.fn() } as never;
    try {
      await fsp.writeFile(fp, JSON.stringify({ version: 999, sessionId: 'sess', updatedAt: new Date().toISOString(), tasks: [] }), 'utf8');
      await loadTasks(fp, events);
      expect(events.emit).toHaveBeenCalledWith('storage.read', expect.objectContaining({
        store: 'tasks',
        operation: 'load',
        outcome: 'failure',
        error: 'invalid_schema',
      }));
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('emits storage.read with outcome failure when loadTasks finds malformed JSON', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wstack-tasks-'));
    const fp = path.join(dir, 'bad.tasks.json');
    const events: EventBus = { emit: vi.fn() } as never;
    try {
      await fsp.writeFile(fp, 'not-json{', 'utf8');
      await loadTasks(fp, events);
      expect(events.emit).toHaveBeenCalledWith('storage.read', expect.objectContaining({
        store: 'tasks',
        operation: 'load',
        outcome: 'failure',
        error: 'parse_failed',
      }));
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('emits storage.error when loadTasks encounters a disk I/O error', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wstack-tasks-'));
    const fp = path.join(dir, 'io-error.tasks.json');
    const events: EventBus = { emit: vi.fn() } as never;
    // First ensure the file exists (so the error is a read error, not ENOENT)
    await fsp.writeFile(fp, JSON.stringify({ version: 1, sessionId: 'sess', updatedAt: new Date().toISOString(), tasks: [] }), 'utf8');
    try {
      fsp.readFile.mockRejectedValueOnce(
        Object.assign(new Error('EACCES permission denied'), { code: 'EACCES' }),
      );
      const result = await loadTasks(fp, events);
      expect(result).toBeNull();
      expect(events.emit).toHaveBeenCalledWith('storage.error', expect.objectContaining({
        store: 'tasks',
        operation: 'load',
        outcome: 'failure',
        error: expect.stringContaining('EACCES'),
      }));
    } finally {
      fsp.readFile.mockReset();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('emits storage.write with outcome success when saveTasks succeeds', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wstack-tasks-'));
    const fp = path.join(dir, 'sess.tasks.json');
    const events: EventBus = { emit: vi.fn() } as never;
    try {
      await saveTasks(fp, { ...emptyTaskFile('sess'), tasks: [makeTask()] }, events);
      expect(events.emit).toHaveBeenCalledWith('storage.write', expect.objectContaining({
        store: 'tasks',
        operation: 'save',
        outcome: 'success',
        sessionId: '~boot~',
      }));
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('emits storage.error when saveTasks encounters a write failure', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wstack-tasks-'));
    const fp = path.join(dir, 'io-error.tasks.json');
    const events: EventBus = { emit: vi.fn() } as never;
    try {
      fsp.writeFile.mockRejectedValueOnce(
        Object.assign(new Error('ENOSPC no space left'), { code: 'ENOSPC' }),
      );
      await saveTasks(fp, { ...emptyTaskFile('sess'), tasks: [makeTask()] }, events);
      expect(events.emit).toHaveBeenCalledWith('storage.error', expect.objectContaining({
        store: 'tasks',
        operation: 'save',
        outcome: 'failure',
        error: expect.stringContaining('ENOSPC'),
      }));
    } finally {
      fsp.writeFile.mockReset();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });

  it('emits both storage.read and storage.write when mutateTasks succeeds', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wstack-tasks-'));
    const fp = path.join(dir, 'sess.tasks.json');
    const events: EventBus = { emit: vi.fn() } as never;
    try {
      await saveTasks(fp, { ...emptyTaskFile('sess'), tasks: [makeTask({ id: 't1', title: 'before' })] }, events);
      events.emit = vi.fn(); // reset after save's emissions
      await mutateTasks(fp, 'sess', (file) => {
        file.tasks[0]!.title = 'after';
        return file;
      }, events);
      const reads = (events.emit as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([ev]) => ev === 'storage.read',
      );
      const writes = (events.emit as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([ev]) => ev === 'storage.write',
      );
      expect(reads).toHaveLength(1);
      expect(reads[0]![1]).toMatchObject({ store: 'tasks', operation: 'load', outcome: 'success' });
      expect(writes).toHaveLength(1);
      expect(writes[0]![1]).toMatchObject({ store: 'tasks', operation: 'save', outcome: 'success' });
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});
