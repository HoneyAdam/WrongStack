import { describe, expect, it } from 'vitest';
import {
  deleteWordBackward,
  deleteWordForward,
  nextInputWordStart,
  previousInputWordStart,
} from '../src/input-editing.js';

/**
 * Coverage for the input word-navigation and word-deletion helpers in
 * input-editing.ts.
 *
 * Word-boundary policy (Adım 4 of the TUI input refactor): separators are
 * whitespace plus most ASCII punctuation, EXCEPT the underscore, which is
 * kept as a word character so snake_case identifiers stay one word.
 *
 *   - Paths (`src/foo/bar.ts`) break at `/` and `.`
 *   - Kebab-case (`foo-bar`) breaks at `-`
 *   - Snake_case (`foo_baz`) stays ONE word
 *   - Dotted identifiers (`a.b.c`) break at `.`
 */
describe('previousInputWordStart (Ctrl+Left / Ctrl+Backspace / Ctrl+W target)', () => {
  it('skips trailing whitespace then walks one word back', () => {
    expect(previousInputWordStart('alpha  beta', 12)).toBe(7);
  });

  it('handles tab as a separator', () => {
    expect(previousInputWordStart('alpha\tbeta', 11)).toBe(6);
  });

  it('stops at the beginning of the buffer', () => {
    expect(previousInputWordStart('alpha', 2)).toBe(0);
  });

  it('returns 0 when cursor is at the start', () => {
    expect(previousInputWordStart('alpha', 0)).toBe(0);
  });

  it('breaks at "." inside a path tail ("src/foo/bar.ts" -> "ts" is the previous word)', () => {
    // cursor at end: walk back over "ts" (a word), then "." is a separator,
    // so the previous word starts at index 12 ("ts").
    expect(previousInputWordStart('src/foo/bar.ts', 14)).toBe(12);
  });

  it('walks back to "bar" when cursor sits just after it', () => {
    const path = 'src/foo/bar.ts';
    // cursor at index 11 (just after "bar"): previous word is "bar" at 8.
    expect(previousInputWordStart(path, 11)).toBe(8);
  });

  it('breaks at "/" between path segments', () => {
    // "src/foo" — cursor at end (7), previous word is "foo" at index 4.
    expect(previousInputWordStart('src/foo', 7)).toBe(4);
  });

  it('breaks at "." in a dotted identifier ("a.b.c" -> "c" is the previous word)', () => {
    expect(previousInputWordStart('a.b.c', 5)).toBe(4);
  });

  it('breaks at "-" in kebab-case ("foo-bar" -> "bar" is the previous word)', () => {
    expect(previousInputWordStart('foo-bar', 7)).toBe(4);
  });

  it('treats "_" as a word char: snake_case stays one word ("foo_baz")', () => {
    expect(previousInputWordStart('foo_baz', 7)).toBe(0);
  });

  it('collapses a run of mixed separators', () => {
    // "foo  -  bar" — cursor at end (11), previous word is "bar" at index 8
    // (b=8, a=9, r=10). The "  -  " run collapses during the walk back.
    expect(previousInputWordStart('foo  -  bar', 11)).toBe(8);
  });
});

describe('nextInputWordStart (Ctrl+Right target)', () => {
  it('skips the current word then leading whitespace to land on the next word', () => {
    expect(nextInputWordStart('alpha  beta', 0)).toBe(7);
  });

  it('reaches the end when there is no further word', () => {
    expect(nextInputWordStart('alpha', 0)).toBe(5);
  });

  it('returns buffer length when cursor is already at the end', () => {
    expect(nextInputWordStart('alpha', 5)).toBe(5);
  });

  it('breaks at "/" in a path (next word is the next segment)', () => {
    // "src/foo/bar.ts" — cursor at 0, next word is "foo" at index 4.
    expect(nextInputWordStart('src/foo/bar.ts', 0)).toBe(4);
  });

  it('breaks at "." in a dotted identifier', () => {
    // "a.b.c" — cursor at 0, next word is "b" at index 2.
    expect(nextInputWordStart('a.b.c', 0)).toBe(2);
  });

  it('treats snake_case as one word ("foo_baz")', () => {
    expect(nextInputWordStart('foo_baz', 0)).toBe(7);
  });
});

