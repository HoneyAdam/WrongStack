import { describe, expect, it } from 'vitest';
import { reducer } from '../src/app-reducer.js';
import type { State } from '../src/app-state.js';
import { EntryHeightCache } from '../src/height-cache.js';

function scrollState(overrides: Partial<State> = {}): State {
  return {
    totalLines: 120,
    viewportRows: 30,
    scrollOffset: 0,
    pendingNewLines: 0,
    ...overrides,
  } as State;
}

describe('measurement update-loop regression', () => {
  it('returns the existing state for an unchanged content measurement', () => {
    const state = scrollState();
    expect(reducer(state, { type: 'setMeasuredLines', totalLines: 120 })).toBe(state);
  });

  it('returns the existing state for an unchanged viewport measurement', () => {
    const state = scrollState();
    expect(reducer(state, { type: 'setViewportRows', rows: 30 })).toBe(state);
  });

  it('still re-clamps an invalid offset when the measured value is unchanged', () => {
    const state = scrollState({ scrollOffset: 100 });
    const next = reducer(state, { type: 'setMeasuredLines', totalLines: 120 });
    expect(next).not.toBe(state);
    expect(next.scrollOffset).toBe(90);
  });

  it('drops height-cache rows that were evicted from bounded history', () => {
    const cache = new EntryHeightCache();
    cache.record(1, 2);
    cache.record(2, 3);
    cache.record(3, 4);

    cache.retain([2, 3, 4]);

    expect(cache.size).toBe(2);
    expect(cache.getHeight(1)).toBeUndefined();
    expect(cache.accumulatedHeight(1)).toBe(3);
    expect(cache.totalHeight()).toBe(7);
  });
});
