// Animation styles for the TUI's working/thinking state chip.
//
// The status bar paints a small text label (e.g. "● thinking…") whenever the
// agent is running or streaming. To keep the indicator lively without being
// distracting, we apply one of several `AnimationStyle`s to that label — each
// style consumes the same `(text, phase, tick)` inputs and produces a
// different visual effect.
//
// Style catalog:
//   - `rainbow`  per-glyph hue cycling (the original wave UI)
//   - `wave`     per-glyph brightness sweep, single color
//   - `pulse`    whole-text brightness pulse, single color
//   - `dots`     trailing `.` `..` `...` ellipsis that grows and resets
//   - `breathe`  the leading glyph cycles through braille spinner frames while
//                the text itself stays flat
//
// `phase` is the per-frame tick from the spinner interval (0..N-1).
// `tick` is a coarser time tick (0..∞) used by styles that need seconds-scale
// pacing (cycle). The status bar ticks `phase` every ~250ms and `tick` every
// ~1s.
//
// Pastel (Catppuccin Mocha) hue-wheel for `rainbow`. 12 stops give a smooth
// gradient as the per-character offset shifts each spinner tick — soft tones
// so the wave stays gentle rather than neon.
export const HUE_WHEEL = [
  '#f38ba8', // red
  '#eba0ac', // maroon
  '#fab387', // peach
  '#f9e2af', // yellow
  '#a6e3a1', // green
  '#94e2d5', // teal
  '#89dceb', // sky
  '#89b4fa', // blue
  '#b4befe', // lavender
  '#cba6f7', // mauve
  '#f5c2e7', // pink
  '#f2cdcd', // flamingo
];

// Single base color used by `wave` / `pulse` / `breathe`. Stays inside the
// theme so it pairs with the rest of the status chip.
const ACCENT = '#fab387'; // Catppuccin peach

// Dim/highlight stops for the brightness sweep styles.
const DIM = '#313244'; // Catppuccin surface0

// Braille spinner frames used by `breathe` and by the leading statePrefix
// glyph.
export const BREATHE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// Dots frames — appended to the text. The number of dots wraps so the
// ellipsis cycles `.` → `..` → `...` → `..` → `.` → …
//   frame 0 → "thinking"   frame 1 → "thinking."   frame 2 → "thinking.."
//   frame 3 → "thinking..." frame 4 → "thinking.."   frame 5 → "thinking."
//   then wrap to 0
export const DOTS_FRAMES = ['', '.', '..', '...', '..', '.'];

export const ANIMATION_STYLES = ['rainbow', 'wave', 'pulse', 'dots', 'breathe'] as const;
export type AnimationStyle = (typeof ANIMATION_STYLES)[number];

export const DEFAULT_ANIMATION_STYLE: AnimationStyle = 'rainbow';

export const ANIMATION_STYLE_DESCS: Record<AnimationStyle, string> = {
  rainbow: 'Per-glyph hue cycle (default)',
  wave: 'Single-color brightness sweep',
  pulse: 'Whole-text brightness pulse',
  dots: 'Trailing dots ellipsis (. .. ... .. .)',
  breathe: 'Spinning braille glyph prefix, flat text',
};

/**
 * Seconds the user must be idle on the same style before `cycle` advances
 * to the next one. Picked to feel like a "shuffle" rather than a flicker.
 */
export const CYCLE_INTERVAL_SECONDS = 12;

/**
 * Milliseconds between each cycle tick. Picked so the cycle timer doesn't
 * drive unnecessary re-renders for idle sessions (the StatusBar pauses the
 * timer when state is idle/aborting).
 */
export const CYCLE_TICK_INTERVAL_MS = 1000;

/**
 * Cycle through every other `AnimationStyle` in order, returning to the
 * start once the list is exhausted. `rainbow` is excluded from the cycle
 * (it's the default/canonical look); cycle goes through the four variant
 * styles only.
 */
export const CYCLE_ORDER: readonly AnimationStyle[] = ['wave', 'pulse', 'dots', 'breathe'];

/**
 * Map a coarse `tick` (seconds elapsed since the cycle started) onto the
 * currently-active style. Returns the style at the cycle index derived from
 * `floor(tick / CYCLE_INTERVAL_SECONDS)`.
 *
 * Pure + exported for testing.
 */
export function styleForCycleTick(tick: number): AnimationStyle {
  const idx = Math.max(0, Math.floor(tick / CYCLE_INTERVAL_SECONDS));
  const i = idx % CYCLE_ORDER.length;
  return CYCLE_ORDER[i] ?? CYCLE_ORDER[0]!;
}

/** Mix two `#rrggbb` colors by `t ∈ [0,1]`. Pure. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return b;
  const k = Math.max(0, Math.min(1, t));
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * k);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * k);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * k);
  return `#${toHex(r)}${toHex(g)}${toHex(bl)}`;
}

function parseHex(s: string): [number, number, number] | null {
  if (!/^#[0-9a-f]{6}$/i.test(s)) return null;
  return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
}

function toHex(n: number): string {
  return n.toString(16).padStart(2, '0');
}

/**
 * Pick a colour for the given glyph index + phase under the `wave` style —
 * interpolates from `DIM` to `ACCENT` along a sinusoidal band so the bright
 * spot glides smoothly across the text. Pure for testing.
 */
