import { describe, expect, it } from 'vitest';
import { isSqliteAvailable } from '../src/sqlite-store.js';

describe('isSqliteAvailable', () => {
  it('returns a boolean', () => {
    const result = isSqliteAvailable();
    expect(typeof result).toBe('boolean');
  });

  it('does not throw', () => {
    expect(() => isSqliteAvailable()).not.toThrow();
  });

  it('returns a consistent result across multiple calls', () => {
    const first = isSqliteAvailable();
    const second = isSqliteAvailable();
    const third = isSqliteAvailable();
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('returns true on this runtime (Node >= 22.5 with node:sqlite)', () => {
    // This test environment runs Node 24.x which ships node:sqlite.
    // If this ever fails, the test runner's Node version changed.
    expect(isSqliteAvailable()).toBe(true);
  });
});
