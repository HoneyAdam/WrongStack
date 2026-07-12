/**
 * Edge-case tests for src/lib/color.ts — specific branch coverage.
 * Tests the clamp function boundaries and regex null matches.
 */
import { describe, expect, it } from 'vitest';
import { oklchToHex, colorToHex } from '../../src/lib/color';

describe('oklchToHex — regex and clamp branches', () => {
  it('handles negative chroma by clamping to 0', () => {
    // Negative chroma hits the `Math.max(0, C)` in parseOklch (line 31)
    const result = oklchToHex('oklch(0.5 -0.2 200)');
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('clamps L above 1 (line 13 n > hi branch)', () => {
    const result = oklchToHex('oklch(2.0 0.1 200)');
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('returns null when regex match is null (line 19)', () => {
    // Passing just "oklch" without parentheses hits the regex returning null
    expect(oklchToHex('oklch')).toBeNull();
  });

  it('returns null when m[1] is undefined (line 19)', () => {
    // "oklch()" matches the regex but has empty capture group
    expect(oklchToHex('oklch()')).toBeNull();
  });
});

describe('colorToHex — hex format branches', () => {
  it('passes through #rrggbb hex', () => {
    expect(colorToHex('#aabbcc')).toBe('#aabbcc');
  });

  it('strips alpha from #rrggbbaa hex', () => {
    // Hits the 6-digit capture with optional 2-digit alpha at line 70
    expect(colorToHex('#ff8800aa')).toBe('#ff8800');
  });

  it('expands #rgb short hex', () => {
    // Hits the 3-digit short hex branch at line 72
    expect(colorToHex('#abc')).toBe('#aabbcc');
  });

  it('returns null for invalid input', () => {
    // All branches fail → returns null at line 80
    expect(colorToHex('garbage')).toBeNull();
    expect(colorToHex('')).toBeNull();
  });
});
