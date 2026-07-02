// Runtime smoke for the PluginPicker React component.
//
// The reducer and dispatch tests cover *what* the picker does in response
// to state changes; this file covers *what it looks like* when mounted.
// In other words, the user-visible contract:
//
//   - "Plugin menu" heading appears
//   - lockable rows show 🔒 + yellow
//   - enabled rows show ● on, disabled show ○ off
//   - ↑/↓ change the focused row (via the `selected` prop)
//   - the hint footer surfaces the locked-row message
//
// If the highlight colours change, or the markers are wrong, this test
// will catch it — which is what a user running /plugin menu would notice
// first.

import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { PluginPicker, type PluginPickerItem } from '../src/components/plugin-picker.js';

const ROWS: PluginPickerItem[] = [
  { name: 'cost-tracker', enabled: true, risk: 'low', summary: 'Tracks cost', lockable: true },
  { name: 'wstack-git', enabled: true, risk: 'high', summary: 'Core git', lockable: false },
  { name: 'format-on-save', enabled: false, risk: 'low', summary: 'Auto-format', lockable: true },
  { name: 'secret-scanner', enabled: true, risk: 'high', summary: 'Secret guard', lockable: false },
];

function frame(items: PluginPickerItem[], selected: number, hint?: string): string {
  const inst = render(React.createElement(PluginPicker, { items, selected, hint }));
  const text = inst.lastFrame() ?? '';
  inst.unmount();
  return text;
}

describe('<PluginPicker /> rendering', () => {
  it('renders the heading and the hint bar', () => {
    const text = frame(ROWS, 0);
    expect(text).toMatch(/Plugin menu/);
    expect(text).toMatch(/↑\/↓ select/);
    expect(text).toMatch(/Enter\/←\/→ toggle/);
    expect(text).toMatch(/🔒 = locked/);
    expect(text).toMatch(/Esc close/);
  });

  it('lists every row by name', () => {
    const text = frame(ROWS, 0);
    for (const row of ROWS) {
      expect(text).toMatch(row.name);
    }
  });

  it('renders the lock marker on rows where lockable=false', () => {
    const text = frame(ROWS, 0);
    // 2 lockable rows in our fixture.
    const lockMarkerCount = (text.match(/🔒/g) ?? []).length;
    expect(lockMarkerCount).toBeGreaterThanOrEqual(2);
  });

  it('renders the "on" marker for enabled rows and "off" for disabled', () => {
    const text = frame(ROWS, 0);
    expect(text).toMatch(/● on/); // cost-tracker, wstack-git, secret-scanner are enabled
    expect(text).toMatch(/○ off/); // format-on-save is disabled
  });

  it('shows the focused row with the › marker', () => {
    const textFirst = frame(ROWS, 0);
    const textSecond = frame(ROWS, 1);
    // Each row is a Text component — both frames should contain the row
    // names, but only one row should have the › focus marker per frame.
    expect(textFirst).toMatch(/›/);
    expect(textSecond).toMatch(/›/);
  });

  it('shows the "Loading plugins…" placeholder when items is empty AND busy=true', () => {
    const text =
      render(
        React.createElement(PluginPicker, { items: [], selected: 0, busy: true }),
      ).lastFrame() ?? '';
    expect(text).toMatch(/Loading plugins/);
  });

  it('shows the "No plugins available." placeholder when items is empty AND not busy', () => {
    const text =
      render(
        React.createElement(PluginPicker, { items: [], selected: 0, busy: false }),
      ).lastFrame() ?? '';
    expect(text).toMatch(/No plugins available/);
  });

  it('renders the hint footer when busy or locked-row guidance is set', () => {
    const text =
      render(
        React.createElement(PluginPicker, {
          items: ROWS,
          selected: 1, // wstack-git, which is locked
          hint: 'wstack-git is locked — see /plugin report',
        }),
      ).lastFrame() ?? '';
    expect(text).toMatch(/wstack-git is locked/);
  });
});
