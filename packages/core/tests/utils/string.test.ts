import { describe, expect, it } from 'vitest';
import { truncate } from '../../src/utils/string.js';

describe('truncate', () => {
  // truncate is the canonical "string → capped string with ellipsis
  // when too long" helper used in CLI status lines, log headers, and
  // agent-context previews. The contract is intentionally minimal:
  // - input.length <= max → return as-is (no suffix, no padding)
  // - input.length >  max → return s.slice(0, max - 1) + '…'
  // The 1-char-buffer for the ellipsis is the load-bearing detail
  // callers rely on (e.g. CLI column-width clipping); pin it.

  it('returns the string unchanged when it fits under max', () => {
    expect(truncate('hi', 10)).toBe('hi');
    expect(truncate('hi', 2)).toBe('hi');
  });

  it('truncates and appends the ellipsis when input exceeds max', () => {
    // 5-char input capped at 3 → 2-char prefix + '…' = 'he…'
    expect(truncate('hello', 3)).toBe('he…');
  });

  it('preserves exactly max characters in the output', () => {
    // The output is always exactly max chars (when truncation fires).
    // This is the contract that lets callers do fixed-width column
    // layout: total width is bounded by max.
    const out = truncate('a-very-long-string-that-exceeds-the-cap', 10);
    expect(out.length).toBe(10);
    expect(out.endsWith('…')).toBe(true);
  });

  it('uses a Unicode horizontal ellipsis, not three dots', () => {
    // U+2026 (HORIZONTAL ELLIPSIS) — one character, not three periods.
    // The 1-char buffer math (max - 1) only works with the 1-codepoint
    // ellipsis. A refactor to '...' would silently produce 11-char
    // output for max=10, breaking column alignment. Pin it.
    const out = truncate('hello world', 5);
    expect(out).toBe('hell…');
    expect(out.charCodeAt(4)).toBe(0x2026);
  });

  it('handles a max of 0 by returning the input minus its last char + ellipsis', () => {
    // max=0: 'hi'.slice(0, -1) is 'h' (slice with negative end strips the
    // last char), so the function returns 'h' + '…' = 'h…'. The function
    // does not throw on max=0. The behavior is degenerate but stable;
    // pin it so any future change is deliberate.
    expect(truncate('hi', 0)).toBe('h…');
  });
});
