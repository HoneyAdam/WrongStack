import { describe, expect, it } from 'vitest';
import { detectNewlineStyle, normalizeToLf, toStyle } from '../../src/utils/newline-normalize.js';

describe('detectNewlineStyle', () => {
  // detectNewlineStyle is the canonical "what newline style does this
  // text use" detector. The contract is "majority vote with CRLF/CR
  // edge cases" — used by editor integrations and shell-output
  // normalization. Ties fall through to 'lf' (the modern default).

  it("detects 'lf' when there are no newlines", () => {
    expect(detectNewlineStyle('')).toBe('lf');
  });

  it("detects 'lf' for LF-only text", () => {
    expect(detectNewlineStyle('a\nb\nc\n')).toBe('lf');
  });

  it("detects 'crlf' for CRLF-only text", () => {
    expect(detectNewlineStyle('a\r\nb\r\nc\r\n')).toBe('crlf');
  });

  it("detects 'cr' for CR-only text (legacy Mac classic)", () => {
    // The old Mac OS (pre-OSX) used CR as a line separator. This
    // is rare today but the function explicitly supports it.
    expect(detectNewlineStyle('a\rb\rc\r')).toBe('cr');
  });

  it('returns the majority style when styles are mixed', () => {
    // 2 LF vs 1 CRLF → LF wins.
    expect(detectNewlineStyle('a\nb\nc\r\n')).toBe('lf');
    // 2 CRLF vs 1 LF → CRLF wins.
    expect(detectNewlineStyle('a\r\nb\r\nc\n')).toBe('crlf');
    // 2 CR vs 1 LF → CR wins.
    expect(detectNewlineStyle('a\rb\rc\n')).toBe('cr');
  });

  it("falls through to 'lf' on ties", () => {
    // 1 LF vs 1 CRLF vs 1 CR → tie → 'lf' (the modern default).
    expect(detectNewlineStyle('a\nb\r\nc\r')).toBe('lf');
    // 1 LF vs 1 CRLF → tie → 'lf'.
    expect(detectNewlineStyle('a\nb\r\n')).toBe('lf');
  });
});

describe('toStyle', () => {
  // toStyle normalizes text to a target newline style. The function
  // first normalizes all newlines to LF (so it handles mixed input),
  // then converts to the target style.

  it("converts to 'lf'", () => {
    expect(toStyle('a\r\nb\rc\n', 'lf')).toBe('a\nb\nc\n');
  });

  it("converts to 'crlf'", () => {
    expect(toStyle('a\nb\rc\r\n', 'crlf')).toBe('a\r\nb\r\nc\r\n');
  });

  it("converts to 'cr' (legacy Mac classic)", () => {
    expect(toStyle('a\nb\r\nc\r', 'cr')).toBe('a\rb\rc\r');
  });

  it('is the identity for input already in the target style', () => {
    expect(toStyle('a\nb\nc\n', 'lf')).toBe('a\nb\nc\n');
    expect(toStyle('a\r\nb\r\n', 'crlf')).toBe('a\r\nb\r\n');
  });

  it('handles empty input', () => {
    expect(toStyle('', 'lf')).toBe('');
    expect(toStyle('', 'crlf')).toBe('');
  });
});

describe('normalizeToLf', () => {
  // normalizeToLf is the convenience wrapper that normalizes any
  // newline style to LF. Identical to the first half of toStyle(s,
  // 'lf'). Used by call sites that just need "consistent line
  // endings" without caring which style to target.

  it('normalizes CRLF to LF', () => {
    expect(normalizeToLf('a\r\nb\r\nc')).toBe('a\nb\nc');
  });

  it('normalizes CR to LF', () => {
    expect(normalizeToLf('a\rb\rc')).toBe('a\nb\nc');
  });

  it('leaves LF-only input unchanged', () => {
    expect(normalizeToLf('a\nb\nc\n')).toBe('a\nb\nc\n');
  });

  it('handles mixed input by normalizing all to LF', () => {
    expect(normalizeToLf('a\nb\r\nc\rd')).toBe('a\nb\nc\nd');
  });
});
