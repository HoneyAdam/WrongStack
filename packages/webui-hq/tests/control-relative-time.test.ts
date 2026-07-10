import { describe, expect, it } from 'vitest';
import { relativeTime } from '../src/views/control.js';

const NOW = new Date('2026-07-10T12:00:00.000Z').getTime();

describe('relativeTime', () => {
  it('renders seconds for the first minute', () => {
    expect(relativeTime('2026-07-10T11:59:48.000Z', NOW)).toBe('12s ago');
    expect(relativeTime('2026-07-10T12:00:00.000Z', NOW)).toBe('0s ago');
  });

  it('renders minutes under an hour', () => {
    expect(relativeTime('2026-07-10T11:57:00.000Z', NOW)).toBe('3m ago');
    expect(relativeTime('2026-07-10T11:01:00.000Z', NOW)).toBe('59m ago');
  });

  it('falls back to clock time past an hour', () => {
    const out = relativeTime('2026-07-10T09:00:00.000Z', NOW);
    expect(out.endsWith('ago')).toBe(false);
    expect(out.length).toBeGreaterThan(0);
  });

  it('clamps future timestamps to "now" instead of negative ages', () => {
    expect(relativeTime('2026-07-10T12:00:05.000Z', NOW)).toBe('0s ago');
  });

  it('passes malformed timestamps through untouched', () => {
    expect(relativeTime('not-a-date', NOW)).toBe('not-a-date');
  });
});
