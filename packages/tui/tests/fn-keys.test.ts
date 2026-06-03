import { describe, expect, it } from 'vitest';
import { fnKey } from '../src/fn-keys.js';

describe('fnKey', () => {
  it('decodes the SS3 form for F1–F4', () => {
    expect(fnKey('\x1bOP')).toBe(1);
    expect(fnKey('\x1bOQ')).toBe(2);
    expect(fnKey('\x1bOR')).toBe(3);
    expect(fnKey('\x1bOS')).toBe(4);
  });

  it('decodes the CSI ~ form for F1–F12', () => {
    const cases: Array<[string, number]> = [
      ['\x1b[11~', 1],
      ['\x1b[12~', 2],
      ['\x1b[13~', 3],
      ['\x1b[14~', 4],
      ['\x1b[15~', 5],
      ['\x1b[17~', 6],
      ['\x1b[18~', 7],
      ['\x1b[19~', 8],
      ['\x1b[20~', 9],
      ['\x1b[21~', 10],
      ['\x1b[23~', 11],
      ['\x1b[24~', 12],
    ];
    for (const [seq, n] of cases) expect(fnKey(seq)).toBe(n);
  });

  it('maps the monitor aliases F2/F3/F4', () => {
    // F2 → fleet, F3 → agents, F4 → worktree (see app.tsx handleKey).
    expect(fnKey('\x1bOQ')).toBe(2);
    expect(fnKey('\x1bOR')).toBe(3);
    expect(fnKey('\x1bOS')).toBe(4);
  });

  it('returns null for non-F-key input', () => {
    expect(fnKey('a')).toBeNull();
    expect(fnKey('\x1b[A')).toBeNull(); // up arrow
    expect(fnKey('\x1b[H')).toBeNull(); // home
    expect(fnKey('\x1b[1;2Q')).toBeNull(); // Shift+F2 (modifier form, ignored)
    expect(fnKey('')).toBeNull();
  });
});