describe('deleteWordBackward (Ctrl+Backspace / Ctrl+W)', () => {
  it('deletes the trailing word and lands the cursor at the new end', () => {
    expect(deleteWordBackward('hello world', 11)).toEqual({ buffer: 'hello ', cursor: 6 });
  });

  it('returns null when the cursor is at the start', () => {
    expect(deleteWordBackward('hello', 0)).toBeNull();
  });

  it('deletes one path segment at a "/" boundary', () => {
    // "src/foo/" — delete "foo/" or just "foo"? The previous-word walk
    // from index 8 lands at 4 ("foo"), and the separators between are
    // included in the deletion, so the result is "src/".
    expect(deleteWordBackward('src/foo/', 8)).toEqual({ buffer: 'src/', cursor: 4 });
  });

  it('deletes a whole snake_case token as one word', () => {
    expect(deleteWordBackward('foo_bar_baz', 11)).toEqual({ buffer: '', cursor: 0 });
  });

  it('deletes only the last segment of a dotted identifier', () => {
    // "a.b.c" — delete "c" -> "a.b."
    expect(deleteWordBackward('a.b.c', 5)).toEqual({ buffer: 'a.b.', cursor: 4 });
  });

  it('is identical for the same input (Ctrl+Backspace and Ctrl+W share it)', () => {
    // This is the contract: any number of call sites can use deleteWordBackward
    // and they all behave the same way.
    const buf = 'the quick brown fox';
    expect(deleteWordBackward(buf, buf.length)).toEqual({ buffer: 'the quick brown ', cursor: 16 });
  });
});

describe('deleteWordForward (Ctrl+Delete)', () => {
  it('deletes the next word AND the trailing separator', () => {
    // "hello world" — cursor at 0: next word walk lands on "world" at 6,
    // so the deletion range is [0,6) -> "world" (the "hello " prefix is
    // removed, cursor stays at 0).
    expect(deleteWordForward('hello world', 0)).toEqual({ buffer: 'world', cursor: 0 });
  });

  it('returns null when the cursor is at the end', () => {
    expect(deleteWordForward('hello', 5)).toBeNull();
  });

  it('deletes one path segment plus its trailing slash', () => {
    // "src/foo/bar" — cursor at 0: next word walk lands on "foo" at index 4,
    // so the deletion range is [0,4) and the leading "src/" (with slash)
    // is removed. Cursor stays at 0; the result starts on "foo".
    expect(deleteWordForward('src/foo/bar', 0)).toEqual({ buffer: 'foo/bar', cursor: 0 });
  });

  it('deletes a whole snake_case token forward', () => {
    expect(deleteWordForward('foo_bar_baz', 0)).toEqual({ buffer: '', cursor: 0 });
  });
});

/**
 * Chip-awareness: attachment tokens (`[pasted #N]`, `[file:path]`,
 * `[image #N]`) must be treated as a single atomic word. Covered more
 * thoroughly in input-tokens.test.ts; these are smoke checks that the
 * word-edit helpers still see chips via tokenSpanAt.
 */
describe('chip-aware word editing', () => {
  const chip = '[file:src/app.tsx]';

  it('deleteWordBackward removes the whole chip when it ends at the cursor', () => {
    const buf = `prefix ${chip}`;
    expect(deleteWordBackward(buf, buf.length)).toEqual({ buffer: 'prefix ', cursor: 7 });
  });

  it('previousInputWordStart jumps to the chip start', () => {
    const buf = `prefix ${chip}`;
    expect(previousInputWordStart(buf, buf.length)).toBe(7);
  });
});
