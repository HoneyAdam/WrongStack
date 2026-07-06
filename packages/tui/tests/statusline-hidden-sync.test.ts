import { describe, expect, it } from 'vitest';
import { statuslineHiddenDiffers } from '../src/hooks/use-statusline-hidden-sync.js';
import type { StatuslineItem } from '../src/components/statusline-picker.js';

describe('statuslineHiddenDiffers', () => {
  it('returns false when the two lists have the same items in the same order', () => {
    const items: StatuslineItem[] = ['todos', 'plan'];
    expect(statuslineHiddenDiffers(items, items)).toBe(false);
  });

  it('returns false when the two lists have the same items in a different order', () => {
    expect(statuslineHiddenDiffers(['todos', 'plan'], ['plan', 'todos'])).toBe(false);
  });

  it('returns true when the picker list has an extra hidden item', () => {
    expect(statuslineHiddenDiffers(['todos'], ['todos', 'plan'])).toBe(true);
  });

  it('returns true when the hook list has an item missing from the picker list', () => {
    expect(statuslineHiddenDiffers(['todos', 'plan'], ['todos'])).toBe(true);
  });

  it('returns true when the list sizes differ even if one side is empty', () => {
    expect(statuslineHiddenDiffers([], ['todos'])).toBe(true);
    expect(statuslineHiddenDiffers(['todos'], [])).toBe(true);
  });
});
