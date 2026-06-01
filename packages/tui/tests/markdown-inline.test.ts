import { describe, expect, it } from 'vitest';
import { type InlineToken, parseInline } from '../src/markdown.js';

const plainText = (tokens: InlineToken[]) => tokens.map((t) => t.text).join('');

describe('parseInline', () => {
  it('bolds **text** and strips the markers', () => {
    const t = parseInline('a **bold** b');
    expect(t).toEqual([
      { text: 'a ' },
      { text: 'bold', bold: true },
      { text: ' b' },
    ]);
  });

  it('italicizes *text* (single asterisk)', () => {
    const t = parseInline('an *emphasis* here');
    expect(t.find((x) => x.italic)?.text).toBe('emphasis');
  });

  it('renders `inline code`', () => {
    const t = parseInline('use `npm test` now');
    expect(t.find((x) => x.code)?.text).toBe('npm test');
  });

  it('handles ~~strikethrough~~', () => {
    const t = parseInline('~~gone~~');
    expect(t).toEqual([{ text: 'gone', strike: true }]);
  });

  it('does NOT treat underscores as italics (snake_case stays intact)', () => {
    const t = parseInline('call read_file_sync(x)');
    expect(plainText(t)).toBe('call read_file_sync(x)');
    expect(t.every((x) => !x.italic)).toBe(true);
  });

  it('treats ** before * correctly (bold wins over italic)', () => {
    const t = parseInline('**strong**');
    expect(t).toEqual([{ text: 'strong', bold: true }]);
  });

  it('emits an unterminated marker literally (never loses text)', () => {
    expect(plainText(parseInline('a **bold without close'))).toBe('a **bold without close');
    expect(plainText(parseInline('trailing `code'))).toBe('trailing `code');
    expect(plainText(parseInline('lone * star'))).toBe('lone * star');
  });

  it('does not parse inside inline code', () => {
    const t = parseInline('`a **b** c`');
    expect(t).toEqual([{ text: 'a **b** c', code: true }]);
  });

  it('handles multiple emphasis spans on one line', () => {
    const t = parseInline('**x** and *y* and `z`');
    expect(t.filter((x) => x.bold)).toHaveLength(1);
    expect(t.filter((x) => x.italic)).toHaveLength(1);
    expect(t.filter((x) => x.code)).toHaveLength(1);
  });

  it('returns empty for empty input', () => {
    expect(parseInline('')).toEqual([]);
  });
});
