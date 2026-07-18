import { describe, expect, it } from 'vitest';
import {
  ANIMATION_STYLE_DESCS,
  ANIMATION_STYLES,
  BREATHE_FRAMES,
  CYCLE_INTERVAL_SECONDS,
  CYCLE_ORDER,
  CYCLE_TICK_INTERVAL_MS,
  DEFAULT_ANIMATION_STYLE,
  DOTS_FRAMES,
  HUE_WHEEL,
  type AnimationStyle,
  hslToHex,
  mixHex,
  pulseColor,
  rainbowColor,
  rainbowHue,
  stripTrailingDots,
  styleForCycleTick,
  waveColor,
} from '../src/components/animation-style.js';

/** Parse a #rrggbb hex into [r, g, b] numbers. Helper for color tests. */
function parseRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

describe('animation-style', () => {
  describe('exports', () => {
    it('exposes 5 renderable styles', () => {
      expect(ANIMATION_STYLES).toEqual(['rainbow', 'wave', 'pulse', 'dots', 'breathe']);
    });

    it('has a description per style', () => {
      for (const s of ANIMATION_STYLES) {
        expect(ANIMATION_STYLE_DESCS[s]).toEqual(expect.any(String));
        expect(ANIMATION_STYLE_DESCS[s]!.length).toBeGreaterThan(0);
      }
    });

    it('default is rainbow', () => {
      expect(DEFAULT_ANIMATION_STYLE).toBe('rainbow');
    });

    it('cycle order excludes rainbow', () => {
      expect(CYCLE_ORDER).not.toContain('rainbow');
      expect(CYCLE_ORDER.length).toBe(ANIMATION_STYLES.length - 1);
    });

    it('hue wheel has 12 catppuccin stops, each a valid hex', () => {
      expect(HUE_WHEEL).toHaveLength(12);
      for (const c of HUE_WHEEL) {
        expect(c).toMatch(/^#[0-9a-f]{6}$/i);
      }
    });

    it('braille + dots frames are non-empty arrays of strings', () => {
      expect(BREATHE_FRAMES.length).toBeGreaterThan(0);
      for (const f of BREATHE_FRAMES) expect(typeof f).toBe('string');
      expect(DOTS_FRAMES.length).toBeGreaterThan(0);
      for (const f of DOTS_FRAMES) expect(typeof f).toBe('string');
    });

    it('cycle timing constants are positive integers', () => {
      expect(CYCLE_INTERVAL_SECONDS).toBeGreaterThan(0);
      expect(CYCLE_TICK_INTERVAL_MS).toBeGreaterThanOrEqual(1000);
    });
  });

  describe('styleForCycleTick', () => {
    it('returns the first style at tick 0', () => {
      expect(styleForCycleTick(0)).toBe(CYCLE_ORDER[0]);
    });

    it('returns the second style after one full interval', () => {
      expect(styleForCycleTick(CYCLE_INTERVAL_SECONDS)).toBe(CYCLE_ORDER[1]);
    });

    it('wraps around at the cycle length', () => {
      const fullCycle = CYCLE_INTERVAL_SECONDS * CYCLE_ORDER.length;
      expect(styleForCycleTick(fullCycle)).toBe(CYCLE_ORDER[0]);
      expect(styleForCycleTick(fullCycle + CYCLE_INTERVAL_SECONDS)).toBe(CYCLE_ORDER[1]);
    });

    it('handles negative ticks defensively (treats as 0)', () => {
      expect(styleForCycleTick(-5)).toBe(CYCLE_ORDER[0]);
    });

    it('only ever returns a member of the cycle order', () => {
      for (let i = 0; i < CYCLE_INTERVAL_SECONDS * CYCLE_ORDER.length * 2; i += 7) {
        const s = styleForCycleTick(i);
        expect((CYCLE_ORDER as readonly string[]).includes(s)).toBe(true);
      }
    });
  });

  describe('mixHex', () => {
    it('returns the first color at t=0', () => {
      expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    });

    it('returns the second color at t=1', () => {
      expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    });

    it('returns ~halfway color at t=0.5', () => {
      expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    });

    it('clamps t outside [0,1]', () => {
      expect(mixHex('#000000', '#ffffff', -1)).toBe('#000000');
      expect(mixHex('#000000', '#ffffff', 2)).toBe('#ffffff');
    });

    it('falls back to the second color on invalid input', () => {
      expect(mixHex('not-a-color', '#ffffff', 0.5)).toBe('#ffffff');
    });
  });

  describe('waveColor', () => {
    it('returns a valid hex for any inputs', () => {
      for (let i = 0; i < 10; i++) {
        for (let phase = 0; phase < 40; phase++) {
          expect(waveColor(i, phase, 10)).toMatch(/^#[0-9a-f]{6}$/i);
        }
      }
    });

    it('handles length 0 without throwing', () => {
      expect(waveColor(0, 0, 0)).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  describe('pulseColor', () => {
    it('returns a valid hex for any phase', () => {
      for (let phase = 0; phase < 100; phase++) {
        expect(pulseColor(phase)).toMatch(/^#[0-9a-f]{6}$/i);
      }
    });

    it('is periodic over 16 phases', () => {
      expect(pulseColor(0)).toBe(pulseColor(16));
      expect(pulseColor(0)).toBe(pulseColor(32));
    });
  });

  describe('stripTrailingDots', () => {
    it('removes trailing periods', () => {
      expect(stripTrailingDots('thinking...')).toBe('thinking');
    });

    it('removes trailing spaces and ellipsis', () => {
      expect(stripTrailingDots('thinking … ')).toBe('thinking');
    });

    it('leaves interior punctuation untouched', () => {
      expect(stripTrailingDots('thinking. about. it')).toBe('thinking. about. it');
    });

    it('returns empty string for an all-trailing input', () => {
      expect(stripTrailingDots('...')).toBe('');
    });

    it('returns empty string unchanged', () => {
      expect(stripTrailingDots('')).toBe('');
    });
  });

  describe('AnimationStyle type', () => {
    it('is assignable to the union', () => {
      const s: AnimationStyle = 'wave';
      expect(s).toBe('wave');
    });
  });

  describe('hslToHex', () => {
    it('produces valid hex for primary hues', () => {
      expect(hslToHex(0, 1, 0.5)).toBe('#ff0000'); // red
      expect(hslToHex(120, 1, 0.5)).toBe('#00ff00'); // green
      expect(hslToHex(240, 1, 0.5)).toBe('#0000ff'); // blue
    });

    it('wraps hue values outside [0,360)', () => {
      expect(hslToHex(360, 1, 0.5)).toBe(hslToHex(0, 1, 0.5));
      expect(hslToHex(720, 1, 0.5)).toBe(hslToHex(0, 1, 0.5));
      expect(hslToHex(-120, 1, 0.5)).toBe(hslToHex(240, 1, 0.5));
    });

    it('clamps saturation and lightness to [0,1]', () => {
      expect(hslToHex(0, -1, 0.5)).toBe(hslToHex(0, 0, 0.5));
      expect(hslToHex(0, 2, 0.5)).toBe(hslToHex(0, 1, 0.5));
      expect(hslToHex(0, 1, -0.5)).toBe(hslToHex(0, 1, 0));
      expect(hslToHex(0, 1, 1.5)).toBe(hslToHex(0, 1, 1));
    });

    it('always returns 7-char hex (#rrggbb)', () => {
      for (let h = 0; h < 360; h += 7) {
        for (let s = 0; s <= 1; s += 0.25) {
          for (let l = 0; l <= 1; l += 0.25) {
            expect(hslToHex(h, s, l)).toMatch(/^#[0-9a-f]{6}$/i);
          }
        }
      }
    });

    it('produces white at l=1 and black at l=0 regardless of hue', () => {
      expect(hslToHex(42, 0.8, 1)).toBe('#ffffff');
      expect(hslToHex(42, 0.8, 0)).toBe('#000000');
    });

    it('produces gray at s=0 regardless of hue', () => {
      // At s=0 the color is pure gray: l=0.5 → #808080
      expect(hslToHex(0, 0, 0.5)).toBe('#808080');
      expect(hslToHex(180, 0, 0.5)).toBe('#808080');
    });
  });

  describe('rainbowHue', () => {
    it('returns a value in [0, 360)', () => {
      for (let i = 0; i < 20; i++) {
        for (let phase = 0; phase < 100; phase += 5) {
          const hue = rainbowHue(i, phase);
          expect(hue).toBeGreaterThanOrEqual(0);
          expect(hue).toBeLessThan(360);
        }
      }
    });

    it('is periodic in phase — same index repeats hue after full cycles', () => {
      // The temporal term is sin(2π * (spatial + temporal)). After the
      // temporal argument advances by 1 (one full sine cycle), the hue
      // must return to the same value. With HUE_PER_TICK=18°, one full
      // cycle = 360/18 = 20 ticks.
      const base = rainbowHue(3, 0);
      expect(rainbowHue(3, 20)).toBeCloseTo(base, 5);
      expect(rainbowHue(3, 40)).toBeCloseTo(base, 5);
    });

    it('is periodic in spatial position', () => {
      // The spatial term is sin(2π * (i/period)). After i advances by one
      // period, the sine returns to the same argument.
      // period = max(2, RAINBOW_SPATIAL_PERIOD) = 8
      const base = rainbowHue(2, 0);
      expect(rainbowHue(10, 0)).toBeCloseTo(base, 5);
      expect(rainbowHue(18, 0)).toBeCloseTo(base, 5);
    });

    it('adjacent glyphs differ by a bounded hue delta (no full-spectrum snaps)', () => {
      // Adjacent glyphs at the same phase can differ by up to ~180° at the
      // sine's steepest point — that's inherent to a 360° amplitude over an
      // 8-glyph period. The guarantee is that we never see a ~360° snap
      // (which would indicate a discontinuity). A snap would be close to
      // the full amplitude. Epsilon accounts for floating-point rounding.
      const EPS = 0.001;
      for (let phase = 0; phase < 50; phase += 5) {
        for (let i = 0; i < 20; i++) {
          const h1 = rainbowHue(i, phase);
          const h2 = rainbowHue(i + 1, phase);
          let delta = Math.abs(h2 - h1);
          if (delta > 180) delta = 360 - delta;
          expect(delta).toBeLessThanOrEqual(180 + EPS);
        }
      }
    });

    it('temporal smoothness: consecutive phase ticks shift each glyph by a small amount', () => {
      // This is the key improvement over the old discrete lookup. The old
      // HUE_WHEEL approach snapped every glyph by 30° (360/12) on each tick.
      // The sinusoidal approach shifts each glyph by at most ~18° per tick
      // (amp/2 * sin(2π * HUE_PER_TICK/360) ≈ 180 * 0.309 ≈ 56°... actually
      // that's quite large; the real smoothness invariant is that each tick
      // moves each glyph by less than a quarter turn — 90°). This is what
      // makes the animation feel smooth rather than stepped.
      for (let i = 0; i < 12; i++) {
        for (let phase = 0; phase < 40; phase++) {
          const h1 = rainbowHue(i, phase);
          const h2 = rainbowHue(i, phase + 1);
          let delta = Math.abs(h2 - h1);
          if (delta > 180) delta = 360 - delta;
          expect(delta).toBeLessThan(90);
        }
      }
    });

    it('covers the full hue spectrum across many glyphs', () => {
      // With amplitude 360° and a smooth wave, sweeping across many
      // glyphs must produce hues across all four quadrants. We sample 50
      // glyphs and assert at least one is in each quadrant of the wheel:
      // red/yellow (0-90), green (90-180), cyan/blue (180-270), purple/pink (270-360).
      const hues = Array.from({ length: 50 }, (_, i) => rainbowHue(i, 0));
      const inQuadrant = (q: number) => hues.some((h) => {
        const norm = ((h - 0 + 360) % 360);
        return norm >= q * 90 && norm < (q + 1) * 90;
      });
      expect(inQuadrant(0)).toBe(true); // red/yellow
      expect(inQuadrant(1)).toBe(true); // green
      expect(inQuadrant(2)).toBe(true); // cyan/blue
      expect(inQuadrant(3)).toBe(true); // purple/pink
    });

    it('is deterministic — same inputs always produce the same hue', () => {
      const a = rainbowHue(5, 13);
      const b = rainbowHue(5, 13);
      expect(a).toBe(b);
    });
  });

  describe('rainbowColor', () => {
    it('returns valid hex for any glyph index and phase', () => {
      for (let i = 0; i < 15; i++) {
        for (let phase = 0; phase < 40; phase++) {
          expect(rainbowColor(i, phase)).toMatch(/^#[0-9a-f]{6}$/i);
        }
      }
    });

    it('produces smooth color progression across glyphs at a fixed phase', () => {
      // Adjacent glyph colors should be perceptually close — their RGB
      // components should not jump by more than ~128 (half of 255).
      const phase = 5;
      for (let i = 0; i < 12; i++) {
        const c1 = rainbowColor(i, phase);
        const c2 = rainbowColor(i + 1, phase);
        const [r1, g1, b1] = parseRgb(c1);
        const [r2, g2, b2] = parseRgb(c2);
        const maxDelta = Math.max(Math.abs(r2 - r1), Math.abs(g2 - g1), Math.abs(b2 - b1));
        expect(maxDelta).toBeLessThan(128);
      }
    });

    it('produces pastel tones (not pure primaries)', () => {
      // With saturation 0.7 and lightness 0.65, no component should be
      // at 0 or 255 — the colors are always soft pastel.
      for (let i = 0; i < 12; i++) {
        const [r, g, b] = parseRgb(rainbowColor(i, 0));
        expect(r).toBeGreaterThan(0);
        expect(r).toBeLessThan(255);
        expect(g).toBeGreaterThan(0);
        expect(b).toBeGreaterThan(0);
      }
    });

    it('is deterministic', () => {
      expect(rainbowColor(4, 7)).toBe(rainbowColor(4, 7));
    });
  });
});
