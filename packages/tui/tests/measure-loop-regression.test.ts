import { describe, expect, it } from 'vitest';
import { reducer } from '../src/app-reducer.js';
import type { State } from '../src/app-state.js';
import { EntryHeightCache } from '../src/height-cache.js';

function scrollState(overrides: Partial<State> = {}): State {
  return {
    viewportRows: 30,
    historyScrolled: false,
    entries: [],
    ...overrides,
  } as State;
}

// Historic context (issue #276): the old architecture reported measured totals
// through a `setMeasuredLines` dispatch from a layout effect, and an unchanged
// measurement HAD to be a state-identity no-op or the layout-effect → dispatch
// → re-render cycle threw React error #185 (Maximum update depth exceeded).
// The anchor-based viewport keeps all measurement state inside the component,
// so that dispatch loop no longer exists structurally. What remains dispatch-
// driven (viewport rows from app.tsx's bottom-region measurement, and the
// scrolled flag from onScrollInfo) must still be identity no-ops when
// unchanged — these pin that contract.
describe('measurement update-loop regression', () => {
  it('returns the existing state for an unchanged viewport measurement', () => {
    const state = scrollState();
    expect(reducer(state, { type: 'setViewportRows', rows: 30 })).toBe(state);
  });

  it('returns the existing state for an unchanged scrolled flag', () => {
    const state = scrollState({ historyScrolled: true });
    expect(reducer(state, { type: 'setHistoryScrolled', scrolled: true })).toBe(state);
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
