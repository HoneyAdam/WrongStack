/**
 * Semantic tuning — turn HIGH-LEVEL design knobs into concrete low-level token
 * overrides that `applyTokenOverrides` understands. This is what lets a user (or
 * the model) say "make it rounder / more compact / snappier" without knowing the
 * kebab-scale token names:
 *
 *   design {action:"tune", tune:{ radius:"lg", density:"compact", font:"Space Grotesk" }}
 *
 * Pure: returns an override map (bare keys → both themes). Merged into the kit's
 * active overrides exactly like `set`, so it stacks with raw token overrides and
 * flows into materialize + verify + the per-turn reminder.
 */

/** High-level knobs a user/model can nudge. */
export interface SemanticTune {
  /** Corner roundness: a keyword (none|sm|md|lg|xl|full) or a base length (e.g. "1rem"). */
  radius?: string | undefined;
  /** Spacing rhythm: compact | cozy | comfortable. */
  density?: string | undefined;
  /** UI font family (applied to font-sans + font-display). */
  font?: string | undefined;
  /** Motion feel: snappy | smooth | none. */
  motion?: string | undefined;
}

const RADIUS_KEYS = ['radius-none', 'radius-sm', 'radius-md', 'radius-lg', 'radius-xl'] as const;

/** Preset radius ramps (radius-full stays 9999px). Values in rem. */
const RADIUS_RAMPS: Record<string, string[]> = {
  none: ['0', '0', '0', '0', '0'],
  sm: ['0', '0.125rem', '0.25rem', '0.375rem', '0.5rem'],
  md: ['0', '0.25rem', '0.5rem', '0.75rem', '1rem'], // foundations default
  lg: ['0', '0.5rem', '0.75rem', '1rem', '1.5rem'],
  xl: ['0', '0.75rem', '1rem', '1.5rem', '2rem'],
  full: ['0', '1rem', '1.5rem', '2rem', '9999px'],
};

/** Spacing multipliers per density. Applied to the foundation rem ramp. */
const DENSITY_MULT: Record<string, number> = {
  compact: 0.8,
  cozy: 1,
  comfortable: 1.25,
};

/** Foundation spacing ramp (rem), by token name. */
const SPACE_BASE: [string, number][] = [
  ['space-1', 0.25],
  ['space-2', 0.5],
  ['space-3', 0.75],
  ['space-4', 1],
  ['space-6', 1.5],
  ['space-8', 2],
  ['space-12', 3],
];

/** Motion presets → duration overrides. */
const MOTION_PRESETS: Record<string, Record<string, string>> = {
  snappy: { 'duration-fast': '80ms', 'duration-base': '140ms', 'duration-slow': '220ms' },
  smooth: { 'duration-fast': '160ms', 'duration-base': '260ms', 'duration-slow': '420ms' },
  none: { 'duration-fast': '0ms', 'duration-base': '0ms', 'duration-slow': '0ms' },
};

function fmtRem(n: number): string {
  // Trim trailing zeros: 1.000 → "1rem", 0.400 → "0.4rem".
  return `${Number.parseFloat(n.toFixed(4))}rem`;
}

/** Derive a proportional radius ramp from an explicit base length (radius-lg). */
function deriveRadiusRamp(base: string): Record<string, string> {
  const m = /^([\d.]+)(px|rem)$/.exec(base.trim());
  if (!m) return {};
  const n = Number.parseFloat(m[1]!);
  const unit = m[2]!;
  const at = (f: number) => `${Number.parseFloat((n * f).toFixed(4))}${unit}`;
  return {
    'radius-none': '0',
    'radius-sm': at(0.33),
    'radius-md': at(0.66),
    'radius-lg': at(1),
    'radius-xl': at(1.33),
  };
}

/**
 * Resolve high-level tune knobs into concrete kebab-scale token overrides.
 * Unknown knob values are ignored (no override emitted for that knob).
 */
export function resolveSemanticTune(tune: SemanticTune): Record<string, string> {
  const ov: Record<string, string> = {};

  if (tune.radius) {
    const key = tune.radius.trim().toLowerCase();
    const ramp = RADIUS_RAMPS[key];
    if (ramp) {
      RADIUS_KEYS.forEach((rk, i) => {
        ov[rk] = ramp[i]!;
      });
      if (key === 'full') ov['radius-full'] = '9999px';
    } else if (/^[\d.]+(px|rem)$/.test(tune.radius.trim())) {
      Object.assign(ov, deriveRadiusRamp(tune.radius.trim()));
    }
  }

  if (tune.density) {
    const mult = DENSITY_MULT[tune.density.trim().toLowerCase()];
    if (mult) {
      for (const [name, rem] of SPACE_BASE) ov[name] = fmtRem(rem * mult);
    }
  }

  if (tune.font?.trim()) {
    ov['font-sans'] = tune.font.trim();
    ov['font-display'] = tune.font.trim();
  }

  if (tune.motion) {
    const preset = MOTION_PRESETS[tune.motion.trim().toLowerCase()];
    if (preset) Object.assign(ov, preset);
  }

  return ov;
}

/** Knob names recognized by `resolveSemanticTune`, for help/validation. */
export const SEMANTIC_TUNE_KNOBS = ['radius', 'density', 'font', 'motion'] as const;
