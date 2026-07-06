import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { History } from '../src/components/history/index.js';
import type { HistoryEntry } from '../src/components/history/types.js';

describe('Issue 005 — resumed history rendering', () => {
  it('renders restored user and assistant entries as visible history output', () => {
    const entries: HistoryEntry[] = [
      { id: 1, kind: 'user', text: 'restore this question' },
      { id: 2, kind: 'assistant', text: 'restored answer text' },
    ];

    const { lastFrame, unmount } = render(
      React.createElement(History, {
        entries,
        generation: 1,
        streamingText: '',
        toolStream: null,
        setSuggestions: vi.fn(),
        autonomyMode: 'off',
        todos: [],
      }),
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('USER');
    expect(frame).toContain('ASSISTANT');
    expect(frame).toContain('restore this question');
    expect(frame).toContain('restored answer text');

    unmount();
  });

  it('renders restored tool entries alongside resumed history output', () => {
    const entries: HistoryEntry[] = [
      { id: 1, kind: 'user', text: 'inspect file' },
      { id: 2, kind: 'assistant', text: 'running read now' },
      {
        id: 3,
        kind: 'tool',
        name: 'read',
        durationMs: 42,
        ok: true,
        input: { path: 'src/example.ts' },
        output: 'export const answer = 42;',
        outputBytes: 25,
        outputLines: 1,
      },
    ];

    const { lastFrame, unmount } = render(
      React.createElement(History, {
        entries,
        generation: 1,
        streamingText: '',
        toolStream: null,
        setSuggestions: vi.fn(),
        autonomyMode: 'off',
        todos: [],
      }),
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('inspect file');
    expect(frame).toContain('running read now');
    expect(frame).toContain('read');
    expect(frame).toContain('src/example.ts');

    unmount();
  });
});
