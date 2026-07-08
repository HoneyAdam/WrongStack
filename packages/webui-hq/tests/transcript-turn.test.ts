/**
 * Render tests for the HQ Live Console transcript turns — verifies each role
 * maps to the right chat surface and that tool cards expand into real result
 * views (diff for edit, terminal for bash) through real DOM interaction.
 *
 * @vitest-environment jsdom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { HqTranscriptEntry } from '@wrongstack/core';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { splitFences, TranscriptTurn } from '../src/views/transcript-turn.js';

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

  it('renders assistant fenced code as a code block', () => {
    const el = mount(entry({ role: 'assistant', text: 'before\n```ts\nconst x = 1;\n```\nafter' }));
    const code = el.querySelector('.hq-chat-code code');
    expect(code?.textContent).toBe('const x = 1;');
    expect(el.querySelector('.hq-chat-code-lang')?.textContent).toBe('ts');
    expect(el.textContent).toContain('before');
    expect(el.textContent).toContain('after');
  });

  it('renders an error turn with the error styling', () => {
    const el = mount(entry({ role: 'error', text: 'boom', isError: true }));
    expect(el.querySelector('.hq-chat-bubble.error')).not.toBeNull();
    expect(el.textContent).toContain('boom');
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

  it('renders bash output in a terminal result view when expanded', () => {
    const el = mount(
      entry({ role: 'tool', tool: 'bash', toolInput: '{"command":"ls"}', text: 'file1\nfile2' }),
    );
    const head = el.querySelector<HTMLButtonElement>('.hq-tool-head');
    act(() => head!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(el.querySelector('.hq-tool-pre.term')?.textContent).toContain('file1');
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

  it('shows the file path in the diff header', () => {
    const input = JSON.stringify({ file_path: 'src/x.ts', old_string: 'a', new_string: 'b' });
    const el = mount(entry({ role: 'tool', tool: 'edit', toolInput: input, text: 'ok' }));
    act(() =>
      el
        .querySelector<HTMLButtonElement>('.hq-tool-head')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    expect(el.querySelector('.hq-diff-path')?.textContent).toBe('src/x.ts');
  });

  it('marks a failed tool card with the error dot', () => {
    const el = mount(
      entry({
        role: 'tool',
        tool: 'bash',
        toolInput: '{"command":"x"}',
        text: 'nope',
        isError: true,
      }),
    );
    expect(el.querySelector('.hq-tool-dot.err')).not.toBeNull();
  });

  it('drops empty system turns', () => {
    const el = mount(entry({ role: 'system', text: '   ' }));
    expect(el.textContent).toBe('');
  });
});

describe('splitFences', () => {
  it('splits prose and code segments', () => {
    const segs = splitFences('a\n```js\ncode\n```\nb');
    expect(segs).toEqual([
      { code: false, text: 'a\n' },
      { code: true, lang: 'js', text: 'code' },
      { code: false, text: '\nb' },
    ]);
  });

  it('returns a single prose segment when there is no fence', () => {
    expect(splitFences('just text')).toEqual([{ code: false, text: 'just text' }]);
  });
});
