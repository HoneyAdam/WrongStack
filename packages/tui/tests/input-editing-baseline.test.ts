import { describe, expect, it } from 'vitest';
import { nextInputWordStart, previousInputWordStart } from '../src/app.js';

/**
 * Baseline coverage for the input word-navigation helpers.
 *
 * These helpers today treat ONLY ASCII whitespace as a word boundary
 * (`isInputWordSeparator` is `/\s/`). Adım 4 of the TUI input refactor
 * widens the separator set to include punctuation (paths, dots, slashes,
 * dashes, …) so editing paths and identifiers feels natural.
 *
 * The "current behaviour" tests below pin today's narrow semantics and
 * will be UPDATED in Adım 4 to reflect the new, wider word boundaries.
 * They exist so the behaviour change is explicit and tracked, not silent.
 */
describe('previousInputWordStart / nextInputWordStart — current whitespace-only behaviour', () => {
  describe('previousInputWordStart (Ctrl+Left / Ctrl+Backspace target)', () => {
    it('skips trailing whitespace then walks one word back', () => {
      // "alpha  beta" — cursor at end, previous word starts at index 7 ("beta")
      expect(previousInputWordStart('alpha  beta', 12)).toBe(7);
    });

    it('handles tab as a separator', () => {
      // "alpha\tbeta" — cursor at end, previous word starts at index 6 ("beta")
      expect(previousInputWordStart('alpha\tbeta', 11)).toBe(6);
    });

    it('stops at the beginning of the buffer', () => {
      expect(previousInputWordStart('alpha', 2)).toBe(0);
    });

    it('returns 0 when cursor is at the start', () => {
      expect(previousInputWordStart('alpha', 0)).toBe(0);
    });

    it('treats the entire run of non-whitespace as one word (CURRENT — paths are one word)', () => {
      // CURRENT behaviour: punctuation is NOT a separator, so the whole
      // path "src/foo/bar.ts" is a single "word". Adım 4 will change this.
      const path = 'src/foo/bar.ts';
      expect(previousInputWordStart(path, path.length)).toBe(0);
    });

    it('treats an identifier with dots as one word (CURRENT — "a.b.c" is one word)', () => {
      const ident = 'a.b.c';
      expect(previousInputWordStart(ident, ident.length)).toBe(0);
    });

    it('treats a kebab-case token as one word (CURRENT — "foo-bar" is one word)', () => {
      const token = 'foo-bar';
      expect(previousInputWordStart(token, token.length)).toBe(0);
    });

    it('treats a snake_case token as one word (CURRENT — "foo_baz" is one word)', () => {
      const token = 'foo_baz';
      expect(previousInputWordStart(token, token.length)).toBe(0);
    });
  });

  describe('nextInputWordStart (Ctrl+Right target)', () => {
    it('skips the current word then leading whitespace to land on the next word', () => {
      // "alpha  beta" — cursor at 0, next word starts at index 7 ("beta")
      expect(nextInputWordStart('alpha  beta', 0)).toBe(7);
    });

    it('reaches the end when there is no further word', () => {
      expect(nextInputWordStart('alpha', 0)).toBe(5);
    });

    it('returns buffer length when cursor is already at the end', () => {
      expect(nextInputWordStart('alpha', 5)).toBe(5);
    });

    it('treats a path as one word (CURRENT)', () => {
      const path = 'src/foo/bar.ts';
      expect(nextInputWordStart(path, 0)).toBe(path.length);
    });
  });
});

/**
 * Adım 4 target expectations (`.todo` until the separator set widens).
 * These describe the behaviour the refactor MUST deliver; flip them to
 * real `it(...)` checks when the punctuation-aware separator lands.
 */
describe('previousInputWordStart — punctuation-aware target (Adım 4)', () => {
  it.todo('stops at "/" in a path  ("src/foo" -> "foo" is the previous word)');
  it.todo('stops at "." in a dotted identifier ("a.b.c" -> "c" is the previous word)');
  it.todo('treats "_" as a word char ("foo_bar" stays one word)');
  it.todo('treats "-" as a separator ("foo-bar" -> "bar" is the previous word)');
});
