import { afterEach, describe, expect, it } from 'vitest';
import {
  getPerfProfile,
  indexParallelBatchSize,
  isFrugalPerf,
  sqliteCachePragmas,
  superMemoryCachePragmas,
  tuiStreamFlushMs,
} from '../../src/utils/perf-profile.js';

const ENV_KEYS = ['WRONGSTACK_PERF_PROFILE', 'WSTACK_PERF_PROFILE'] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('perf-profile', () => {
  it('defaults to balanced', () => {
    expect(getPerfProfile()).toBe('balanced');
    expect(isFrugalPerf()).toBe(false);
  });

  it('accepts frugal aliases', () => {
    process.env.WRONGSTACK_PERF_PROFILE = 'frugal';
    expect(getPerfProfile()).toBe('frugal');
    process.env.WRONGSTACK_PERF_PROFILE = 'cimri';
    expect(getPerfProfile()).toBe('frugal');
    process.env.WRONGSTACK_PERF_PROFILE = 'eco';
    expect(isFrugalPerf()).toBe(true);
  });

  it('uses WSTACK_PERF_PROFILE alias', () => {
    process.env.WSTACK_PERF_PROFILE = 'frugal';
    expect(getPerfProfile()).toBe('frugal');
  });

  it('caps parallel batch under frugal', () => {
    process.env.WRONGSTACK_PERF_PROFILE = 'frugal';
    expect(indexParallelBatchSize(32)).toBe(4);
    expect(indexParallelBatchSize(2)).toBe(2);
    expect(indexParallelBatchSize(1)).toBe(1);
  });

  it('keeps historical balanced batch formula', () => {
    process.env.WRONGSTACK_PERF_PROFILE = 'balanced';
    expect(indexParallelBatchSize(8)).toBe(32);
    expect(indexParallelBatchSize(16)).toBe(40); // hard cap
  });

  it('uses leaner SQLite caches under frugal', () => {
    process.env.WRONGSTACK_PERF_PROFILE = 'frugal';
    const index = sqliteCachePragmas();
    const mem = superMemoryCachePragmas();
    expect(index.cacheSizeKiB).toBeLessThan(32_768);
    expect(mem.cacheSizeKiB).toBeLessThan(index.cacheSizeKiB);
    expect(index.mmapBytes).toBeLessThan(128 * 1024 * 1024);
  });

  it('slows TUI stream flush under frugal (fewer paints)', () => {
    process.env.WRONGSTACK_PERF_PROFILE = 'balanced';
    const balanced = tuiStreamFlushMs();
    process.env.WRONGSTACK_PERF_PROFILE = 'frugal';
    const frugal = tuiStreamFlushMs();
    expect(frugal).toBeGreaterThan(balanced);
  });
});
