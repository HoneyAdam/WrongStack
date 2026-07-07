import { describe, expect, it } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { ToolsPicker, type ToolPickerItem } from '../src/components/tools-picker.js';

function item(overrides: Partial<ToolPickerItem> = {}): ToolPickerItem {
  return {
    name: 'read',
    owner: 'core',
    category: 'filesystem',
    enabled: true,
    mutating: false,
    permission: 'auto',
    descMode: 'extend',
    description: 'Read a file before editing it.',
    ...overrides,
  };
}

describe('ToolsPicker rendering', () => {
  it('keeps disabled tools visible and explains how to restore them', () => {
    const { lastFrame, unmount } = render(
      React.createElement(ToolsPicker, {
        items: [item(), item({ name: 'write', enabled: false, mutating: true, permission: 'confirm', description: 'Write file contents.' })],
        selected: 1,
      }),
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('write');
    expect(frame).toContain('○ disabled');
    expect(frame).toContain('1 active / 1 disabled');
    expect(frame).toContain('Disabled tools stay listed here');
    expect(frame).toContain('Enter re-enables this tool');
    expect(frame).toContain('Write file contents.');
    unmount();
  });
});
