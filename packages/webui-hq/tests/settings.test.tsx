/** @vitest-environment jsdom */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsView } from '../src/views/settings.js';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe('HQ Security view', () => {
  it('enables password login through the authenticated API', async () => {
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/auth/status')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              tokenMode: true,
              passwordMode: false,
              loggedIn: true,
              authKind: 'token',
              publicRelay: true,
              publicOrigin: 'https://quiet-river.trycloudflare.com',
              secureCookies: true,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      if (url.includes('/api/auth/password') && init?.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ tokenMode: true, passwordMode: true, loggedIn: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(SettingsView));
      await Promise.resolve();
      await Promise.resolve();
    });

    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="password"]');
    expect(inputs).toHaveLength(2);
    expect(container.textContent).toContain('Public tunnel');
    expect(container.textContent).toContain('Active');
    await act(async () => {
      setInput(inputs[0]!, 'browser-password');
      setInput(inputs[1]!, 'browser-password');
    });

    const save = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Enable password'),
    );
    expect(save?.disabled).toBe(false);
    await act(async () => {
      save?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const passwordCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/api/auth/password'),
    );
    expect(passwordCall?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(passwordCall?.[1]?.body))).toEqual({
      newPassword: 'browser-password',
    });
    expect(container.textContent).toContain('Password enabled.');
  });
});
