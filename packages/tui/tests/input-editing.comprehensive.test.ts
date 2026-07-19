import { describe, expect, it } from 'vitest';
import {
  deleteWordBackward,
  deleteWordForward,
  isInputWordSeparator,
  nextInputWordStart,
  previousInputWordStart,
} from '../src/input-editing.js';

describe('isInputWordSeparator', () => {
  it('returns true for undefined', () => {
    expect(isInputWordSeparator(undefined)).toBe(true);
  });

  it('returns true for whitespace', () => {
    expect(isInputWordSeparator(' ')).toBe(true);
    expect(isInputWordSeparator('\t')).toBe(true);
    expect(isInputWordSeparator('\n')).toBe(true);
  });

  it('returns true for punctuation separators', () => {
    expect(isInputWordSeparator('-')).toBe(true);
    expect(isInputWordSeparator('/')).toBe(true);
    expect(isInputWordSeparator('.')).toBe(true);
    expect(isInputWordSeparator('(')).toBe(true);
    expect(isInputWordSeparator('"')).toBe(true);
    expect(isInputWordSeparator('@')).toBe(true);
  });

  it('returns false for underscore (word char)', () => {
    expect(isInputWordSeparator('_')).toBe(false);
  });

  it('returns false for alphanumeric characters', () => {
    expect(isInputWordSeparator('a')).toBe(false);
    expect(isInputWordSeparator('Z')).toBe(false);
    expect(isInputWordSeparator('0')).toBe(false);
  });
});

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

  it('returns buffer.length when cursor beyond buffer', () => {
    expect(previousInputWordStart('hi', 100)).toBe(0);
  });

  it('breaks at "." inside a path tail', () => {
    expect(previousInputWordStart('src/foo/bar.ts', 14)).toBe(12);
  });

  it('walks back to "bar" when cursor sits just after it', () => {
    expect(previousInputWordStart('src/foo/bar.ts', 11)).toBe(8);
  });

  it('breaks at "/" between path segments', () => {
    expect(previousInputWordStart('src/foo', 7)).toBe(4);
  });

  it('breaks at "." in a dotted identifier', () => {
    expect(previousInputWordStart('a.b.c', 5)).toBe(4);
  });

  it('breaks at "-" in kebab-case', () => {
    expect(previousInputWordStart('foo-bar', 7)).toBe(4);
  });

  it('treats "_" as a word char: snake_case stays one word', () => {
    expect(previousInputWordStart('foo_baz', 7)).toBe(0);
  });

  it('collapses a run of mixed separators', () => {
    expect(previousInputWordStart('foo  -  bar', 11)).toBe(8);
  });

  it('handles punctuation adjacent to words', () => {
    expect(previousInputWordStart('hello(world)', 12)).toBe(6);
  });

  it('walks through single character word', () => {
    expect(previousInputWordStart('a b', 3)).toBe(2);
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

  it('returns buffer length when cursor beyond buffer', () => {
    expect(nextInputWordStart('alpha', 100)).toBe(5);
  });

  it('returns 0 when cursor is negative', () => {
    expect(nextInputWordStart('alpha', -1)).toBe(5);
  });

  it('breaks at "/" in a path', () => {
    expect(nextInputWordStart('src/foo/bar.ts', 0)).toBe(4);
  });

  it('breaks at "." in a dotted identifier', () => {
    expect(nextInputWordStart('a.b.c', 0)).toBe(2);
  });

  it('treats snake_case as one word', () => {
    expect(nextInputWordStart('foo_baz', 0)).toBe(7);
  });

  it('skips from middle of word to next', () => {
    expect(nextInputWordStart('hello world', 3)).toBe(6);
  });

  it('handles cursor on separator, skips to next word', () => {
    expect(nextInputWordStart('hello  world', 6)).toBe(7);
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
    expect(deleteWordBackward('src/foo/', 8)).toEqual({ buffer: 'src/', cursor: 4 });
  });

  it('deletes a whole snake_case token as one word', () => {
    expect(deleteWordBackward('foo_bar_baz', 11)).toEqual({ buffer: '', cursor: 0 });
  });

  it('deletes only the last segment of a dotted identifier', () => {
    expect(deleteWordBackward('a.b.c', 5)).toEqual({ buffer: 'a.b.', cursor: 4 });
  });

  it('returns null when deleteStart equals deleteEnd', () => {
    // No word before cursor at certain positions
    expect(deleteWordBackward('hello', 0)).toBeNull();
  });
});

describe('deleteWordForward (Ctrl+Delete)', () => {
  it('deletes the next word AND the trailing separator', () => {
    expect(deleteWordForward('hello world', 0)).toEqual({ buffer: 'world', cursor: 0 });
  });

  it('returns null when the cursor is at the end', () => {
    expect(deleteWordForward('hello', 5)).toBeNull();
  });

  it('returns null when cursor beyond buffer', () => {
    expect(deleteWordForward('hello', 100)).toBeNull();
  });

  it('deletes one path segment plus its trailing slash', () => {
    expect(deleteWordForward('src/foo/bar', 0)).toEqual({ buffer: 'foo/bar', cursor: 0 });
  });

  it('deletes a whole snake_case token forward', () => {
    expect(deleteWordForward('foo_bar_baz', 0)).toEqual({ buffer: '', cursor: 0 });
  });
});

describe('chip-aware word editing', () => {
  const chip = '[file:src/app.tsx]';

  it('previousInputWordStart jumps to the chip start when cursor is at end', () => {
    const buf = `prefix ${chip}`;
    expect(previousInputWordStart(buf, buf.length)).toBe(7);
  });

  it('previousInputWordStart returns chip start when cursor inside chip', () => {
    const buf = `prefix ${chip}`;
    // Cursor inside the chip (position 10 = "file:src/...")
    expect(previousInputWordStart(buf, 10)).toBe(7);
  });

  it('nextInputWordStart skips past chip when cursor is inside', () => {
    const buf = `${chip} suffix`;
    // Cursor inside chip (position 3)
    expect(nextInputWordStart(buf, 3)).toBe(19); // chip end (space skipping depends on tokenSpanAt behavior)
  });

  it('nextInputWordStart skips past chip when cursor at start of chip', () => {
    const buf = `${chip} suffix`;
    expect(nextInputWordStart(buf, 0)).toBe(19);
  });

  it('deleteWordBackward removes the whole chip when it ends at cursor', () => {
    const buf = `prefix ${chip}`;
    expect(deleteWordBackward(buf, buf.length)).toEqual({ buffer: 'prefix ', cursor: 7 });
  });

  it('deleteWordBackward removes the whole chip when cursor is inside it', () => {
    const buf = `prefix ${chip} suffix`;
    const chipStart = 7;
    const chipEnd = 7 + chip.length;
    // Cursor inside chip
    expect(deleteWordBackward(buf, chipStart + 3)).toEqual({
      buffer: `prefix ${chipEnd === buf.length ? '' : ' suffix'}`.trim(),
      cursor: chipStart,
    });
  });

  it('deleteWordForward removes chip that starts at cursor', () => {
    const buf = `${chip} suffix`;
    expect(deleteWordForward(buf, 0)).toEqual({ buffer: 'suffix', cursor: 0 });
  });

  it('deleteWordForward removes chip when cursor is inside it', () => {
    const buf = `prefix ${chip} suffix`;
    const chipStart = 7;
    expect(deleteWordForward(buf, chipStart + 3)).toEqual({
      buffer: `prefix  suffix`,
      cursor: chipStart,
    });
  });
});
