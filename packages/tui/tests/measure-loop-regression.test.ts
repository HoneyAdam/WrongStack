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
    measuredEntryCount: undefined,
    entries: [],
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

  // Regression for issue #276: the App.onMeasure callback (app.tsx) guards a
  // dispatch with `if (totalLines === stateRef.current.totalLines) return;`
  // before calling reducer. This mirrors the viewport-rows sibling guard and
  // breaks the layout-effect → dispatch → re-render cycle that threw React
  // error #185 (Maximum update depth exceeded) on Windows when a large layout
  // re-measured to the same height across consecutive commits. This test pins
  // the reducer-side half of that contract the callback relies on: an
  // unchanged total MUST return state identity so the dispatch is a true no-op
  // even when the offset is already validly clamped (not just at offset 0).
  it('issue #276: unchanged measurement with a valid offset is a full no-op', () => {
    const state = scrollState({ scrollOffset: 30 }); // 30 < maxOffset 90, so valid
    expect(reducer(state, { type: 'setMeasuredLines', totalLines: 120 })).toBe(state);
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
