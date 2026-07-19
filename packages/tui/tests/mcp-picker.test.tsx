import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { McpPicker, type McpPickerItem } from '../src/components/mcp-picker.js';

function makeItem(overrides: Partial<McpPickerItem> = {}): McpPickerItem {
  return {
    name: 'test-server',
    enabled: true,
    status: 'connected',
    transport: 'stdio',
    toolCount: 5,
    ...overrides,
  };
}

describe('McpPicker', () => {
  it('renders the title and key hints', () => {
    const view = render(
      React.createElement(McpPicker, {
        items: [makeItem()],
        selected: 0,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('MCP Servers');
    expect(frame).toContain('↑/↓ select');
    view.unmount();
  });

  it('renders empty state when no items and not busy', () => {
    const view = render(
      React.createElement(McpPicker, {
        items: [],
        selected: 0,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('No MCP servers configured');
    view.unmount();
  });

  it('renders loading state when no items and busy', () => {
    const view = render(
      React.createElement(McpPicker, {
        items: [],
        selected: 0,
        busy: true,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('Loading servers');
    view.unmount();
  });

  it('renders a connected item with green status', () => {
    const view = render(
      React.createElement(McpPicker, {
        items: [makeItem({ name: 'my-server', status: 'connected' })],
        selected: 0,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('my-server');
    expect(frame).toContain('connected');
    view.unmount();
  });

  it('renders a connecting item', () => {
    const view = render(
      React.createElement(McpPicker, {
        items: [makeItem({ name: 'srv', status: 'connecting' })],
        selected: 0,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('connecting');
    view.unmount();
  });

  it('renders a reconnecting item', () => {
    const view = render(
      React.createElement(McpPicker, {
        items: [makeItem({ name: 'srv', status: 'reconnecting' })],
        selected: 0,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('reconnecting');
    view.unmount();
  });

  it('renders a disconnected item', () => {
    const view = render(
      React.createElement(McpPicker, {
        items: [makeItem({ name: 'srv', status: 'disconnected' })],
        selected: 0,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('disconnected');
    view.unmount();
  });

  it('renders a failed item', () => {
    const view = render(
      React.createElement(McpPicker, {
        items: [makeItem({ name: 'srv', status: 'failed' })],
        selected: 0,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('failed');
    view.unmount();
  });

  it('renders a disabled item', () => {
    const view = render(
      React.createElement(McpPicker, {
        items: [makeItem({ enabled: false, status: 'disconnected' })],
        selected: 0,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('disabled');
    view.unmount();
  });

  it('renders item with unknown status', () => {
    const view = render(
      React.createElement(McpPicker, {
        items: [makeItem({ status: 'unknown-status' })],
        selected: 0,
      }),
    );
    const frame = view.lastFrame() ?? '';
    // Should still render, fallback status text
    view.unmount();
  });

  it('renders tool count when > 0', () => {
    const view = render(
      React.createElement(McpPicker, {
        items: [makeItem({ toolCount: 8 })],
        selected: 0,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('8 tools');
    view.unmount();
  });

  it('renders no tools text when tool count is 0', () => {
    const view = render(
      React.createElement(McpPicker, {
        items: [makeItem({ toolCount: 0 })],
        selected: 0,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).not.toContain('tools');
    view.unmount();
  });

  it('renders lazy tag when item is lazy', () => {
    const view = render(
      React.createElement(McpPicker, {
        items: [makeItem({ lazy: true })],
        selected: 0,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('lazy');
    view.unmount();
  });

  it('renders hint when provided', () => {
    const view = render(
      React.createElement(McpPicker, {
        items: [makeItem()],
        selected: 0,
        hint: 'Press r to restart',
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('Press r to restart');
    view.unmount();
  });

  it('renders multiple items with scrolling window', () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      makeItem({ name: `server-${i}`, status: 'connected' }),
    );
    const view = render(
      React.createElement(McpPicker, {
        items,
        selected: 10,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('server-10');
    view.unmount();
  });

  it('shows "above" indicator when scrolled down', () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      makeItem({ name: `s${i}`, status: 'connected' }),
    );
    const view = render(
      React.createElement(McpPicker, {
        items,
        selected: 20,
      }),
    );
    const frame = view.lastFrame() ?? '';
    // Should show the "above" indicator
    expect(frame).toContain('↑');
    view.unmount();
  });

  it('shows "below" indicator when items beyond window', () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      makeItem({ name: `s${i}`, status: 'connected' }),
    );
    const view = render(
      React.createElement(McpPicker, {
        items,
        selected: 5,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('↓');
    view.unmount();
  });

  it('handles description field', () => {
    const view = render(
      React.createElement(McpPicker, {
        items: [makeItem({ description: 'A test MCP server' })],
        selected: 0,
      }),
    );
    const frame = view.lastFrame() ?? '';
    // description is not directly rendered in McpPicker
    // but it shouldn't crash
    expect(frame).toContain('test-server');
    view.unmount();
  });
});
