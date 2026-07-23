import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { ToolCard } from '../src/components/history/tool-card.js';
import {
  estimateRenderGroupRows,
  ToolGroup,
  type ToolGroupData,
} from '../src/components/history/tool-group.js';
import { Text } from '../src/ink.js';
import { displayWidth } from '../src/terminal-width.js';

describe('<ToolCard /> frame', () => {
  it('leaves the top row blank after a failed tool summary', () => {
    const { lastFrame, unmount } = render(
      React.createElement(
        ToolCard,
        {
          glyph: '▤',
          color: 'blue',
          title: 'read',
          detail: 'src/a.ts',
          meta: '13ms',
          ok: false,
          termWidth: 80,
          hasBody: true,
        },
        React.createElement(Text, null, 'result'),
      ),
    );
    const lines = (lastFrame() ?? '').split('\n');
    const top = lines[0]?.trimEnd() ?? '';
    const bottom = lines.at(-1)?.trimEnd() ?? '';
    unmount();

    expect(top).toContain('read');
    expect(top).toContain('13ms');
    expect(top.match(/─/g)).toHaveLength(1);
    expect(displayWidth(bottom)).toBe(80);
  });
});

describe('estimateRenderGroupRows', () => {
  it('uses width-aware bounded estimates for text entries', () => {
    const short = estimateRenderGroupRows(
      { type: 'single', entry: { id: 1, kind: 'assistant', text: 'short' } },
      80,
    );
    const wrapped = estimateRenderGroupRows(
      { type: 'single', entry: { id: 2, kind: 'assistant', text: 'x'.repeat(400) } },
      40,
    );
    const bounded = estimateRenderGroupRows(
      { type: 'single', entry: { id: 3, kind: 'assistant', text: 'x\n'.repeat(10_000) } },
      40,
    );

    expect(short).toBe(3);
    expect(wrapped).toBeGreaterThan(short);
    expect(bounded).toBe(202);
  });

  it('bounds structured diff estimates and keeps compact groups count-based', () => {
    const diffEstimate = estimateRenderGroupRows(
      {
        type: 'single',
        entry: {
          id: 1,
          kind: 'tool',
          name: 'edit',
          durationMs: 1,
          ok: true,
          output: '+line\n'.repeat(10_000),
        },
      },
      80,
    );
    const data: ToolGroupData = {
      name: 'read',
      totalDurationMs: 2,
      okCount: 2,
      failCount: 0,
      entries: [
        { id: 2, kind: 'tool', name: 'read', durationMs: 1, ok: true },
        { id: 3, kind: 'tool', name: 'read', durationMs: 1, ok: true },
      ],
    };

    expect(diffEstimate).toBe(203);
    expect(estimateRenderGroupRows({ type: 'tool-group', data }, 80)).toBe(4);
  });
});

describe('<ToolGroup /> frame', () => {
  it('leaves the top row blank after a failed group summary', () => {
    const data: ToolGroupData = {
      name: 'read',
      totalDurationMs: 35,
      okCount: 2,
      failCount: 1,
      entries: [
        { id: 1, kind: 'tool', name: 'read', durationMs: 13, ok: true, input: { path: 'a.ts' } },
        { id: 2, kind: 'tool', name: 'read', durationMs: 9, ok: false, input: { path: 'b.ts' } },
        { id: 3, kind: 'tool', name: 'read', durationMs: 13, ok: true, input: { path: 'c.ts' } },
      ],
    };

    const { lastFrame, unmount } = render(React.createElement(ToolGroup, { data, termWidth: 80 }));
    const lines = (lastFrame() ?? '').split('\n');
    const top = lines[0]?.trimEnd() ?? '';
    const bottom = lines.at(-1)?.trimEnd() ?? '';
    unmount();

    expect(top).toContain('read ×3');
    expect(top).toContain('✗1');
    expect(top.match(/─/g)).toHaveLength(1);
    expect(displayWidth(bottom)).toBe(80);
  });

  it('shows the useful argument detail for every grouped call', () => {
    const data: ToolGroupData = {
      name: 'codebase-search',
      totalDurationMs: 18,
      okCount: 3,
      failCount: 0,
      entries: [
        {
          id: 1,
          kind: 'tool',
          name: 'codebase-search',
          durationMs: 5,
          ok: true,
          input: { query: 'tool grouping', kind: 'function' },
        },
        {
          id: 2,
          kind: 'tool',
          name: 'codebase-search',
          durationMs: 6,
          ok: true,
          input: { query: 'history renderer', lang: 'ts' },
        },
        {
          id: 3,
          kind: 'tool',
          name: 'codebase-search',
          durationMs: 7,
          ok: true,
          input: { query: 'format arguments', file: 'packages/tui/src/components/history' },
        },
      ],
    };

    const { lastFrame, unmount } = render(React.createElement(ToolGroup, { data, termWidth: 100 }));
    const frame = lastFrame() ?? '';
    unmount();

    expect(frame).toContain('codebase-search ×3');
    expect(frame).toContain('"tool grouping" · function');
    expect(frame).toContain('"history renderer" · ts');
    expect(frame).toContain('"format arguments" · in');
  });

  it('uses the generic argument fallback for grouped extension tools', () => {
    const data: ToolGroupData = {
      name: 'custom-tool',
      totalDurationMs: 2,
      okCount: 2,
      failCount: 0,
      entries: [
        {
          id: 1,
          kind: 'tool',
          name: 'custom-tool',
          durationMs: 1,
          ok: true,
          input: { query: 'first custom lookup' },
        },
        {
          id: 2,
          kind: 'tool',
          name: 'custom-tool',
          durationMs: 1,
          ok: true,
          input: { name: 'second target' },
        },
      ],
    };

    const { lastFrame, unmount } = render(React.createElement(ToolGroup, { data, termWidth: 80 }));
    const frame = lastFrame() ?? '';
    unmount();

    expect(frame).toContain('first custom lookup');
    expect(frame).toContain('second target');
  });
});
