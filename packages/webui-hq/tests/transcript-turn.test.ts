/**
 * Render tests for the HQ Live Console transcript turns — verifies each role
 * maps to the right chat surface (markdown assistant bubbles, thinking cards,
 * tool cards with real result views) through real DOM interaction.
 *
 * @vitest-environment jsdom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { HqTranscriptEntry } from '@wrongstack/core/hq';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { TranscriptTurn } from '../src/views/transcript-turn.js';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(entry: HqTranscriptEntry): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(createElement(TranscriptTurn, { entry }));
  });
  return container;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
});

function entry(partial: Partial<HqTranscriptEntry>): HqTranscriptEntry {
  return { ts: '2026-07-08T10:00:00Z', role: 'assistant', text: '', ...partial };
}

describe('TranscriptTurn', () => {
  it('renders a user bubble with the message text', () => {
    const el = mount(entry({ role: 'user', text: 'hello there' }));
    expect(el.querySelector('.hq-chat-bubble.user')?.textContent).toContain('hello there');
  });

  it('renders assistant markdown: fenced code + GFM structure', () => {
    const el = mount(
      entry({
        role: 'assistant',
        text: 'before\n```ts\nconst x = 1;\n```\n- item one\n- item two\n\n**bold** after',
      }),
    );
    const code = el.querySelector('.hq-md-code pre code');
    expect(code?.textContent).toContain('const x = 1;');
    expect(el.querySelector('.hq-md-code-lang')?.textContent).toBe('ts');
    expect(el.querySelectorAll('.hq-md li')).toHaveLength(2);
    expect(el.querySelector('.hq-md strong')?.textContent).toBe('bold');
    expect(el.textContent).toContain('before');
  });

  it('renders a GFM table inside a scroll wrapper', () => {
    const el = mount(entry({ role: 'assistant', text: '| a | b |\n| --- | --- |\n| 1 | 2 |' }));
    expect(el.querySelector('.hq-md-table-wrap table')).not.toBeNull();
    expect(el.textContent).toContain('1');
  });

  it('renders a thinking turn collapsed with a peek line, expanding on click', () => {
    const el = mount(entry({ role: 'thinking', text: 'first thought\nsecond thought' }));
    expect(el.querySelector('.hq-thinking-peek')?.textContent).toBe('first thought');
    expect(el.querySelector('.hq-thinking-body')).toBeNull();
    act(() =>
      el
        .querySelector<HTMLButtonElement>('.hq-thinking-head')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    expect(el.querySelector('.hq-thinking-body')?.textContent).toContain('second thought');
  });

  it('renders an error turn with the error styling', () => {
    const el = mount(entry({ role: 'error', text: 'boom', isError: true }));
    expect(el.querySelector('.hq-chat-bubble.error')).not.toBeNull();
    expect(el.textContent).toContain('boom');
  });

  it('renders a failed tool call (role error + toolInput) as an error tool card', () => {
    const el = mount(
      entry({
        role: 'error',
        tool: 'bash',
        toolInput: '{"command":"x"}',
        text: 'nope',
        isError: true,
      }),
    );
    expect(el.querySelector('.hq-chat-turn.tool.err')).not.toBeNull();
    expect(el.querySelector('.hq-status-err')).not.toBeNull();
  });

  it('collapses a tool card by default and expands on click into a diff', () => {
    const input = JSON.stringify({ file_path: 'a.ts', old_string: 'a', new_string: 'b' });
    const el = mount(
      entry({ role: 'tool', tool: 'edit', toolInput: input, text: 'ok', durationMs: 1200 }),
    );
    // Header always shows the tool name + summary; body hidden until expanded.
    expect(el.querySelector('.hq-tool-name')?.textContent).toBe('edit');
    expect(el.querySelector('.hq-tool-dur')?.textContent).toBe('1.2s');
    expect(el.querySelector('.hq-tool-body')).toBeNull();

    const head = el.querySelector<HTMLButtonElement>('.hq-tool-head');
    act(() => head!.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(el.querySelector('.hq-tool-body')).not.toBeNull();
    expect(el.querySelector('.hq-diff-line.del')?.textContent).toContain('a');
    expect(el.querySelector('.hq-diff-line.add')?.textContent).toContain('b');
  });

  it('renders bash output with an exit-code-aware terminal view when expanded', () => {
    const el = mount(
      entry({
        role: 'tool',
        tool: 'bash',
        toolInput: '{"command":"ls"}',
        text: 'file1\nfile2\nexit code: 0',
      }),
    );
    const head = el.querySelector<HTMLButtonElement>('.hq-tool-head');
    act(() => head!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(el.querySelector('.hq-result-bash')?.textContent).toContain('file1');
    expect(el.querySelector('.hq-result-exit')?.textContent).toContain('exit code 0');
  });

  it('renders Read output (N→ lines) without wrapping, preserving line numbers', () => {
    const el = mount(
      entry({
        role: 'tool',
        tool: 'read',
        toolInput: '{"file_path":"a.ts"}',
        text: '1→const a = 1;\n2→const b = 2;',
      }),
    );
    act(() =>
      el
        .querySelector<HTMLButtonElement>('.hq-tool-head')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    expect(el.querySelector('.hq-result-pre.nowrap')?.textContent).toContain('1→const a = 1;');
  });

  it('renders a JSON result as a collapsible pretty view', () => {
    const el = mount(
      entry({
        role: 'tool',
        tool: 'mystery',
        toolInput: '{"q":1}',
        text: '{"answer":42}',
      }),
    );
    act(() =>
      el
        .querySelector<HTMLButtonElement>('.hq-tool-head')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    // Short JSON auto-expands.
    expect(el.querySelector('.hq-result-jsonbar')?.textContent).toContain('JSON');
    expect(el.querySelector('.hq-result-pre')?.textContent).toContain('"answer": 42');
  });

  it('renders a TodoWrite tool as a checklist when expanded', () => {
    const input = JSON.stringify({
      todos: [
        { status: 'completed', content: 'first' },
        { status: 'in_progress', content: 'second' },
      ],
    });
    const el = mount(entry({ role: 'tool', tool: 'TodoWrite', toolInput: input, text: '' }));
    act(() =>
      el
        .querySelector<HTMLButtonElement>('.hq-tool-head')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    const items = el.querySelectorAll('.hq-todo');
    expect(items).toHaveLength(2);
    expect(el.querySelector('.hq-todo.completed')?.textContent).toContain('first');
    expect(el.querySelector('.hq-todo.in_progress')?.textContent).toContain('second');
    // Raw JSON input view is replaced by the checklist.
    expect(el.querySelector('.hq-tool-pre')).toBeNull();
  });

  it('shows the file path in the diff caption', () => {
    const input = JSON.stringify({ file_path: 'src/x.ts', old_string: 'a', new_string: 'b' });
    const el = mount(entry({ role: 'tool', tool: 'edit', toolInput: input, text: 'ok' }));
    act(() =>
      el
        .querySelector<HTMLButtonElement>('.hq-tool-head')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    expect(el.querySelector('.hq-diff-path')?.textContent).toContain('src/x.ts');
  });

  it('shows a running indicator for a tool call with no result yet', () => {
    const el = mount(
      entry({ role: 'tool', tool: 'bash', toolInput: '{"command":"sleep 5"}', text: '' }),
    );
    expect(el.querySelector('.hq-tool-running-dot')).not.toBeNull();
    expect(el.querySelector('.hq-status-ok')).toBeNull();
  });

  it('marks a failed tool card with the error status icon', () => {
    const el = mount(
      entry({
        role: 'tool',
        tool: 'bash',
        toolInput: '{"command":"x"}',
        text: 'nope',
        isError: true,
      }),
    );
    expect(el.querySelector('.hq-status-err')).not.toBeNull();
  });

  it('drops empty system turns', () => {
    const el = mount(entry({ role: 'system', text: '   ' }));
    expect(el.textContent).toBe('');
  });
});
