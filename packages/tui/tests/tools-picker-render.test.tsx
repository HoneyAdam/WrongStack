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
  it('keeps passive tools visible in-place and renders category as row metadata', () => {
    const { lastFrame, unmount } = render(
      React.createElement(ToolsPicker, {
        items: [
          item({ name: 'read', category: 'filesystem' }),
          item({ name: 'write', category: 'filesystem', enabled: false, mutating: true, permission: 'confirm', description: 'Write file contents.' }),
          item({ name: 'grep', category: 'search' }),
        ],
        selected: 1,
      }),
    );

    const frame = lastFrame() ?? '';
    const readIndex = frame.indexOf('read');
    const writeIndex = frame.indexOf('write');
    const grepIndex = frame.indexOf('grep');
    expect(readIndex).toBeGreaterThanOrEqual(0);
    expect(writeIndex).toBeGreaterThan(readIndex);
    expect(grepIndex).toBeGreaterThan(writeIndex);
    expect(frame).toContain('○ passive');
    expect(frame).toContain('2 active / 1 passive');
    expect(frame).toContain('Passive tools stay listed for this session');
    expect(frame).toContain('Enter re-enables this tool');
    expect(frame).toContain('Write file contents.');
    expect(frame).toMatch(/write\s+Filesystem\s+\[core\]/);
    expect(frame).not.toMatch(/\n\s+Filesystem\s*\n/);
    expect(frame).not.toMatch(/\n\s+Search\s*\n/);
    unmount();
  });

  it('truncates long columns before rendering the next column', () => {
    const { lastFrame, unmount } = render(
      React.createElement(ToolsPicker, {
        items: [
          item({
            name: 'dependency_audit_status_with_extra_suffix',
            category: 'diagnostics-with-a-very-long-label',
            owner: 'dependency-vulnerability-gate-owner-with-extra-suffix',
            permission: 'confirm-with-extra-suffix',
          }),
        ],
        selected: 0,
      }),
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('dependency_audit_status_wit…');
    expect(frame).toContain('Diagnostics-w…');
    expect(frame).toContain('[dependency-vulnera…');
    expect(frame).toContain('confirm…');
    expect(frame).toContain('ro');
    expect(frame).toContain('desc:e…');
    unmount();
  });
});
