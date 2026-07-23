import { describe, expect, it } from 'vitest';
import { MAX_PASTE_CHARS } from '../src/input-validation.js';
import { feedPaste, type PasteAccumState } from '../src/paste-accumulator.js';

const BEGIN = '\x1b[200~';
const END = '\x1b[201~';

describe('feedPaste', () => {
  it('returns null for ordinary input when idle', () => {
    expect(feedPaste(null, 'hello')).toBeNull();
    expect(feedPaste(null, 'a')).toBeNull();
  });

  it('assembles a single-event bracketed paste in one shot', () => {
    const res = feedPaste(null, `${BEGIN}line1\nline2${END}`);
    expect(res).toEqual({ accum: null, complete: 'line1\nline2' });
  });

  it('buffers a paste split across multiple events and finalizes on the end marker', () => {
    let accum: PasteAccumState = null;
    const r1 = feedPaste(accum, `${BEGIN}first chunk\n`);
    expect(r1).toEqual({ accum: 'first chunk\n', complete: null });
    accum = r1?.accum ?? null;

    const r2 = feedPaste(accum, 'middle chunk\n');
    expect(r2).toEqual({ accum: 'first chunk\nmiddle chunk\n', complete: null });
    accum = r2?.accum ?? null;

    const r3 = feedPaste(accum, `last chunk${END}`);
    expect(r3).toEqual({ accum: null, complete: 'first chunk\nmiddle chunk\nlast chunk' });
  });

  it('handles bare markers when the terminal/Ink dropped the ESC byte', () => {
    const res = feedPaste(null, '[200~pasted text[201~');
    expect(res).toEqual({ accum: null, complete: 'pasted text' });
  });

  it('treats a mid-paste fragment of just a newline as paste content, not Enter', () => {
    const r1 = feedPaste(null, `${BEGIN}a`);
    expect(r1?.complete).toBeNull();
    const r2 = feedPaste(r1?.accum ?? null, '\n');
    expect(r2).toEqual({ accum: 'a\n', complete: null });
    const r3 = feedPaste(r2?.accum ?? null, `b${END}`);
    expect(r3).toEqual({ accum: null, complete: 'a\nb' });
  });

  it('accumulates \\r (Windows CR) mid-paste same as \\n', () => {
    // Windows terminals send \r\n for newlines. Ink may split these into
    // separate events; feedPaste must accumulate \r as ordinary content.
    const r1 = feedPaste(null, `${BEGIN}hello`);
    expect(r1?.complete).toBeNull();
    const r2 = feedPaste(r1?.accum ?? null, '\r');
    expect(r2).toEqual({ accum: 'hello\r', complete: null });
    const r3 = feedPaste(r2?.accum ?? null, `world${END}`);
    expect(r3).toEqual({ accum: null, complete: 'hello\rworld' });
  });

  it('strips begin and end markers even when both arrive in the same later fragment', () => {
    const r1 = feedPaste(null, `${BEGIN}x`);
    const r2 = feedPaste(r1?.accum ?? null, `y${END}`);
    expect(r2).toEqual({ accum: null, complete: 'xy' });
  });

  it('accepts a multi-fragment paste exactly at the hard cap', () => {
    const half = Math.floor(MAX_PASTE_CHARS / 2);
    const first = feedPaste(null, `${BEGIN}${'a'.repeat(half)}`);
    const second = feedPaste(first?.accum ?? null, `${'b'.repeat(MAX_PASTE_CHARS - half)}${END}`);
    expect(second?.complete).toHaveLength(MAX_PASTE_CHARS);
    expect(second?.error).toBeUndefined();
  });

  it('rejects and releases a multi-fragment paste as soon as it exceeds the hard cap', () => {
    const first = feedPaste(null, `${BEGIN}${'a'.repeat(MAX_PASTE_CHARS)}`);
    const second = feedPaste(first?.accum ?? null, `b${END}`);
    expect(second).toEqual({
      accum: null,
      complete: null,
      error: expect.stringContaining('exceeds'),
    });
  });

  it('discards all remaining fragments after overflow until the closing marker', () => {
    const first = feedPaste(null, `${BEGIN}${'a'.repeat(MAX_PASTE_CHARS)}`);
    const overflow = feedPaste(first?.accum ?? null, 'b');
    expect(overflow?.error).toContain('exceeds');
    const swallowed = feedPaste(overflow?.accum ?? null, 'ordinary-looking text');
    expect(swallowed?.complete).toBeNull();
    expect(swallowed?.accum).toEqual({ overflow: true });
    expect(typeof swallowed?.accum).not.toBe('string');
    expect(feedPaste(swallowed?.accum ?? null, END)).toEqual({ accum: null, complete: null });
  });

  // ── ANSI sequence stripping ─────────────────────────────────────────────

  it('strips ANSI SGR reset (ESC[0m) from pasted content', () => {
    // \x1b[0m = SGR reset. The escape sequence adds no visible characters.
    const res = feedPaste(null, `${BEGIN}hello\x1b[0mworld${END}`);
    expect(res?.complete).toBe('helloworld');
  });

  it('strips ANSI SGR codes (color) from pasted content', () => {
    // \x1b[31m = red. \x1b[0m = reset. No visible chars added.
    const res = feedPaste(null, `${BEGIN}\x1b[31mred\x1b[0mblue${END}`);
    expect(res?.complete).toBe('redblue');
  });

  it('strips ANSI cursor-position (H) sequences from pasted content', () => {
    const res = feedPaste(null, `${BEGIN}\x1b[Htop\x1b[Hbottom${END}`);
    expect(res?.complete).toBe('topbottom');
  });

  it('swallows a bare partial ANSI CSI fragment without entering paste mode', () => {
    // A bare "[0m" (ESC was stripped from "\x1b[0m") should not leak into the
    // buffer, but it also must not start paste accumulation — otherwise the
    // next normal keypress would get captured as a fake pasted block.
    expect(feedPaste(null, '[0m')).toEqual({ accum: null, complete: null });
    expect(feedPaste(null, 'a')).toBeNull();
  });
});
