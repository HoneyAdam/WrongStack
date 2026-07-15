// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolSidebar } from '../src/tool-sidebar.js';
import type { ToolCallInfo } from '../src/types.js';

const roots: Array<ReturnType<typeof createRoot>> = [];
const calls: ToolCallInfo[] = [
  {
    id: 'read-1',
    name: 'read',
    input: { path: 'src/app.tsx' },
    status: 'done',
    output: 'file content',
    ok: true,
    durationMs: 12,
  },
];

function click(element: Element): void {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

describe('SimpleUI floating tool sidebar', () => {
  it('does not render the panel until requested, then closes with Escape', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => root.render(<ToolSidebar agentId="worker-1" agentName="WORKER" calls={calls} />));

    const trigger = container.querySelector('.tool-sidebar-trigger');
    expect(trigger).not.toBeNull();
    expect(container.querySelector('#tool-sidebar')).toBeNull();

    act(() => click(trigger as Element));
    const panel = container.querySelector<HTMLElement>('#tool-sidebar');
    expect(panel?.dataset['agentId']).toBe('worker-1');
    expect(panel?.textContent).toContain('read');

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(container.querySelector('#tool-sidebar')).toBeNull();
  });

  it('shows tool input/output only after expanding a call', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => root.render(<ToolSidebar agentId="leader" agentName="LEADER" calls={calls} />));

    const trigger = container.querySelector('.tool-sidebar-trigger');
    act(() => click(trigger as Element));
    expect(container.textContent).not.toContain('src/app.tsx');

    const callTrigger = container.querySelector('.tool-sidebar-call-trigger');
    act(() => click(callTrigger as Element));
    expect(container.textContent).toContain('src/app.tsx');
    expect(container.textContent).toContain('file content');
  });
});
