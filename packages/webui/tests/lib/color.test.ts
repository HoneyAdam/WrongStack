/**
 * Tests for src/lib/color.ts — OKLCH→hex conversion and color utility functions.
 * Pure math functions with no external dependencies.
 */

import { describe, expect, it } from 'vitest';
import { oklchToHex, colorToHex } from '../../src/lib/color';

describe('oklchToHex', () => {
  it('converts a valid OKLCH string to hex', () => {
    // Typical values — not asserting exact because floating point can vary
    // slightly across JS engines; just verify the shape.
    const result = oklchToHex('oklch(0.5 0.1 200)');
    expect(result).not.toBeNull();
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('returns null for an unparseable string', () => {
    expect(oklchToHex('not-oklch')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(oklchToHex('')).toBeNull();
  });

  it('handles percentage L value', () => {
    const result = oklchToHex('oklch(50% 0.1 200)');
    expect(result).not.toBeNull();
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('handles percentage chroma value', () => {
    const result = oklchToHex('oklch(0.5 25% 200)');
    expect(result).not.toBeNull();
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('handles deg suffix on hue', () => {
    const result = oklchToHex('oklch(0.5 0.1 200deg)');
    expect(result).not.toBeNull();
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('returns null when coordinates are missing', () => {
    expect(oklchToHex('oklch()')).toBeNull();
  });

  it('returns null when only one coordinate is given', () => {
    expect(oklchToHex('oklch(0.5)')).toBeNull();
  });

  it('returns null for NaN coordinates', () => {
    expect(oklchToHex('oklch(foo bar baz)')).toBeNull();
  });

  it('clamps L to [0,1]', () => {
    const result = oklchToHex('oklch(-0.1 0.1 200)');
    expect(result).not.toBeNull();
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('clamps chroma to >= 0', () => {
    const result = oklchToHex('oklch(0.5 -0.1 200)');
    expect(result).not.toBeNull();
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('colorToHex', () => {
  it('converts a valid OKLCH string to hex', () => {
    const result = colorToHex('oklch(0.5 0.1 200)');
    expect(result).not.toBeNull();
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('passes through a valid #rrggbb hex', () => {
    expect(colorToHex('#ff8800')).toBe('#ff8800');
  });

  it('normalises #RRGGBB to lower case', () => {
    expect(colorToHex('#FF8800')).toBe('#ff8800');
  });

  it('expands #rgb short hex', () => {
    expect(colorToHex('#f80')).toBe('#ff8800');
  });

  it('expands #RGB short hex with lower-casing', () => {
    expect(colorToHex('#F80')).toBe('#ff8800');
  });

  it('handles #rrggbbaa hex with alpha stripping', () => {
    expect(colorToHex('#ff8800aa')).toBe('#ff8800');
  });

  it('returns null for invalid hex', () => {
    expect(colorToHex('#xyz')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(colorToHex('')).toBeNull();
  });

  it('returns null for gibberish', () => {
    expect(colorToHex('not-a-color')).toBeNull();
  });

  it('trims whitespace', () => {
    expect(colorToHex('  #ff8800  ')).toBe('#ff8800');
  });

  it('lowercases OKLCH output', () => {
    const result = colorToHex('oklch(0.5 0.2 180)');
    expect(result).not.toBeNull();
    // All characters should be lower-case
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
  });
});
