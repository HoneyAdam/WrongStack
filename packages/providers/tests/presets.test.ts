import { describe, it, expect } from 'vitest';
import { PRESETS, listPresets, type PresetSpec } from '../src/presets.js';

describe('presets (deprecated)', () => {
  it('PRESETS is empty', () => expect(PRESETS).toEqual({}));
  it('listPresets returns empty array', () => expect(listPresets()).toEqual([]));
  it('PresetSpec is never', () => {
    const val: PresetSpec = undefined as never;
    expect(val).toBeUndefined();
  });
});