import { describe, expect, it } from 'vitest';
import { scrollbarThumb } from '../src/components/scrollable-history.js';

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
