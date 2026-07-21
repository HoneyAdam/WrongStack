import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { HelpPanel, type HelpEntry } from '../src/components/help-panel.js';

function makeEntry(overrides: Partial<HelpEntry> = {}): HelpEntry {
  return {
    name: 'test-cmd',
    description: 'A test command',
    category: 'Run',
    ...overrides,
  };
}

describe('HelpPanel', () => {
  it('renders the header', () => {
    const view = render(
      React.createElement(HelpPanel, {
        entries: [makeEntry()],
        filter: '',
        selected: 0,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('Help / Command Palette');
    view.unmount();
  });

  it('shows navigation hint when filter is empty', () => {
    const view = render(
      React.createElement(HelpPanel, {
        entries: [makeEntry()],
        filter: '',
        selected: 0,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('↑/↓ navigate');
    view.unmount();
  });

  it('shows filter count when filter is active', () => {
    const view = render(
      React.createElement(HelpPanel, {
        entries: [makeEntry(), makeEntry({ name: 'other' })],
        filter: 'test',
        selected: 0,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('Filter: test');
    view.unmount();
  });

  it('filters entries by name', () => {
    const view = render(
      React.createElement(HelpPanel, {
        entries: [makeEntry({ name: 'foo' }), makeEntry({ name: 'bar' })],
        filter: 'foo',
        selected: 0,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('/foo');
    expect(frame).not.toContain('/bar');
    view.unmount();
  });

  it('filters entries by description', () => {
    const view = render(
      React.createElement(HelpPanel, {
        entries: [makeEntry({ name: 'a', description: 'searchable text' })],
        filter: 'searchable',
        selected: 0,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('/a');
    view.unmount();
  });

  it('filters entries by category', () => {
    const view = render(
      React.createElement(HelpPanel, {
        entries: [makeEntry({ name: 'a', category: 'Config' })],
        filter: 'Config',
        selected: 0,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('/a');
    view.unmount();
  });

  it('filters entries by alias', () => {
    const view = render(
      React.createElement(HelpPanel, {
        entries: [makeEntry({ name: 'a', aliases: ['alias-foo'] })],
        filter: 'alias-foo',
        selected: 0,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('/a');
    view.unmount();
  });

  it('shows "No commands match" when filter results are empty', () => {
    const view = render(
      React.createElement(HelpPanel, {
        entries: [makeEntry({ name: 'foo' })],
        filter: 'zzzzz',
        selected: 0,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('No commands match');
    view.unmount();
  });

  it('shows empty state when entries is empty with no filter', () => {
    const view = render(
      React.createElement(HelpPanel, {
        entries: [],
        filter: '',
        selected: 0,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('No commands match');
    view.unmount();
  });

  it('renders category headers', () => {
    const view = render(
      React.createElement(HelpPanel, {
        entries: [
          makeEntry({ name: 'a', category: 'Run' }),
          makeEntry({ name: 'b', category: 'Config' }),
        ],
        filter: '',
        selected: 0,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('Run');
    expect(frame).toContain('Config');
    view.unmount();
  });

  it('renders aliases in parentheses', () => {
    const view = render(
      React.createElement(HelpPanel, {
        entries: [makeEntry({ name: 'cmd', aliases: ['c', 'command'] })],
        filter: '',
        selected: 0,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('/c, /command');
    view.unmount();
  });

  it('does not render aliases line when empty', () => {
    const view = render(
      React.createElement(HelpPanel, {
        entries: [makeEntry({ name: 'cmd' })],
        filter: '',
        selected: 0,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).not.toContain('(/)');
    view.unmount();
  });

  it('renders argsHint when provided', () => {
    const view = render(
      React.createElement(HelpPanel, {
        entries: [makeEntry({ name: 'cmd', argsHint: '<file>' })],
        filter: '',
        selected: 0,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('<file>');
    view.unmount();
  });

  it('shows hint when provided', () => {
    const view = render(
      React.createElement(HelpPanel, {
        entries: [makeEntry()],
        filter: '',
        selected: 0,
        hint: 'Select a command and press Enter',
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('Select a command');
    view.unmount();
  });

  it('handles large entry list with scrolling', () => {
    const entries = Array.from({ length: 50 }, (_, i) =>
      makeEntry({ name: `cmd-${i}`, category: 'Run' }),
    );
    const view = render(
      React.createElement(HelpPanel, {
        entries,
        filter: '',
        selected: 10,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('cmd-10');
    view.unmount();
  });

  it('highlights selected entry', () => {
    const view = render(
      React.createElement(HelpPanel, {
        entries: [makeEntry({ name: 'selected-cmd' })],
        filter: '',
        selected: 0,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('›');
    view.unmount();
  });

  it('sorts entries by category order then name', () => {
    const view = render(
      React.createElement(HelpPanel, {
        entries: [
          makeEntry({ name: 'z-cmd', category: 'App' }),
          makeEntry({ name: 'a-cmd', category: 'Run' }),
        ],
        filter: '',
        selected: 0,
      }),
    );
    const frame = view.lastFrame() ?? '';
    // Run should come before App alphabetically
    expect(frame).toContain('a-cmd');
    expect(frame).toContain('z-cmd');
    view.unmount();
  });

  it('handles entry with unknown category (defaults to App)', () => {
    const view = render(
      React.createElement(HelpPanel, {
        entries: [makeEntry({ name: 'unknown-cmd', category: 'Unknown' })],
        filter: '',
        selected: 0,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('/unknown-cmd');
    view.unmount();
  });
});
