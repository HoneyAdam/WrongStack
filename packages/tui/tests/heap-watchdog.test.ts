import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHeapWatchdog, takeHeapSample } from '../src/heap-watchdog.js';

describe('takeHeapSample', () => {
  it('returns a coherent sample with a positive heap limit', () => {
    const s = takeHeapSample();
    expect(s.heapUsed).toBeGreaterThan(0);
    expect(s.heapLimit).toBeGreaterThan(s.heapUsed);
    expect(s.load).toBeGreaterThan(0);
    expect(s.load).toBeLessThan(1);
    expect(() => new Date(s.ts).toISOString()).not.toThrow();
  });
});

describe('startHeapWatchdog', () => {
  let dir: string;
  let logPath: string;

  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'heap-watchdog-'));
    logPath = path.join(dir, 'heap.jsonl');
  });

  afterEach(async () => {
    vi.useRealTimers();
    // The watchdog's append chain may still have an in-flight write —
    // let it settle, then rm with retries (Windows ENOTEMPTY race).
    await new Promise((r) => setTimeout(r, 50));
    await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it('writes an immediate first diagnostic line including collectStats extras', async () => {
    const stop = startHeapWatchdog({
      logPath,
      sampleEveryMs: 60_000,
      collectStats: () => ({ historyEntries: 7 }),
    });
    stop();
    // The append chain is async — poll briefly for the file.
    let raw = '';
    for (let i = 0; i < 50; i++) {
      try {
        raw = await fsp.readFile(logPath, 'utf8');
        if (raw) break;
      } catch {
        /* not yet */
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    const line = JSON.parse(raw.trim().split('\n')[0]!) as Record<string, unknown>;
    expect(line['pid']).toBe(process.pid);
    expect(line['heapUsed']).toBeGreaterThan(0);
    expect(line['historyEntries']).toBe(7);
  });

  it('fires warn then critical once per crossing', () => {
    vi.useFakeTimers();
    const calls: Array<{ level: string }> = [];
    // warnAt/criticalAt = 0 → every sample is above both thresholds; the
    // armed flags must still make each fire exactly once.
    const stop = startHeapWatchdog({
      logPath,
      sampleEveryMs: 1_000,
      warnAt: 0,
      criticalAt: 0,
      onWarn: (level) => calls.push({ level }),
    });
    vi.advanceTimersByTime(5_000);
    stop();
    expect(calls).toEqual([{ level: 'critical' }]);
  });

  it('fires warn (not critical) between the two thresholds', () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const stop = startHeapWatchdog({
      logPath,
      sampleEveryMs: 1_000,
      warnAt: 0, // always above warn
      criticalAt: 1.01, // never above critical
      onWarn: (level) => calls.push(level),
    });
    vi.advanceTimersByTime(5_000);
    stop();
    expect(calls).toEqual(['warn']);
  });

  it('a throwing collectStats does not break sampling', () => {
    vi.useFakeTimers();
    const stop = startHeapWatchdog({
      logPath,
      sampleEveryMs: 1_000,
      collectStats: () => {
        throw new Error('boom');
      },
    });
    expect(() => vi.advanceTimersByTime(3_000)).not.toThrow();
    stop();
  });
});
