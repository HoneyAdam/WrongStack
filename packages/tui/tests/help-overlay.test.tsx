import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { helpSections, HelpOverlay } from '../src/components/help-overlay.js';

describe('helpSections', () => {
  it('returns all sections with entries', () => {
    const sections = helpSections();
    expect(sections.length).toBeGreaterThanOrEqual(5);
    const titles = sections.map((s) => s.title);
    expect(titles).toContain('Navigation');
    expect(titles).toContain('Monitors');
    expect(titles).toContain('Editing');
    expect(titles).toContain('Commands');
    expect(titles).toContain('Settings');
    expect(titles).toContain('Tool Colors');
  });

  it('Navigation section has arrow key entries', () => {
    const sections = helpSections();
    const nav = sections.find((s) => s.title === 'Navigation')!;
    expect(nav.entries.length).toBeGreaterThanOrEqual(2);
    expect(nav.entries.some((e) => e.keys.includes('↑'))).toBe(true);
  });

  it('Monitors section has Esc entry', () => {
    const sections = helpSections();
    const monitors = sections.find((s) => s.title === 'Monitors')!;
    expect(monitors.entries.some((e) => e.keys === 'Esc')).toBe(true);
  });

  it('Editing section has Enter and other keys', () => {
    const sections = helpSections();
    const editing = sections.find((s) => s.title === 'Editing')!;
    expect(editing.entries.length).toBeGreaterThan(3);
    expect(editing.entries.some((e) => e.keys === 'Enter')).toBe(true);
  });

  it('Commands section has /help entry', () => {
    const sections = helpSections();
    const cmds = sections.find((s) => s.title === 'Commands')!;
    expect(cmds.entries.some((e) => e.keys === '/help')).toBe(true);
  });

  it('Settings section has many entries', () => {
    const sections = helpSections();
    const settings = sections.find((s) => s.title === 'Settings')!;
    expect(settings.entries.length).toBeGreaterThan(10);
  });

  it('Tool Colors section has legend entries', () => {
    const sections = helpSections();
    const tools = sections.find((s) => s.title === 'Tool Colors')!;
    expect(tools.entries.length).toBeGreaterThan(20);
    expect(tools.entries.some((e) => e.keys.includes('read/write'))).toBe(true);
    expect(tools.entries.some((e) => e.keys.includes('terminal'))).toBe(true);
  });
});

describe('HelpOverlay', () => {
  it('renders the header title', () => {
    const view = render(React.createElement(HelpOverlay));
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('Keyboard shortcuts');
    expect(frame).toContain('Esc to close');
    view.unmount();
  });

  it('renders all section headings', () => {
    const view = render(React.createElement(HelpOverlay));
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('Navigation');
    expect(frame).toContain('Monitors');
    expect(frame).toContain('Editing');
    expect(frame).toContain('Commands');
    expect(frame).toContain('Settings');
    expect(frame).toContain('Tool Colors');
    view.unmount();
  });

  it('renders key entries with descriptions', () => {
    const view = render(React.createElement(HelpOverlay));
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('↑/↓');
    expect(frame).toContain('previous / next input');
    view.unmount();
  });

  it('renders the tool color section with entries', () => {
    const view = render(React.createElement(HelpOverlay));
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('read/write');
    expect(frame).toContain('terminal');
    view.unmount();
  });

  it('renders without crashing for any terminal width', () => {
    const view = render(React.createElement(HelpOverlay));
    expect(view.lastFrame()?.length).toBeGreaterThan(50);
    view.unmount();
  });
});
