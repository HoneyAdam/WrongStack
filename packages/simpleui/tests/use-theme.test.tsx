// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTheme } from '../src/hooks/use-theme.js';

/**
 * PR-1 safety net for `useTheme`. The hook was extracted verbatim from
 * `app.tsx` — these tests pin the contract so the next PR cannot regress it.
 *
 * The harness mirrors the existing `agent-chat-pane.test.tsx` pattern: real
 * `createRoot` + `act`, no extra testing-library dependency.
 *
 * Coverage:
 *  - Initial resolution: saved localStorage value wins; otherwise the OS
 *    `prefers-color-scheme: light` media query; otherwise `'dark'`.
 *  - DOM side-effects: `documentElement.dataset.theme` and
 *    `documentElement.style.colorScheme` stay in sync with state.
 *  - Persistence: each change writes to localStorage under the canonical key.
 *  - Privacy mode: a thrown `localStorage.getItem` / `setItem` falls back to
 *    `'dark'` and never crashes.
 *  - `toggleTheme()` flips dark↔light without losing the resolver chain.
 */

const THEME_KEY = 'wrongstack.simpleui.theme';

interface MatchMediaStub {
  matches: boolean;
  addEventListener: () => void;
  removeEventListener: () => void;
}

function installMatchMedia(matches: boolean): MatchMediaStub {
  const stub: MatchMediaStub = {
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn(() => stub),
  });
  return stub;
}

interface CapturedTheme {
  current: ReturnType<typeof useTheme>;
}

/**
 * Render `<Probe/>`, which calls the hook and copies its return value into the
 * `captured` holder on every render. Returns the holder plus the React root so
 * the caller can `act()` on it and unmount at teardown.
 */
function renderHookViaRoot(captured: CapturedTheme): Root {
  function Probe(): null {
    captured.current = useTheme();
    return null;
  }
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<Probe />));
  return root;
}

const roots: Root[] = [];

beforeEach(() => {
  localStorage.clear();
  document.documentElement.dataset.theme = '';
  document.documentElement.style.colorScheme = '';
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('useTheme — initial resolution', () => {
  it('uses a saved localStorage value when present', () => {
    localStorage.setItem(THEME_KEY, 'light');
    installMatchMedia(false);

    const captured: CapturedTheme = { current: undefined as never };
    renderHookViaRoot(captured);

    expect(captured.current.theme).toBe('light');
  });

  it('falls back to prefers-color-scheme: light when no saved value exists', () => {
    installMatchMedia(true);

    const captured: CapturedTheme = { current: undefined as never };
    renderHookViaRoot(captured);

    expect(captured.current.theme).toBe('light');
  });

  it('defaults to dark when no saved value and the OS prefers dark', () => {
    installMatchMedia(false);

    const captured: CapturedTheme = { current: undefined as never };
    renderHookViaRoot(captured);

    expect(captured.current.theme).toBe('dark');
  });

  it('ignores a corrupted localStorage value (not "dark"/"light")', () => {
    localStorage.setItem(THEME_KEY, 'midnight');
    installMatchMedia(true);

    const captured: CapturedTheme = { current: undefined as never };
    renderHookViaRoot(captured);

    expect(captured.current.theme).toBe('light');
  });

  it('falls back to dark when localStorage throws on read (privacy mode)', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = vi.fn(() => {
      throw new Error('storage denied');
    });
    installMatchMedia(true); // would normally select light

    const captured: CapturedTheme = { current: undefined as never };
    renderHookViaRoot(captured);

    expect(captured.current.theme).toBe('dark');

    Storage.prototype.getItem = original;
  });
});

describe('useTheme — DOM side-effects', () => {
  it('writes data-theme and colorScheme on mount', () => {
    localStorage.setItem(THEME_KEY, 'dark');
    installMatchMedia(false);

    const captured: CapturedTheme = { current: undefined as never };
    renderHookViaRoot(captured);

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('re-writes the DOM attributes when the theme changes', () => {
    installMatchMedia(false);

    const captured: CapturedTheme = { current: undefined as never };
    const root = renderHookViaRoot(captured);

    act(() => captured.current.setTheme('light'));

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(captured.current.theme).toBe('light');
    // Keep the root alive for the afterEach cleanup.
    roots.push(root);
  });
});

describe('useTheme — persistence', () => {
  it('persists each theme change under the canonical key', () => {
    installMatchMedia(false);

    const captured: CapturedTheme = { current: undefined as never };
    const root = renderHookViaRoot(captured);

    act(() => captured.current.setTheme('light'));
    expect(localStorage.getItem(THEME_KEY)).toBe('light');

    act(() => captured.current.toggleTheme());
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');

    roots.push(root);
  });

  it('swallows a thrown setItem (privacy mode) without crashing', () => {
    installMatchMedia(false);
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = vi.fn(() => {
      throw new Error('quota / denied');
    });

    const captured: CapturedTheme = { current: undefined as never };
    const root = renderHookViaRoot(captured);

    expect(() => {
      act(() => captured.current.setTheme('light'));
    }).not.toThrow();
    expect(captured.current.theme).toBe('light');

    Storage.prototype.setItem = original;
    roots.push(root);
  });
});

describe('useTheme — toggleTheme', () => {
  it('flips dark → light → dark', () => {
    installMatchMedia(false);

    const captured: CapturedTheme = { current: undefined as never };
    const root = renderHookViaRoot(captured);
    expect(captured.current.theme).toBe('dark');

    act(() => captured.current.toggleTheme());
    expect(captured.current.theme).toBe('light');

    act(() => captured.current.toggleTheme());
    expect(captured.current.theme).toBe('dark');

    roots.push(root);
  });
});
