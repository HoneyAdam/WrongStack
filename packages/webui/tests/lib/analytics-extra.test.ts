/**
 * Additional tests for src/lib/analytics.ts — flush, referral, and timer functions.
 * These tests need to mock fetch, sessionStorage, and globals.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushAnalytics,
  startAnalyticsFlush,
  clearAnalyticsQueue,
  getAnalyticsQueue,
  trackEvent,
  recordReferralClick,
  getReferralClick,
  clearReferralClick,
  trackReferralConversion,
} from '../../src/lib/analytics';

beforeEach(() => {
  clearAnalyticsQueue();
});

describe('flushAnalytics', () => {
  beforeEach(() => {
    // Mock fetch globally
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is a no-op when the queue is empty', async () => {
    await flushAnalytics();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('is a no-op when already flushing', async () => {
    // Fill queue and start a flush
    trackEvent('e1', 'cat');
    // First call starts flushing
    const p1 = flushAnalytics();
    // Second call while already flushing should return early
    await flushAnalytics();
    // fetch should only have been called once
    await p1;
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('sends queued events to the backend and clears them on success', async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ accepted: 1, rejected: 0 }),
    });

    trackEvent('test_event', 'test_cat', { label: 'test' });
    expect(getAnalyticsQueue()).toHaveLength(1);

    await flushAnalytics();

    expect(globalThis.fetch).toHaveBeenCalledWith('/api/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: expect.any(String),
    });
    // Queue should be empty after successful flush
    expect(getAnalyticsQueue()).toHaveLength(0);
  });

  it('re-queues events when the server responds with non-ok', async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ accepted: 0, rejected: 0 }),
    });

    trackEvent('e1', 'cat');
    await flushAnalytics();

    // Events should be re-queued
    expect(getAnalyticsQueue()).toHaveLength(1);
  });

  it('re-queues events on network failure', async () => {
    (globalThis.fetch as any).mockRejectedValue(new Error('Network error'));

    trackEvent('e1', 'cat');
    await flushAnalytics();

    // Events should be re-queued
    expect(getAnalyticsQueue()).toHaveLength(1);
  });

  it('caps re-queued events at MAX_QUEUE_SIZE', async () => {
    (globalThis.fetch as any).mockRejectedValue(new Error('Network error'));

    // Fill queue close to max
    for (let i = 0; i < 99; i++) {
      trackEvent(`e${i}`, 'cat');
    }
    await flushAnalytics();

    // After re-queue, should still be capped
    const q = getAnalyticsQueue();
    expect(q.length).toBeLessThanOrEqual(100);
  });
});

describe('startAnalyticsFlush', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts an interval timer that flushes (idempotent)', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => ({ accepted: 0, rejected: 0 }) });

    // Calling twice should be idempotent (only one interval)
    startAnalyticsFlush();
    startAnalyticsFlush();

    trackEvent('e1', 'cat');

    // Advance past the flush interval
    await vi.advanceTimersByTimeAsync(31_000);
    // The interval callback runs and flushes once
    expect(globalThis.fetch).toHaveBeenCalled();

    vi.useRealTimers();
  });
});

describe('referral tracking', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  describe('recordReferralClick', () => {
    it('stores the referral click data in sessionStorage', () => {
      recordReferralClick({
        providerId: 'test-provider',
        providerName: 'Test Provider',
        referralCode: 'ABC123',
        clickedAt: '2026-01-01T00:00:00.000Z',
        docsUrl: 'https://example.com/docs',
      });

      const stored = sessionStorage.getItem('wrongstack_referral_click');
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!);
      expect(parsed.providerId).toBe('test-provider');
    });

    it('also calls trackEvent', () => {
      // After recording, the queue should contain the analytics event
      recordReferralClick({
        providerId: 'p1',
        providerName: 'P1',
        referralCode: 'R1',
        clickedAt: new Date().toISOString(),
        docsUrl: 'https://example.com',
      });

      const queue = getAnalyticsQueue();
      expect(queue).toHaveLength(1);
      expect(queue[0]?.event).toBe('referral_link_clicked');
    });

    it('handles sessionStorage errors gracefully', () => {
      // Mock sessionStorage.setItem to throw
      const origSet = sessionStorage.setItem.bind(sessionStorage);
      vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
        throw new Error('sessionStorage unavailable');
      });

      expect(() => {
        recordReferralClick({
          providerId: 'p1',
          providerName: 'P1',
          referralCode: 'R1',
          clickedAt: new Date().toISOString(),
          docsUrl: 'https://example.com',
        });
      }).not.toThrow();

      vi.restoreAllMocks();
    });

    it('records referral click event even when sessionStorage fails', () => {
      vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
        throw new Error('sessionStorage unavailable');
      });

      recordReferralClick({
        providerId: 'p1',
        providerName: 'P1',
        referralCode: 'R1',
        clickedAt: new Date().toISOString(),
        docsUrl: 'https://example.com',
      });

      // The analytics event should still be tracked
      const queue = getAnalyticsQueue();
      expect(queue).toHaveLength(1);
      expect(queue[0]?.event).toBe('referral_link_clicked');

      vi.restoreAllMocks();
    });
  });

  describe('getReferralClick', () => {
    it('returns null when no referral click is stored', () => {
      expect(getReferralClick()).toBeNull();
    });

    it('returns the stored referral click data', () => {
      const data = {
        providerId: 'test',
        providerName: 'Test',
        referralCode: 'ABC',
        clickedAt: '2026-01-01T00:00:00.000Z',
        docsUrl: 'https://example.com',
      };
      sessionStorage.setItem('wrongstack_referral_click', JSON.stringify(data));
      expect(getReferralClick()).toEqual(data);
    });

    it('returns null when JSON.parse fails', () => {
      sessionStorage.setItem('wrongstack_referral_click', 'not-json');
      expect(getReferralClick()).toBeNull();
    });

    it('returns null when sessionStorage.getItem throws', () => {
      vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => {
        throw new Error('sessionStorage unavailable');
      });
      expect(getReferralClick()).toBeNull();
      vi.restoreAllMocks();
    });
  });

  describe('clearReferralClick', () => {
    it('removes the stored referral click', () => {
      sessionStorage.setItem('wrongstack_referral_click', JSON.stringify({ providerId: 'x' }));
      clearReferralClick();
      expect(sessionStorage.getItem('wrongstack_referral_click')).toBeNull();
    });

    it('does not throw when sessionStorage.removeItem throws', () => {
      vi.spyOn(sessionStorage, 'removeItem').mockImplementation(() => {
        throw new Error('sessionStorage unavailable');
      });
      expect(() => clearReferralClick()).not.toThrow();
      vi.restoreAllMocks();
    });
  });

  describe('trackReferralConversion', () => {
    it('tracks conversion when providerId matches', () => {
      sessionStorage.setItem(
        'wrongstack_referral_click',
        JSON.stringify({
          providerId: 'p1',
          providerName: 'P1',
          referralCode: 'R1',
          clickedAt: new Date(Date.now() - 60_000).toISOString(),
          docsUrl: 'https://example.com',
        }),
      );

      trackReferralConversion('p1', 'P1');

      const queue = getAnalyticsQueue();
      expect(queue).toHaveLength(1);
      expect(queue[0]?.event).toBe('referral_converted');
      expect(queue[0]?.category).toBe('conversion');
    });

    it('does not track conversion when providerId does not match', () => {
      sessionStorage.setItem(
        'wrongstack_referral_click',
        JSON.stringify({
          providerId: 'p1',
          providerName: 'P1',
          referralCode: 'R1',
          clickedAt: new Date().toISOString(),
          docsUrl: 'https://example.com',
        }),
      );

      trackReferralConversion('p2', 'P2');
      expect(getAnalyticsQueue()).toHaveLength(0);
    });

    it('does not track conversion when no referral click is stored', () => {
      trackReferralConversion('p1', 'P1');
      expect(getAnalyticsQueue()).toHaveLength(0);
    });

    it('clears the referral click after tracking conversion', () => {
      sessionStorage.setItem(
        'wrongstack_referral_click',
        JSON.stringify({
          providerId: 'p1',
          providerName: 'P1',
          referralCode: 'R1',
          clickedAt: new Date().toISOString(),
          docsUrl: 'https://example.com',
        }),
      );

      trackReferralConversion('p1', 'P1');
      expect(sessionStorage.getItem('wrongstack_referral_click')).toBeNull();
    });
  });
});
