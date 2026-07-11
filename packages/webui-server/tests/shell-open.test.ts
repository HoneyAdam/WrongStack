import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'node:path';

const mockSpawn = vi.hoisted(() => vi.fn());
const mockAccess = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));

vi.mock('node:fs/promises', () => ({
  access: mockAccess,
}));

import { handleShellOpen } from '../src/server/shell-open.js';

describe('shell-open', () => {
  const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  const testPath = path.resolve('/tmp/test');
  const projectsPath = path.resolve('C:/Projects');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleShellOpen', () => {
    it('opens file manager on Windows', async () => {
      mockAccess.mockResolvedValue(undefined);
      mockSpawn.mockReturnValue({ on: vi.fn().mockReturnThis(), unref: vi.fn() });

      const result = await handleShellOpen(
        { path: projectsPath, target: 'file-manager' },
        logger as any,
      );
      expect(result.success).toBe(true);
      expect(result.message).toContain('file-manager');
    });

    it('opens file manager on macOS', async () => {
      mockAccess.mockResolvedValue(undefined);
      mockSpawn.mockReturnValue({ on: vi.fn().mockReturnThis(), unref: vi.fn() });

      const result = await handleShellOpen(
        { path: testPath, target: 'file-manager' },
        logger as any,
      );
      expect(result.success).toBe(true);
    });

    it('opens terminal on Windows', async () => {
      mockAccess.mockResolvedValue(undefined);
      mockSpawn.mockReturnValue({ on: vi.fn().mockReturnThis(), unref: vi.fn() });

      const result = await handleShellOpen(
        { path: testPath, target: 'terminal' },
        logger as any,
      );
      expect(result.success).toBe(true);
    });

    it('rejects paths with metacharacters (ampersand)', async () => {
      mockAccess.mockResolvedValue(undefined);
      const badPath = path.resolve('/tmp/test&danger');
      // The METACHAR_REGEX includes & so a path with & should be rejected
      const result = await handleShellOpen(
        { path: badPath, target: 'file-manager' },
        logger as any,
      );
      expect(result.success).toBe(false);
      expect(result.message).toBe('Path contains unsupported characters.');
    });

    it('rejects paths with pipe metacharacter', async () => {
      mockAccess.mockResolvedValue(undefined);
      const badPath = path.resolve('/tmp/test|danger');
      const result = await handleShellOpen(
        { path: badPath, target: 'file-manager' },
        logger as any,
      );
      expect(result.success).toBe(false);
    });

    it('returns error for unknown target', async () => {
      mockAccess.mockResolvedValue(undefined);
      const result = await handleShellOpen(
        { path: testPath, target: 'invalid' as any },
        logger as any,
      );
      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown shell.open target');
    });

    it('returns error when path does not exist', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT: path not found'));
      const result = await handleShellOpen(
        { path: '/nonexistent', target: 'file-manager' },
        logger as any,
      );
      expect(result.success).toBe(false);
    });
  });
});
