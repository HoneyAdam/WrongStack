// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FinishedAgentsMenu } from '../src/finished-agents-menu.js';
import type { AgentTab } from '../src/lib/agent-model.js';

const roots: Array<ReturnType<typeof createRoot>> = [];

const finished: AgentTab[] = [
  { id: 'w2', name: 'W2', status: 'completed', isLeader: false, isActive: false },
  { id: 'w3', name: 'W3', status: 'idle', isLeader: false, isActive: false },
];

function click(element: Element): void {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function render(props: {
  agents?: AgentTab[];
  activeAgentId?: string;
  onSelect?: (id: string) => void;
}): { container: HTMLElement; onSelect: (id: string) => void } {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const onSelect = props.onSelect ?? vi.fn();
  act(() =>
    root.render(
      <FinishedAgentsMenu
        agents={props.agents ?? finished}
        activeAgentId={props.activeAgentId ?? 'leader'}
        onSelect={onSelect}
      />,
    ),
  );
  return { container, onSelect };
}

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

describe('FinishedAgentsMenu', () => {
  it('renders nothing when there are no finished agents', () => {
    const { container } = render({ agents: [] });
    expect(container.querySelector('.agent-finished')).toBeNull();
  });

  it('shows a toggle labelled with the finished count and keeps the menu closed initially', () => {
    const { container } = render({});
    const toggle = container.querySelector('.agent-finished-toggle');
    expect(toggle?.textContent).toContain('Finished (2)');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.agent-finished-menu')).toBeNull();
  });

  it('opens on click and lists every finished agent as a menuitem', () => {
    const { container } = render({});
    act(() => click(container.querySelector('.agent-finished-toggle') as Element));

    expect(container.querySelector('.agent-finished-toggle')?.getAttribute('aria-expanded')).toBe(
      'true',
    );
    const items = container.querySelectorAll('.agent-finished-item');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain('W2');
    expect(items[1]?.textContent).toContain('W3');
  });

  it('selecting an agent invokes onSelect and closes the menu', () => {
    const onSelect = vi.fn();
    const { container } = render({ onSelect });
    act(() => click(container.querySelector('.agent-finished-toggle') as Element));
    act(() => click(container.querySelectorAll('.agent-finished-item')[1] as Element));

    expect(onSelect).toHaveBeenCalledWith('w3');
    expect(container.querySelector('.agent-finished-menu')).toBeNull();
  });

  it('closes on Escape and returns focus to the toggle', () => {
    const { container } = render({});
    const toggle = container.querySelector('.agent-finished-toggle') as HTMLButtonElement;
    act(() => click(toggle));
    expect(container.querySelector('.agent-finished-menu')).not.toBeNull();

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));

    expect(container.querySelector('.agent-finished-menu')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });

  it('ignores non-Escape keys while open', () => {
    const { container } = render({});
    act(() => click(container.querySelector('.agent-finished-toggle') as Element));
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' })));
    expect(container.querySelector('.agent-finished-menu')).not.toBeNull();
  });

  it('closes when a pointerdown lands outside the menu', () => {
    const { container } = render({});
    act(() => click(container.querySelector('.agent-finished-toggle') as Element));
    expect(container.querySelector('.agent-finished-menu')).not.toBeNull();

    act(() => document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(container.querySelector('.agent-finished-menu')).toBeNull();
  });
});
