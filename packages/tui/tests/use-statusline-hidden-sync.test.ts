import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { Text } from '../src/ink.js';
import {
  statuslineHiddenDiffers,
  useStatuslineHiddenSync,
} from '../src/hooks/use-statusline-hidden-sync.js';
import type { StatuslineItem } from '../src/components/statusline-picker.js';

// ── statuslineHiddenDiffers (pure) ───────────────────────────────────

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

  it('returns false when both are empty', () => {
    expect(statuslineHiddenDiffers([], [])).toBe(false);
  });
});

// ── useStatuslineHiddenSync (hook) ───────────────────────────────────

describe('useStatuslineHiddenSync', () => {
  it('does nothing when picker is not open', () => {
    const setHiddenItems = vi.fn();
    function Harness(): React.ReactElement {
      useStatuslineHiddenSync({
        pickerOpen: false,
        pickerHidden: ['todos'],
        hiddenItems: ['brain'],
        setHiddenItems,
      });
      return React.createElement(Text, null, 'test');
    }
    render(React.createElement(Harness));
    expect(setHiddenItems).not.toHaveBeenCalled();
  });

  it('syncs hidden items when picker is open and differs', () => {
    const setHiddenItems = vi.fn();
    function Harness(): React.ReactElement {
      useStatuslineHiddenSync({
        pickerOpen: true,
        pickerHidden: ['todos'],
        hiddenItems: ['brain'],
        setHiddenItems,
      });
      return React.createElement(Text, null, 'test');
    }
    render(React.createElement(Harness));
    expect(setHiddenItems).toHaveBeenCalledWith(['todos']);
  });

  it('does not sync when picker is open but items match', () => {
    const setHiddenItems = vi.fn();
    function Harness(): React.ReactElement {
      useStatuslineHiddenSync({
        pickerOpen: true,
        pickerHidden: ['todos'],
        hiddenItems: ['todos'],
        setHiddenItems,
      });
      return React.createElement(Text, null, 'test');
    }
    render(React.createElement(Harness));
    expect(setHiddenItems).not.toHaveBeenCalled();
  });

  it('calls setHiddenItems with a new array', () => {
    const setHiddenItems = vi.fn();
    const pickerHidden: StatuslineItem[] = ['todos'];
    function Harness(): React.ReactElement {
      useStatuslineHiddenSync({
        pickerOpen: true,
        pickerHidden,
        hiddenItems: ['brain'],
        setHiddenItems,
      });
      return React.createElement(Text, null, 'test');
    }
    render(React.createElement(Harness));
    const arg = setHiddenItems.mock.calls[0]?.[0];
    expect(arg).toEqual(['todos']);
    expect(arg).not.toBe(pickerHidden);
  });
});
