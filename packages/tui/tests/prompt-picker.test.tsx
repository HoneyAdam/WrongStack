import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { PromptPicker, type PromptPickEntry, filterPromptPicker } from '../src/components/prompt-picker.js';

const entries: PromptPickEntry[] = [
  { slug: 'test', title: 'Write tests', description: 'Create unit tests', category: 'testing', source: 'project', content: 'Write tests for...', favorite: false },
  { slug: 'fix', title: 'Fix bug', description: 'Debug and fix', category: 'debug', source: 'user', content: 'Fix the bug...', favorite: true },
  { slug: 'refactor', title: 'Refactor', description: 'Clean up code', category: 'testing', source: 'synced', content: 'Refactor...', favorite: false },
];

describe('filterPromptPicker', () => {
  it('returns all when category is "all"', () => {
    expect(filterPromptPicker(entries, ['all'], 0)).toEqual(entries);
  });

  it('filters by category when catIndex points to a specific category', () => {
    const result = filterPromptPicker(entries, ['all', 'testing', 'debug'], 2);
    expect(result).toHaveLength(1);
    expect(result.every((e) => e.category === 'debug')).toBe(true);
  });

  it('filters by "★ favorites"', () => {
    const result = filterPromptPicker(entries, ['all', '★ favorites'], 1);
    expect(result).toHaveLength(1);
    expect(result[0]!.slug).toBe('fix');
  });

  it('filters by "🕘 recent" order', () => {
    const result = filterPromptPicker(entries, ['all', '🕘 recent'], 1, ['refactor', 'test']);
    expect(result).toHaveLength(2);
    expect(result[0]!.slug).toBe('refactor');
    expect(result[1]!.slug).toBe('test');
  });

  it('returns empty for recent slugs with no matches', () => {
    const result = filterPromptPicker(entries, ['all', '🕘 recent'], 1, ['nonexistent']);
    expect(result).toHaveLength(0);
  });

  it('filters by specific category', () => {
    const result = filterPromptPicker(entries, ['all', 'testing', 'debug'], 1);
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.category === 'testing')).toBe(true);
  });

  it('returns empty array for empty input', () => {
    const result = filterPromptPicker([], ['all'], 0);
    expect(result).toEqual([]);
  });
});

describe('PromptPicker', () => {
  it('renders title with category and count', () => {
    const view = render(
      React.createElement(PromptPicker, {
        entries,
        selected: 0,
        category: 'all',
        total: 3,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('Prompt library');
    expect(frame).toContain('all');
    expect(frame).toContain('3/3');
    view.unmount();
  });

  it('renders key hints', () => {
    const view = render(
      React.createElement(PromptPicker, {
        entries,
        selected: 0,
        category: 'all',
        total: 3,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('↑/↓ navigate');
    expect(frame).toContain('Enter insert');
    view.unmount();
  });

  it('renders all entries with titles', () => {
    const view = render(
      React.createElement(PromptPicker, {
        entries,
        selected: 0,
        category: 'all',
        total: 3,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('Write tests');
    expect(frame).toContain('Fix bug');
    expect(frame).toContain('Refactor');
    view.unmount();
  });

  it('shows empty message when no entries', () => {
    const view = render(
      React.createElement(PromptPicker, {
        entries: [],
        selected: 0,
        category: 'all',
        total: 0,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('No prompts in this category');
    view.unmount();
  });

  it('highlights selected entry', () => {
    const view = render(
      React.createElement(PromptPicker, {
        entries,
        selected: 0,
        category: 'all',
        total: 3,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('›');
    view.unmount();
  });

  it('shows favorite star for favorited entries', () => {
    const view = render(
      React.createElement(PromptPicker, {
        entries,
        selected: 1,
        category: 'all',
        total: 3,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('★');
    view.unmount();
  });

  it('shows correct source glyphs', () => {
    const allSources: PromptPickEntry[] = [
      { slug: 'a', title: 'Proj', description: 'x', category: 'test', source: 'project', content: 'x', favorite: false },
      { slug: 'b', title: 'User', description: 'x', category: 'test', source: 'user', content: 'x', favorite: false },
      { slug: 'c', title: 'Sync', description: 'x', category: 'test', source: 'synced', content: 'x', favorite: false },
      { slug: 'd', title: 'Def', description: 'x', category: 'test', source: 'other', content: 'x', favorite: false },
    ];
    const view = render(
      React.createElement(PromptPicker, {
        entries: allSources,
        selected: 0,
        category: 'all',
        total: 4,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('📁');
    expect(frame).toContain('👤');
    expect(frame).toContain('☁');
    expect(frame).toContain('📦');
    view.unmount();
  });

  it('handles many entries with window scrolling', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      slug: `e${i}`, title: `Entry ${i}`, description: `desc ${i}`,
      category: 'test', source: 'project' as const, content: 'x', favorite: false,
    }));
    const view = render(
      React.createElement(PromptPicker, {
        entries: many,
        selected: 15,
        category: 'all',
        total: 20,
      }),
    );
    const frame = view.lastFrame() ?? '';
    expect(frame).toContain('Entry 15');
    view.unmount();
  });
});
