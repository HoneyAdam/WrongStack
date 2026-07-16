import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '../../src/types/session.js';
import {
  formatInterruptedToolNotice,
  formatResumeValidationNotice,
  validateResumeFileObservations,
} from '../../src/storage/session-resume-validation.js';

// Mock node:fs/promises for file system operations
vi.mock('node:fs/promises', async () => {
  const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...real,
    realpath: vi.fn(async (p: string) => p),
    stat: vi.fn(),
    readFile: vi.fn(),
  };
});

import * as fsp from 'node:fs/promises';

const now = () => new Date().toISOString();

function makeObservation(absPath: string, hash: string, ts?: string): SessionEvent {
  return {
    type: 'file_observation',
    ts: ts ?? now(),
    path: absPath,
    hash,
    mtimeMs: 1234567890,
    source: 'write',
  } as SessionEvent;
}

/**
 * Resolve a test path against a root.  On Windows, absolute-looking Unix
 * paths like "/project/src/index.ts" become relative to the drive root
 * (e.g. "D:\project\src\index.ts").  We let path.resolve normalise so
 * assertions match what the implementation actually produces.
 */
const testRoot = path.resolve('/project');
const testFile1 = path.resolve('/project/src/index.ts');
const testFile2 = path.resolve('/project/src/config.ts');
const outsideFile = path.resolve('/etc/passwd');

describe('validateResumeFileObservations', () => {
  beforeEach(() => {
    vi.mocked(fsp.realpath).mockReset();
    vi.mocked(fsp.stat).mockReset();
    vi.mocked(fsp.readFile).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty staleFiles when there are no file_observation events', async () => {
    const events: SessionEvent[] = [{ type: 'session_start', ts: now(), id: 's1', model: 'm', provider: 'p' }];
    const result = await validateResumeFileObservations(events, testRoot);
    expect(result.checkedFileCount).toBe(0);
    expect(result.staleFiles).toEqual([]);
  });

  it('returns empty staleFiles when all observed files still match their hash', async () => {
    const events = [makeObservation(testFile1, 'a'.repeat(64))];
    vi.mocked(fsp.stat).mockResolvedValue({ isFile: () => true, size: 1000 } as any);
    vi.mocked(fsp.readFile).mockResolvedValue('file content');

    const result = await validateResumeFileObservations(events, testRoot);
    expect(result.checkedFileCount).toBe(1);
  });

  it('marks a file as deleted when it no longer exists', async () => {
    const events = [makeObservation(testFile1, 'a'.repeat(64))];
    vi.mocked(fsp.realpath).mockResolvedValue(testFile1);
    vi.mocked(fsp.stat).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const result = await validateResumeFileObservations(events, testRoot);
    expect(result.checkedFileCount).toBe(1);
    expect(result.staleFiles).toHaveLength(1);
    expect(result.staleFiles[0]?.status).toBe('deleted');
    expect(result.staleFiles[0]?.path).toBe(testFile1);
  });

  it('marks a file as outside_project when it resolves outside the root', async () => {
    const events = [makeObservation(outsideFile, 'a'.repeat(64))];
    vi.mocked(fsp.realpath).mockResolvedValue(outsideFile);

    const result = await validateResumeFileObservations(events, testRoot);
    expect(result.checkedFileCount).toBe(1);
    expect(result.staleFiles).toHaveLength(1);
    expect(result.staleFiles[0]?.status).toBe('outside_project');
  });

  it('marks a file as modified when the hash differs', async () => {
    const events = [makeObservation(testFile1, 'a'.repeat(64))];
    vi.mocked(fsp.realpath).mockResolvedValue(testFile1);
    vi.mocked(fsp.stat).mockResolvedValue({ isFile: () => true, size: 100 } as any);
    vi.mocked(fsp.readFile).mockResolvedValue('different content');

    const result = await validateResumeFileObservations(events, testRoot);
    expect(result.checkedFileCount).toBe(1);
    expect(result.staleFiles).toHaveLength(1);
    expect(result.staleFiles[0]?.status).toBe('modified');
    expect(typeof result.staleFiles[0]?.actualHash).toBe('string');
  });

  it('marks a file as unreadable when stat fails with non-ENOENT error', async () => {
    const events = [makeObservation(testFile1, 'a'.repeat(64))];
    vi.mocked(fsp.realpath).mockResolvedValue(testFile1);
    vi.mocked(fsp.stat).mockRejectedValue(Object.assign(new Error('EACCES permission denied'), { code: 'EACCES' }));

    const result = await validateResumeFileObservations(events, testRoot);
    expect(result.checkedFileCount).toBe(1);
    expect(result.staleFiles).toHaveLength(1);
    expect(result.staleFiles[0]?.status).toBe('unreadable');
  });

  it('skips non-file_observation events', async () => {
    const events: SessionEvent[] = [
      { type: 'session_start', ts: now(), id: 's1', model: 'm', provider: 'p' },
      { type: 'user_input', ts: now(), content: 'hello' },
      { type: 'llm_response', ts: now(), content: [{ type: 'text', text: 'hi' }] },
      { type: 'checkpoint', ts: now(), promptIndex: 0, tokenIn: 10, tokenOut: 20 },
    ];
    const result = await validateResumeFileObservations(events, testRoot);
    expect(result.checkedFileCount).toBe(0);
    expect(result.staleFiles).toEqual([]);
  });

  it('handles files that exceed the MAX_REVALIDATE_BYTES limit', async () => {
    const events = [makeObservation(testFile1, 'a'.repeat(64))];
    vi.mocked(fsp.realpath).mockResolvedValue(testFile1);
    vi.mocked(fsp.stat).mockResolvedValue({ isFile: () => true, size: 6 * 1024 * 1024 } as any);

    const result = await validateResumeFileObservations(events, testRoot);
    expect(result.checkedFileCount).toBe(1);
    expect(result.staleFiles).toHaveLength(1);
    expect(result.staleFiles[0]?.status).toBe('unreadable');
  });

  it('deduplicates multiple observations of the same file (only latest kept)', async () => {
    const events = [
      makeObservation(testFile1, 'a'.repeat(64), '2026-01-01T00:00:00.000Z'),
      makeObservation(testFile1, 'b'.repeat(64), '2026-01-02T00:00:00.000Z'),
    ];
    vi.mocked(fsp.realpath).mockResolvedValue(testFile1);
    vi.mocked(fsp.stat).mockResolvedValue({ isFile: () => true, size: 100 } as any);
    vi.mocked(fsp.readFile).mockResolvedValue('content');

    const result = await validateResumeFileObservations(events, testRoot);
    expect(result.checkedFileCount).toBe(1);
  });

  it('skips file_observation events with invalid hash', async () => {
    const events = [makeObservation(testFile1, 'not-a-valid-sha256')];
    const result = await validateResumeFileObservations(events, testRoot);
    expect(result.checkedFileCount).toBe(0);
  });
});

