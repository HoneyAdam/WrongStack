import { describe, expect, it } from 'vitest';
import { scrollOffsetForTrackRow, scrollbarThumb } from '../src/components/scrollable-history.js';

describe('scrollbarThumb', () => {
  it('is a full, non-scrollable track when content fits the viewport', () => {
    expect(scrollbarThumb(20, 0, 20)).toEqual({ top: 0, size: 20, scrollable: false });
    expect(scrollbarThumb(20, 0, 10)).toEqual({ top: 0, size: 20, scrollable: false });
  });

  it('pins the thumb to the bottom when scrolled to the newest (offset 0)', () => {
    const { top, size, scrollable } = scrollbarThumb(10, 0, 100);
    expect(scrollable).toBe(true);
    expect(top + size).toBe(10); // bottom-aligned
  });

  it('moves the thumb to the top when scrolled to the oldest (offset = max)', () => {
    // maxOffset = total - rows = 90.
    const { top } = scrollbarThumb(10, 90, 100);
    expect(top).toBe(0);
  });

  it('sizes the thumb proportional to the visible fraction', () => {
    // viewport is 1/4 of content → thumb ≈ 1/4 of the track.
    const { size } = scrollbarThumb(20, 0, 80);
    expect(size).toBe(5);
  });

  it('keeps the thumb within the track for every offset', () => {
    const rows = 12;
    const total = 200;
    for (let offset = 0; offset <= total - rows; offset++) {
      const { top, size } = scrollbarThumb(rows, offset, total);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(top + size).toBeLessThanOrEqual(rows);
      expect(size).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('scrollOffsetForTrackRow (scrollbar click/drag → offset)', () => {
  it('returns 0 when content is not scrollable', () => {
    expect(scrollOffsetForTrackRow(20, 20, 5)).toBe(0);
    expect(scrollOffsetForTrackRow(20, 10, 0)).toBe(0);
  });

  it('maps the top cell to the oldest content (max offset) and bottom to newest (0)', () => {
    const rows = 10;
    const total = 100; // maxOffset 90
    expect(scrollOffsetForTrackRow(rows, total, 0)).toBe(90);
    expect(scrollOffsetForTrackRow(rows, total, rows - 1)).toBe(0);
  });

  it('clamps out-of-range cells into the track', () => {
    const rows = 10;
    const total = 100;
    expect(scrollOffsetForTrackRow(rows, total, -3)).toBe(90); // above top → oldest
    expect(scrollOffsetForTrackRow(rows, total, 999)).toBe(0); // below bottom → newest
  });

  it('round-trips with scrollbarThumb within a one-cell tolerance', () => {
    const rows = 12;
    const total = 200;
    for (let offset = 0; offset <= total - rows; offset += 7) {
      const { top } = scrollbarThumb(rows, offset, total);
      const recovered = scrollOffsetForTrackRow(rows, total, top);
      // Quantizing offset → thumb-cell → offset stays close (rounding only).
      expect(Math.abs(recovered - offset)).toBeLessThanOrEqual(total / rows + 1);
    }
  });
});
