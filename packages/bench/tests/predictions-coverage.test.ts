import { describe, expect, it } from 'vitest';
import { parseResolvedIds } from '../src/report/predictions.js';

describe('parseResolvedIds — edge cases', () => {
  it('handles non-object entries in the per-instance map', () => {
    // v is null → falsy → skip
    // v is a string → not an object → skip
    const ids = parseResolvedIds({
      'django__django-1': { resolved: true },
      'django__django-2': null,
      'django__django-3': 'not-an-object',
      'django__django-4': { resolved: false },
      'django__django-5': { resolved: true },
    });
    expect(ids.has('django__django-1')).toBe(true);
    expect(ids.has('django__django-5')).toBe(true);
    expect(ids.size).toBe(2);
  });

  it('handles entries with missing resolved field', () => {
    const ids = parseResolvedIds({
      a: { resolved: true },
      b: { something: 'else' },
      c: { resolved: 'not-boolean' },
    });
    expect(ids.has('a')).toBe(true);
    expect(ids.size).toBe(1);
  });

  it('handles empty resolved_ids array', () => {
    const ids = parseResolvedIds({ resolved_ids: [] });
    expect(ids.size).toBe(0);
  });

  it('handles resolved_ids with non-string entries', () => {
    const ids = parseResolvedIds({ resolved_ids: ['a', 42, 'b', null] });
    expect([...ids].sort()).toEqual(['a', 'b']);
  });
});