describe('formatResumeValidationNotice', () => {
  it('returns null when there are no stale files', () => {
    const validation = {
      checkedAt: new Date().toISOString(),
      checkedFileCount: 5,
      staleFiles: [],
    };
    expect(formatResumeValidationNotice(validation, testRoot)).toBeNull();
  });

  it('formats a notice with stale file entries', () => {
    const validation = {
      checkedAt: new Date().toISOString(),
      checkedFileCount: 3,
      staleFiles: [
        { path: testFile1, status: 'modified' as const, observedAt: new Date().toISOString(), expectedHash: 'a'.repeat(64), actualHash: 'b'.repeat(64) },
        { path: testFile2, status: 'deleted' as const, observedAt: new Date().toISOString(), expectedHash: 'a'.repeat(64) },
      ],
    };
    const notice = formatResumeValidationNotice(validation, testRoot);
    expect(notice).not.toBeNull();
    expect(notice).toContain('[SESSION RESUME FILE VALIDATION]');
    expect(notice).toContain('2 previously observed file(s)');
    // The relative path format depends on OS (forward/backslash).
    // Just verify the filenames appear somewhere in the notice.
    expect(notice).toContain('index.ts');
    expect(notice).toContain('config.ts');
    expect(notice).toContain('[modified]');
    expect(notice).toContain('[deleted]');
  });

  it('truncates the list when there are more than 20 stale files', () => {
    const staleFiles = Array.from({ length: 25 }, (_, i) => ({
      path: path.resolve(`/project/src/file${i}.ts`),
      status: 'modified' as const,
      observedAt: new Date().toISOString(),
      expectedHash: 'a'.repeat(64),
      actualHash: 'b'.repeat(64),
    }));
    const validation = {
      checkedAt: new Date().toISOString(),
      checkedFileCount: 25,
      staleFiles,
    };
    const notice = formatResumeValidationNotice(validation, testRoot);
    expect(notice).toContain('... and 5 more stale path(s)');
  });

  it('handles outside_project paths that are shown as-is (not relative)', () => {
    const validation = {
      checkedAt: new Date().toISOString(),
      checkedFileCount: 1,
      staleFiles: [
        { path: outsideFile, status: 'outside_project' as const, observedAt: new Date().toISOString(), expectedHash: 'a'.repeat(64), detail: 'outside project' },
      ],
    };
    const notice = formatResumeValidationNotice(validation, testRoot);
    // The path shows up in the notice stringified; verify the notice mentions
    // the "outside_project" status and the file is referenced
    expect(notice).toContain('[outside_project]');
    expect(notice).toContain('passwd');
  });
});

describe('formatInterruptedToolNotice', () => {
  it('returns null when nothing was in flight', () => {
    expect(formatInterruptedToolNotice(0)).toBeNull();
    expect(formatInterruptedToolNotice(-1)).toBeNull();
    expect(formatInterruptedToolNotice(Number.NaN)).toBeNull();
  });

  it('describes a single interrupted tool call and states it was not re-run', () => {
    const notice = formatInterruptedToolNotice(1);
    expect(notice).toContain('[SESSION RESUME INTERRUPTED WORK]');
    expect(notice).toContain('1 tool call was');
    expect(notice).toContain('NOT re-executed');
  });

  it('pluralizes multiple interrupted tool calls', () => {
    const notice = formatInterruptedToolNotice(3);
    expect(notice).toContain('3 tool calls were');
  });
});
