import { describe, it, expect } from 'vitest';
import { DefaultRetryPolicy } from '../../src/defaults/retry-policy.js';
import { ProviderError } from '../../src/types/provider.js';

describe('DefaultRetryPolicy', () => {
  const p = new DefaultRetryPolicy();
  it('429 retries up to 5 attempts', () => {
    const err = new ProviderError('rate limited', 429, true, 'anthropic');
    expect(p.shouldRetry(err, 0)).toBe(true);
    expect(p.shouldRetry(err, 4)).toBe(true);
    expect(p.shouldRetry(err, 5)).toBe(false);
  });
  it('5xx retries up to 3', () => {
    const err = new ProviderError('server', 503, true, 'x');
    expect(p.shouldRetry(err, 0)).toBe(true);
    expect(p.shouldRetry(err, 2)).toBe(true);
    expect(p.shouldRetry(err, 3)).toBe(false);
  });
  it('4xx does not retry', () => {
    const err = new ProviderError('auth', 401, false, 'x');
    expect(p.shouldRetry(err, 0)).toBe(false);
  });
  it('network errors retry up to 2', () => {
    const err = new Error('ECONNRESET');
    expect(p.shouldRetry(err, 0)).toBe(true);
    expect(p.shouldRetry(err, 2)).toBe(false);
  });
  it('delayMs respects 30s cap with jitter', () => {
    for (let i = 0; i < 10; i++) {
      const d = p.delayMs(10);
      expect(d).toBeLessThanOrEqual(30_000);
    }
  });
});
