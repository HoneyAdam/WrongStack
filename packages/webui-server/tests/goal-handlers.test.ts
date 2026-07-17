import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReadFile = vi.hoisted(() => vi.fn());

const mockResolveWstackPaths = vi.hoisted(() => vi.fn());
vi.mock('@wrongstack/core/utils', () => ({
  resolveWstackPaths: mockResolveWstackPaths,
}));

// Mock node:fs/promises - the source uses dynamic import() for this
vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
}));

import { handleGoalGet } from '../src/server/goal-handlers.js';

describe('goal-handlers', () => {
  beforeEach(() => {
    mockResolveWstackPaths.mockReset();
    mockReadFile.mockReset();
  });

  describe('handleGoalGet', () => {
    it('broadcasts parsed goal when file exists and is valid JSON', async () => {
      const goalData = { objective: 'Test goal', tasks: [] };
      mockResolveWstackPaths.mockReturnValue({
        projectGoal: '/tmp/.wrongstack/projects/test/goal.json',
      });
      mockReadFile.mockResolvedValue(JSON.stringify(goalData));

      const broadcast = vi.fn();
      await handleGoalGet('/tmp/project', broadcast);

      expect(broadcast).toHaveBeenCalledWith({
        type: 'goal-state.updated',
        payload: goalData,
      });
    });

    it('broadcasts null when file read fails', async () => {
      mockResolveWstackPaths.mockReturnValue({
        projectGoal: '/tmp/.wrongstack/projects/test/goal.json',
      });
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      const broadcast = vi.fn();
      await handleGoalGet('/tmp/project', broadcast);

      expect(broadcast).toHaveBeenCalledWith({
        type: 'goal-state.updated',
        payload: null,
      });
    });

    it('broadcasts null when JSON is invalid', async () => {
      mockResolveWstackPaths.mockReturnValue({
        projectGoal: '/tmp/.wrongstack/projects/test/goal.json',
      });
      mockReadFile.mockResolvedValue('not valid json');

      const broadcast = vi.fn();
      await handleGoalGet('/tmp/project', broadcast);

      expect(broadcast).toHaveBeenCalledWith({
        type: 'goal-state.updated',
        payload: null,
      });
    });
  });
});
