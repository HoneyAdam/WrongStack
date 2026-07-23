/**
 * HQ shell contract tests. These pin the operator navigation model and mount
 * the real shell once so unstable Zustand selectors cannot regress into a
 * React getSnapshot/update-depth crash unnoticed.
 *
 * @vitest-environment jsdom
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { HqSnapshot } from '@wrongstack/core/hq';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getHqViewDefinition, HQ_VIEW_DEFINITIONS, HqApp } from '../src/app.js';
import { useHqStore } from '../src/store.js';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function emptySnapshot(): HqSnapshot {
  return {
    generatedAt: '2026-07-14T12:00:00.000Z',
    clients: [],
    projects: [],
    sessions: [],
    fleets: [],
    mailboxes: [],
    totals: {
      activeProjects: 0,
      activeClients: 0,
      activeSessions: 0,
      activeSubagents: 0,
      unreadMailboxMessages: 0,
      incompleteMailboxMessages: 0,
      totalCostUsd: 0,
    },
  };
}

afterEach(() => {
  if (root !== null) {
    act(() => root?.unmount());
  }
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useHqStore.setState({
    snapshot: null,
    alerts: [],
    events: [],
    commandStatuses: [],
    activeView: 'cockpit',
    connected: false,
    authRequired: false,
  });
});

describe('HQ operator shell', () => {
  it('defines unique ids and non-conflicting numeric shortcuts', () => {
    expect(HQ_VIEW_DEFINITIONS).toHaveLength(12);
    expect(new Set(HQ_VIEW_DEFINITIONS.map((view) => view.id)).size).toBe(12);
    const shortcuts = HQ_VIEW_DEFINITIONS.flatMap((view) =>
      view.shortcut === undefined ? [] : [view.shortcut],
    );
    expect(shortcuts).toHaveLength(10);
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
    expect(HQ_VIEW_DEFINITIONS.map((view) => view.group)).toEqual(
      expect.arrayContaining(['Operations', 'Intelligence', 'System']),
    );
    expect(getHqViewDefinition('fleet').label).toBe('Fleet Map');
  });

  it('mounts the real shell with one square navigation surface', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(emptySnapshot()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(HqApp));
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="hq-workbench"]')).not.toBeNull();
    expect(container.querySelector('.hq-activity-rail')).toBeNull();
    expect(container.querySelector('.hq-secondary-nav')).not.toBeNull();
    expect(container.querySelector<HTMLImageElement>('.hq-secondary-brand img')?.src).toContain(
      '/wrongstack.svg',
    );
    expect(container.querySelectorAll('.hq-nav-item')).toHaveLength(12);
    expect(container.textContent).toContain('WrongStack HQ');
  });

  it('shows an actionable warning when a newer npm package exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = String(input);
        const body = url.includes('/api/system/update')
          ? {
              current: '1.2.3',
              latest: '1.3.0',
              outdated: true,
              checkFailed: false,
              packageName: 'wrongstack',
              command: 'wstack update',
            }
          : url.includes('/api/auth/status')
            ? { tokenMode: true, passwordMode: true, loggedIn: true }
            : emptySnapshot();
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }),
    );
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(HqApp));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('.hq-update-notice')).not.toBeNull();
    expect(container.textContent).toContain('v1.2.3 → v1.3.0');
    expect(container.textContent).toContain('wstack update');
    expect(container.querySelector('[aria-label="Log out of HQ"]')).not.toBeNull();
  });
});
