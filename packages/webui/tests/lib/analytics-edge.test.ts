/**
 * Edge-case tests for src/lib/analytics.ts — re-queue overflow cap, __DEV__ logging.
 *
 * These tests mock globals (fetch, __DEV__) and use dynamic imports so stubs
 * take effect before the module's functions are first called.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('flushAnalytics — large re-queue overflow cap (line 51)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('caps re-queued events at MAX_QUEUE_SIZE when fetch fails after >100 overflow', async () => {
    // Use a deferred promise so we can control when the flush resolves
    let fetchResolve!: (v: unknown) => void;
    const fetchPromise = new Promise((resolve) => { fetchResolve = resolve; });
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(fetchPromise));

    // Import fresh so the module sees our fetch mock
    const { trackEvent, getAnalyticsQueue, clearAnalyticsQueue } =
      await import('../../src/lib/analytics');
    clearAnalyticsQueue();

    // Queue 5 events — the 5th triggers an auto-flush (isFlushing=true, events spliced)
    for (let i = 0; i < 5; i++) trackEvent(`e${i}`, 'cat');
    // Now isFlushing=true, queue was emptied by splice

    // Queue 101 events while the flush is pending — one more than MAX_QUEUE_SIZE
    // so the cap check (line 23) fires and shift() on line 24 is hit
    for (let i = 5; i < 106; i++) trackEvent(`e${i}`, 'cat');
    // At i=105 the queue length would be 101 > 100, so shift() drops the oldest
    expect(getAnalyticsQueue()).toHaveLength(100);

    // Resolve the in-flight fetch with a failure — this triggers unshift+cap (line 51)
    fetchResolve({ ok: false, json: () => Promise.resolve({}) });
    // Wait for the async flush to complete (microtasks)
    await vi.waitUntil(() => getAnalyticsQueue().length <= 100);
    expect(getAnalyticsQueue()).toHaveLength(100);
  });
});

describe('analytics — __DEV__ console logging (lines 57-58, 103)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    // Make __DEV__ truthy AND mock fetch for the flush test
    vi.stubGlobal('__DEV__', true);
    vi.stubGlobal('console', { ...console, log: vi.fn() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('logs to console in DEV mode when flush succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ accepted: 2, rejected: 0 }),
    }));

    const { trackEvent, flushAnalytics } = await import('../../src/lib/analytics');
    trackEvent('e1', 'cat');
    trackEvent('e2', 'cat');
    await flushAnalytics();

    expect(console.log).toHaveBeenCalledWith(
      '[Analytics] Flushed',
      2,
      'events, rejected',
      0,
    );
  });

  it('logs to console in DEV mode when trackEvent is called', async () => {
    const { trackEvent } = await import('../../src/lib/analytics');

    trackEvent('dev_event', 'test_cat', { label: 'test' });

    expect(console.log).toHaveBeenCalledWith(
      '[Analytics]',
      expect.objectContaining({ event: 'dev_event', category: 'test_cat' }),
    );
  });
});

describe('startAnalyticsFlush — no-op when queue is empty on timer tick', () => {
  it('does not call fetch when interval fires with empty queue', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    const { startAnalyticsFlush } = await import('../../src/lib/analytics');
    startAnalyticsFlush();

    // Advance past the flush interval with empty queue
    await vi.advanceTimersByTimeAsync(31_000);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
