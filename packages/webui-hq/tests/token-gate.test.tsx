/** @vitest-environment jsdom */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TokenGate } from '../src/views/token-gate.js';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe('HQ token gate', () => {
  it('prefers password login when password and token modes are both enabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ tokenMode: true, passwordMode: true, loggedIn: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(TokenGate, { hadToken: false }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Password required');
    expect(container.querySelector<HTMLInputElement>('input')?.autocomplete).toBe(
      'current-password',
    );
  });
});
