import { describe, expect, it } from 'vitest';
import { resolveSemanticTune } from '../../src/execution/design-tune.js';

describe('resolveSemanticTune', () => {
  it('radius keyword → full radius ramp override', () => {
    const ov = resolveSemanticTune({ radius: 'lg' });
    expect(ov['radius-none']).toBe('0');
    expect(ov['radius-md']).toBe('0.75rem');
    expect(ov['radius-xl']).toBe('1.5rem');
  });

  it('radius "full" → very round ramp incl. radius-full pill', () => {
    const ov = resolveSemanticTune({ radius: 'full' });
    expect(ov['radius-full']).toBe('9999px');
  });

  it('radius as explicit base length → proportional ramp', () => {
    const ov = resolveSemanticTune({ radius: '1rem' });
    expect(ov['radius-lg']).toBe('1rem');
    expect(ov['radius-sm']).toBe('0.33rem');
    expect(ov['radius-md']).toBe('0.66rem');
  });

  it('density compact → scaled-down spacing ramp', () => {
    const ov = resolveSemanticTune({ density: 'compact' });
    expect(ov['space-4']).toBe('0.8rem'); // 1rem * 0.8
    expect(ov['space-8']).toBe('1.6rem');
  });

  it('font → font-sans + font-display', () => {
    const ov = resolveSemanticTune({ font: 'Space Grotesk' });
    expect(ov['font-sans']).toBe('Space Grotesk');
    expect(ov['font-display']).toBe('Space Grotesk');
  });

  it('motion snappy → duration overrides', () => {
    const ov = resolveSemanticTune({ motion: 'snappy' });
    expect(ov['duration-fast']).toBe('80ms');
  });

  it('unknown knob values are ignored', () => {
    expect(resolveSemanticTune({ radius: 'bogus', density: 'nope' })).toEqual({});
  });

  it('combines multiple knobs', () => {
    const ov = resolveSemanticTune({ radius: 'none', density: 'comfortable' });
    expect(ov['radius-md']).toBe('0');
    expect(ov['space-4']).toBe('1.25rem');
  });
});