export function waveColor(charIndex: number, phase: number, length: number): string {
  const t = length > 0 ? charIndex / length : 0;
  const sweep = Math.sin(t * Math.PI * 2 + phase / 10);
  return mixHex(DIM, ACCENT, (sweep + 1) / 2);
}

/**
 * Pick a colour for the whole text under the `pulse` style — single color
 * modulated by an oscillator so the whole chip dims/brightens together.
 * Pure for testing.
 */
export function pulseColor(phase: number): string {
  const t = (phase % 16) / 16;
  const k = 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
  return mixHex(DIM, ACCENT, k);
}

// ─── Smooth rainbow helpers ───────────────────────────────────────────────
//
// The original `rainbow` style used a discrete 12-stop lookup table — each
// glyph snapped to one of `HUE_WHEEL`'s fixed colors, producing a visible
// stepping at every phase tick. The refined version computes each glyph's
// hue as a sinusoidal function of (position, phase), then converts HSL→RGB
// on the fly. The result is a smooth gradient band that glides across the
// text without snapping, and the bright spot travels rather than every
// glyph cycling in lockstep.
//
// All three helpers are pure (no I/O, no globals) so they can be unit tested
// in isolation.

/** Base hue around which the rainbow oscillates (degrees, 0-360). 0 = red. */
const RAINBOW_BASE_HUE = 0;
/**
 * Amplitude of the hue sweep in degrees. 360 sweeps the full visible
 * spectrum so every hue (red, green, blue, purple, magenta) appears at
 * some point in the cycle — the gradient is genuinely full-spectrum.
 */
const RAINBOW_HUE_AMPLITUDE = 360;
/**
 * Spatial wavelength: how many glyphs span one full hue cycle. Smaller =
 * tighter bands (more rainbow stripes in the same text). The text length
 * also modulates this so short labels don't look denser than long ones.
 */
const RAINBOW_SPATIAL_PERIOD = 8;
/**
 * Temporal speed: hue degrees shifted per phase tick. At the status bar's
 * ~250ms tick, 18°/tick means one full spectrum cycle takes ~5 seconds —
 * lively but not frantic.
 */
const RAINBOW_HUE_PER_TICK = 18;

/**
 * Compute the hue (in degrees, 0-360) for glyph `charIndex` at animation
 * `phase`.
 *
 * The hue follows a sinusoidal curve: `base + amp * sin(2π * f)`, where
 * `f` combines spatial position and temporal phase into a single phase
 * argument. This produces a smooth traveling wave — the bright band glides
 * across the text, and adjacent glyphs always differ by a small hue delta
 * (never a snap).
 *
 * Pure for testing.
 */
export function rainbowHue(
  charIndex: number,
  phase: number,
): number {
  const period = Math.max(2, RAINBOW_SPATIAL_PERIOD);
  const spatialPhase = charIndex / period;
  const temporalPhase = RAINBOW_HUE_PER_TICK * phase / 360;
  const wave = Math.sin((spatialPhase + temporalPhase) * Math.PI * 2);
  // Normalize [-1,1] → [0,1] so the hue sweeps the full amplitude.
  const t = (wave + 1) / 2;
  let hue = RAINBOW_BASE_HUE + RAINBOW_HUE_AMPLITUDE * t;
  // Wrap into [0, 360)
  hue = ((hue % 360) + 360) % 360;
  return hue;
}

/**
 * Convert HSL (degrees, 0-1, 0-1) to a `#rrggbb` hex string.
 * Algorithm: standard HSL→RGB conversion with the 0/120/240 sector trick.
 *
 * Pure for testing.
 */
export function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.max(0, Math.min(1, s));
  const ll = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) { r = c; g = x; b = 0; }
  else if (hh < 120) { r = x; g = c; b = 0; }
  else if (hh < 180) { r = 0; g = c; b = x; }
  else if (hh < 240) { r = 0; g = x; b = c; }
  else if (hh < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  const toHex2 = (n: number) =>
    Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
}

/**
 * Saturation and lightness for the refined rainbow. Lowered to 0.45 / 0.55
 * so the full 360° hue sweep renders as Catppuccin Mocha-inspired soft
 * pastels — muted dusty rose, sage, powder blue, lavender — rather than
 * mid-saturation or vivid tones. The gradient reads as gentle rather than
 * lively.
 */
const RAINBOW_SATURATION = 0.45;
const RAINBOW_LIGHTNESS = 0.55;

/**
 * Pick a smooth-rainbow color for glyph `charIndex` at animation `phase`
 * for a text of length `textLen`. This is the refined replacement for the
 * old `HUE_WHEEL[(i + phase) % 12]` lookup — it computes hue via
 * {@link rainbowHue} and converts to hex via {@link hslToHex}.
 *
 * Pure for testing.
 */
export function rainbowColor(
  charIndex: number,
  phase: number,
): string {
  const hue = rainbowHue(charIndex, phase);
  return hslToHex(hue, RAINBOW_SATURATION, RAINBOW_LIGHTNESS);
}

/** Strip trailing `.`, `…`, etc. so the `dots` style doesn't double up on
 *  the user-supplied label. */
export function stripTrailingDots(text: string): string {
  let s = text;
  while (s.length > 0) {
    const last = s.charAt(s.length - 1);
    if (last === '.' || last === ' ' || last === '…' || last === '·') {
      s = s.slice(0, -1);
    } else {
      break;
    }
  }
  return s;
}
