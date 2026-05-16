import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DirectorStateCheckpoint,
  loadDirectorState,
} from '../../src/storage/director-state.js';

describe('director-state checkpoint', () => {
  it('records spawns and writes to disk', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wstack-dstate-'));
    const file = path.join(dir, 'director-state.json');
    try {
      const cp = new DirectorStateCheckpoint(
        file,
        { directorRunId: 'run-1', spawnDepth: 0, maxSpawnDepth: 2 },
        10, // tight debounce for tests
      );
      cp.recordSpawn(
        {
          id: 'sub-1',
          name: 'checker',
          role: 'bug-hunter',
          spawnedAt: new Date().toISOString(),
        },
        1,
      );
      await cp.flush();
      const loaded = await loadDirectorState(file);
      expect(loaded?.directorRunId).toBe('run-1');
      expect(loaded?.subagents).toHaveLength(1);
      expect(loaded?.subagents[0]?.id).toBe('sub-1');
      expect(loaded?.spawnCount).toBe(1);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('updates task status incrementally', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wstack-dstate-'));
    const file = path.join(dir, 'director-state.json');
    try {
      const cp = new DirectorStateCheckpoint(
        file,
        { directorRunId: 'run-2', spawnDepth: 0, maxSpawnDepth: 2 },
        10,
      );
      cp.recordTaskAssigned({
        taskId: 't-1',
        subagentId: 'sub-1',
        description: 'do thing',
        status: 'running',
      });
      cp.recordTaskStatus('t-1', {
        status: 'completed',
        completedAt: new Date().toISOString(),
        iterations: 3,
      });
      await cp.flush();
      const loaded = await loadDirectorState(file);
      expect(loaded?.tasks).toHaveLength(1);
      expect(loaded?.tasks[0]?.status).toBe('completed');
      expect(loaded?.tasks[0]?.iterations).toBe(3);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('returns null on corrupt files', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wstack-dstate-'));
    const file = path.join(dir, 'bad.json');
    try {
      await fs.writeFile(file, '{not valid json');
      expect(await loadDirectorState(file)).toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
