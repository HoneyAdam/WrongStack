/**
 * @vitest-environment jsdom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FleetChatDrawer } from '../src/views/fleet-chat-drawer.js';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Harness() {
  const [open, setOpen] = useState(false);
  return createElement(
    'div',
    null,
    createElement('button', { type: 'button', onClick: () => setOpen(true) }, 'Open chat'),
    open
      ? createElement(FleetChatDrawer, {
          target: {
            sessionId: 'session-1',
            agentId: null,
            label: 'Main terminal',
            status: 'active',
          },
          onClose: () => setOpen(false),
        })
      : null,
  );
}

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('FleetChatDrawer', () => {
  it('moves focus into the drawer, closes on Escape, and restores the trigger', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            sessionId: 'session-1',
            source: 'stream',
            total: 0,
            entries: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root?.render(createElement(Harness)));
    const trigger = container.querySelector<HTMLButtonElement>('button');
    expect(trigger).not.toBeNull();
    trigger?.focus();
    await act(async () => {
      trigger?.click();
      await Promise.resolve();
    });

    const close = container.querySelector<HTMLButtonElement>(
      '.hq-fleet-drawer button[aria-label="Close fleet transcript"]',
    );
    expect(document.activeElement).toBe(close);
    expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('false');

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));

    expect(container.querySelector('[data-testid="hq-fleet-chat-drawer"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
