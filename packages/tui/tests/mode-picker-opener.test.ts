import type { Mode } from '@wrongstack/core';
import { describe, expect, it } from 'vitest';
import { buildModePickerOptions } from '../src/hooks/use-mode-picker.js';

describe('buildModePickerOptions', () => {
  it('maps modes and marks the active one', () => {
    const modes: Mode[] = [
      { id: 'default', name: 'Default', description: 'Balanced default mode' },
      { id: 'review', name: 'Review', description: 'Review-oriented mode' },
    ];

    const options = buildModePickerOptions({ modes, activeId: 'review' });
    expect(options).toEqual([
      {
        id: 'default',
        name: 'Default',
        description: 'Balanced default mode',
        isActive: false,
      },
      {
        id: 'review',
        name: 'Review',
        description: 'Review-oriented mode',
        isActive: true,
      },
    ]);
  });

  it('handles a null activeId by leaving all modes inactive', () => {
    const modes: Mode[] = [
      { id: 'default', name: 'Default', description: 'Balanced default mode' },
      { id: 'review', name: 'Review', description: 'Review-oriented mode' },
    ];

    const options = buildModePickerOptions({ modes, activeId: null });
    expect(options.every((mode) => mode.isActive === false)).toBe(true);
  });

  it('returns an empty list when no modes are available', () => {
    expect(buildModePickerOptions({ modes: [], activeId: null })).toEqual([]);
  });
});
