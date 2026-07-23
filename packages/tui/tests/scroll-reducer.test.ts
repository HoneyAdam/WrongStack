import { describe, expect, it } from 'vitest';
import { reducer } from '../src/app-reducer.js';
import type { State } from '../src/app-state.js';
import { EntryHeightCache } from '../src/height-cache.js';
import {
  anchorAtTopRow,
  anchorForTrackCell,
  anchorTopRow,
  contentRows,
  maxTopRow,
  pageRows,
  planFromAnchor,
  planPinned,
  type ScrollGeometry,
  scrollAnchorBy,
  scrollAnchorToTop,
} from '../src/scroll-anchor.js';

/** Cache of `count` groups with `height` rows each (ids 0..count-1). */
function makeGeometry(
  count: number,
  height: number,
  viewportRows: number,
  tailRows = 0,
): ScrollGeometry {
  const cache = new EntryHeightCache();
  const ids = Array.from({ length: count }, (_, i) => i);
  cache.sync(ids, height);
  return { cache, groupCount: count, viewportRows, tailRows };
}

describe('scroll-anchor pure model', () => {
  it('anchorAtTopRow maps rows onto (index, clip) and clamps to the legal range', () => {
    const g = makeGeometry(10, 5, 20); // 50 rows total, maxTopRow 30
    expect(maxTopRow(g)).toBe(30);
    expect(anchorAtTopRow(g, 0)).toEqual({ index: 0, clip: 0 });
    expect(anchorAtTopRow(g, 7)).toEqual({ index: 1, clip: 2 });
    expect(anchorAtTopRow(g, 29)).toEqual({ index: 5, clip: 4 });
    // At or past the max → pinned.
    expect(anchorAtTopRow(g, 30)).toBeNull();
    expect(anchorAtTopRow(g, 999)).toBeNull();
    expect(anchorAtTopRow(g, -5)).toEqual({ index: 0, clip: 0 });
  });

  it('returns pinned when the content fits in the viewport', () => {
    const g = makeGeometry(3, 5, 20); // 15 rows < 20
    expect(maxTopRow(g)).toBe(0);
    expect(anchorAtTopRow(g, 0)).toBeNull();
    expect(scrollAnchorBy(g, null, 10)).toBeNull();
    expect(scrollAnchorToTop(g)).toBeNull();
  });

  it('scrollAnchorBy walks up from pinned and re-pins at the bottom', () => {
    const g = makeGeometry(10, 5, 20); // maxTopRow 30
    const up3 = scrollAnchorBy(g, null, 3); // topRow 30 → 27
    expect(up3).toEqual({ index: 5, clip: 2 });
    const up30 = scrollAnchorBy(g, up3, 27); // clamps at 0
    expect(up30).toEqual({ index: 0, clip: 0 });
    // Scrolling down past the bottom re-pins.
    expect(scrollAnchorBy(g, up3, -999)).toBeNull();
    expect(scrollAnchorBy(g, up3, -3)).toBeNull(); // exactly back to max
  });

  it('scrollAnchorBy is a no-op-shaped clamp at the top edge', () => {
    const g = makeGeometry(10, 5, 20);
    const top = scrollAnchorToTop(g);
    expect(top).toEqual({ index: 0, clip: 0 });
    expect(scrollAnchorBy(g, top, 10)).toEqual({ index: 0, clip: 0 });
  });

  it('pageRows moves by viewportRows-1 like the old reducer', () => {
    expect(pageRows(25)).toBe(24);
    expect(pageRows(1)).toBe(1);
    expect(pageRows(0)).toBe(1);
  });

  it('the live tail extends the scroll space below the last group', () => {
    const g = makeGeometry(10, 5, 20, 7); // content 57, maxTopRow 37
    expect(contentRows(g)).toBe(57);
    expect(maxTopRow(g)).toBe(37);
    // One row up from pinned: topRow 36 — still inside the last group's band
    // after clamping (the anchor never points into the tail).
    const a = scrollAnchorBy(g, null, 1);
    expect(a).toEqual({ index: 7, clip: 1 });
  });

  it('anchorForTrackCell maps the track linearly: top cell → oldest, last cell → pinned', () => {
    const g = makeGeometry(40, 5, 20); // 200 rows, maxTopRow 180
    expect(anchorForTrackCell(g, 0)).toEqual({ index: 0, clip: 0 });
    expect(anchorForTrackCell(g, 19)).toBeNull(); // bottom cell = pinned
    const mid = anchorForTrackCell(g, 10);
    expect(mid).not.toBeNull();
    const midTop = anchorTopRow(g, mid);
    // Cell 10 of 20 ≈ 53% of maxTopRow.
    expect(Math.abs(midTop - Math.round((10 / 19) * 180))).toBeLessThanOrEqual(1);
  });

  it('anchorTopRow inverts anchorAtTopRow inside the legal range', () => {
    const g = makeGeometry(12, 4, 10);
    for (const row of [0, 1, 5, 17, 30, maxTopRow(g) - 1]) {
      const a = anchorAtTopRow(g, row);
      expect(a).not.toBeNull();
      expect(anchorTopRow(g, a)).toBe(row);
    }
  });

  it('planFromAnchor mounts enough rows to cover clip + viewport + overscan', () => {
    const g = makeGeometry(100, 3, 20);
    const plan = planFromAnchor(g, { index: 10, clip: 2 });
    expect(plan.startIdx).toBe(10);
    // Needs 2 + 20 + 8 = 30 rows → 10 groups of 3, +1 margin.
    const covered =
      g.cache.accumulatedHeight(plan.endIdx) - g.cache.accumulatedHeight(plan.startIdx);
    expect(covered).toBeGreaterThanOrEqual(30);
    expect(plan.endIdx).toBeLessThan(100); // still windowed, not a full mount
    expect(plan.mountTail).toBe(false);
  });

  it('planFromAnchor reaching the end mounts the tail', () => {
    const g = makeGeometry(10, 3, 20, 4);
    const plan = planFromAnchor(g, { index: 8, clip: 0 });
    expect(plan.endIdx).toBe(10);
    expect(plan.mountTail).toBe(true);
  });

  it('planPinned mounts trailing groups covering the viewport plus overscan', () => {
    const g = makeGeometry(100, 3, 20);
    const plan = planPinned(g);
    expect(plan.endIdx).toBe(100);
    expect(plan.mountTail).toBe(true);
    const covered = g.cache.totalHeight() - g.cache.accumulatedHeight(plan.startIdx);
    expect(covered).toBeGreaterThanOrEqual(28); // vp + overscan
    expect(plan.startIdx).toBeGreaterThan(0); // still windowed
  });

  it('planPinned with few groups mounts everything', () => {
    const g = makeGeometry(3, 2, 20);
    const plan = planPinned(g);
    expect(plan).toEqual({ startIdx: 0, endIdx: 3, mountTail: true });
  });

  it('extraRows widens both plans (underfill correction)', () => {
    const g = makeGeometry(100, 3, 20);
    const base = planFromAnchor(g, { index: 10, clip: 0 });
    const wide = planFromAnchor(g, { index: 10, clip: 0 }, 30);
    expect(wide.endIdx).toBeGreaterThan(base.endIdx);
    const basePinned = planPinned(g);
    const widePinned = planPinned(g, 30);
    expect(widePinned.startIdx).toBeLessThan(basePinned.startIdx);
  });

  it('estimate corrections above the anchor cannot move the anchor render', () => {
    // The render depends only on (index, clip): re-recording heights of groups
    // ABOVE the anchor changes prefix sums (scrollbar/thumb math) but the
    // mount plan for the same anchor still starts at the same group with the
    // same clip. This is the invariant that kills estimate-jump bugs.
    const g = makeGeometry(50, 4, 20);
    const anchor = { index: 30, clip: 1 };
    const before = planFromAnchor(g, anchor);
    // A group above the anchor was wildly mis-estimated: correct it.
    g.cache.record(5, 40);
    const after = planFromAnchor(g, anchor);
    expect(after.startIdx).toBe(before.startIdx);
    expect(anchor.clip).toBe(1); // untouched by definition
  });
});

// Minimal state carrying just the fields the remaining scroll-related reducer
// cases touch.
function scrollState(over: Partial<Record<string, unknown>> = {}): State {
  return {
    viewportRows: 0,
    historyScrolled: false,
    entries: [],
    ...over,
  } as unknown as State;
}

describe('TUI scroll reducer (remaining actions)', () => {
  it('setViewportRows stores the rows and keeps identity when unchanged', () => {
    const s = scrollState({ viewportRows: 20 });
    const out = reducer(s, { type: 'setViewportRows', rows: 40 });
    expect(out.viewportRows).toBe(40);
    expect(reducer(out, { type: 'setViewportRows', rows: 40 })).toBe(out);
  });

  it('setHistoryScrolled stores the flag and keeps identity when unchanged', () => {
    const s = scrollState({ historyScrolled: false });
    const out = reducer(s, { type: 'setHistoryScrolled', scrolled: true });
    expect(out.historyScrolled).toBe(true);
    expect(reducer(out, { type: 'setHistoryScrolled', scrolled: true })).toBe(out);
    expect(reducer(out, { type: 'setHistoryScrolled', scrolled: false }).historyScrolled).toBe(
      false,
    );
  });
});
