/**
 * Tests for the background indexing coordinator (debounce + mutex).
 *
 * `runIndexer` itself is mocked here — its real behavior is covered by
 * codebase-index.test.ts. These tests only assert background-indexer's own
 * responsibilities: coalescing rapid edits, dropping non-indexable files, and
 * serializing concurrent runs onto a single mutex.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the indexer module BEFORE importing the unit under test. The mock is
// declared via vi.hoisted so it's initialized before the hoisted vi.mock factory.
const { runIndexerMock } = vi.hoisted(() => ({ runIndexerMock: vi.fn() }));
vi.mock('../src/codebase-index/indexer.js', () => ({
  runIndexer: runIndexerMock,
}));

const OK_RESULT = { filesIndexed: 1, symbolsIndexed: 0, langStats: {}, durationMs: 0, errors: [] };

import {
  cancelPendingReindexes,
  enqueueReindex,
  isIndexableFile,
  runStartupIndex,
} from '../src/codebase-index/background-indexer.js';

beforeEach(() => {
  runIndexerMock.mockReset();
  runIndexerMock.mockResolvedValue(OK_RESULT);
});

afterEach(() => {
  cancelPendingReindexes();
  vi.useRealTimers();
});

describe('isIndexableFile', () => {
  it('accepts known source extensions', () => {
    for (const f of ['a.ts', 'b.tsx', 'c.js', 'd.jsx', 'e.go', 'f.py', 'g.rs']) {
      expect(isIndexableFile(`/proj/${f}`)).toBe(true);
    }
  });

  it('rejects non-source files', () => {
    for (const f of ['README.md', 'notes.txt', 'image.png', 'Makefile']) {
      expect(isIndexableFile(`/proj/${f}`)).toBe(false);
    }
  });
});

describe('enqueueReindex (debounce)', () => {
  it('coalesces rapid edits to the same file into one reindex', async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 3; i++) {
      enqueueReindex({ projectRoot: '/proj', files: ['/proj/a.ts'], debounceMs: 20 });
    }
    await vi.advanceTimersByTimeAsync(30);
    expect(runIndexerMock).toHaveBeenCalledTimes(1);
    expect(runIndexerMock.mock.calls[0]?.[1]).toMatchObject({ files: ['/proj/a.ts'] });
  });

  it('reindexes distinct files separately', async () => {
    vi.useFakeTimers();
    enqueueReindex({ projectRoot: '/proj', files: ['/proj/a.ts'], debounceMs: 20 });
    enqueueReindex({ projectRoot: '/proj', files: ['/proj/b.ts'], debounceMs: 20 });
    await vi.advanceTimersByTimeAsync(30);
    expect(runIndexerMock).toHaveBeenCalledTimes(2);
  });

  it('drops non-indexable files before scheduling', async () => {
    vi.useFakeTimers();
    enqueueReindex({ projectRoot: '/proj', files: ['/proj/README.md'], debounceMs: 20 });
    await vi.advanceTimersByTimeAsync(30);
    expect(runIndexerMock).not.toHaveBeenCalled();
  });

  it('routes reindex failures to onError, never throwing', async () => {
    vi.useFakeTimers();
    runIndexerMock.mockRejectedValueOnce(new Error('boom'));
    const onError = vi.fn();
    enqueueReindex({ projectRoot: '/proj', files: ['/proj/a.ts'], debounceMs: 10, onError });
    await vi.advanceTimersByTimeAsync(20);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('mutex serialization', () => {
  it('never runs two indexer passes concurrently', async () => {
    let active = 0;
    let maxActive = 0;
    runIndexerMock.mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return { filesIndexed: 1, symbolsIndexed: 0, langStats: {}, durationMs: 0, errors: [] };
    });

    await Promise.all([
      runStartupIndex({ projectRoot: '/proj' }),
      runStartupIndex({ projectRoot: '/proj' }),
      runStartupIndex({ projectRoot: '/proj' }),
    ]);

    expect(runIndexerMock).toHaveBeenCalledTimes(3);
    expect(maxActive).toBe(1);
  });

  it('a failing job does not wedge the mutex chain', async () => {
    runIndexerMock.mockRejectedValueOnce(new Error('first fails'));
    await expect(runStartupIndex({ projectRoot: '/proj' })).rejects.toThrow('first fails');
    // The next run still proceeds.
    await expect(runStartupIndex({ projectRoot: '/proj' })).resolves.toMatchObject({
      filesIndexed: 1,
    });
  });
});
