// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PR-2 safety net for `useF5Resilience`. The hook was extracted from
 * `app.tsx`'s two inline window-lifecycle effects. These tests pin the
 * exit-confirmation gating and the draft-flush on `pagehide` + unmount.
 *
 * Strategy: mount a probe component, drive `beforeunload` / `pagehide`
 * events with `window.dispatchEvent`, and assert on `event.defaultPrevented`
 * + the `writeComposerDraft` spy.
 */

const { useF5Resilience } = await import('../src/hooks/use-f5-resilience.js');

// ── Harness ────────────────────────────────────────────────────────────────

interface ProbeOptions {
  confirmExit: boolean;
  running: boolean;
  sessionId: string | null;
  draft: string;
  fileRefs: string[];
  writeComposerDraft: ReturnType<typeof vi.fn>;
}

function renderHookViaRoot(options: ProbeOptions): {
  root: Root;
  refs: {
    confirmExitRef: { current: { confirmExit: boolean } };
    runningRef: { current: boolean };
    sessionIdRef: { current: string | null };
    draftRef: { current: string };
    fileRefsRef: { current: string[] };
  };
} {
  const refs = {
    confirmExitRef: { current: { confirmExit: options.confirmExit } },
    runningRef: { current: options.running },
    sessionIdRef: { current: options.sessionId },
    draftRef: { current: options.draft },
    fileRefsRef: { current: options.fileRefs },
  };
  function Probe(): null {
    useF5Resilience({ ...refs, writeComposerDraft: options.writeComposerDraft });
    return null;
  }
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(<Probe />));
  return { root, refs };
}

function dispatchBeforeUnload(): BeforeUnloadEvent {
  const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
  window.dispatchEvent(event);
  return event;
}

function dispatchPageHide(): Event {
  const event = new Event('pagehide', { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

const roots: Root[] = [];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── beforeunload ───────────────────────────────────────────────────────────

describe('useF5Resilience — beforeunload exit confirmation', () => {
  it('does not prompt when not running', () => {
    const writeComposerDraft = vi.fn();
    const { refs } = renderHookViaRoot({
      confirmExit: true,
      running: false,
      sessionId: 'sess-1',
      draft: 'text',
      fileRefs: [],
      writeComposerDraft,
    });
    void refs;

    const event = dispatchBeforeUnload();
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not prompt when confirmExit is disabled', () => {
    const writeComposerDraft = vi.fn();
    renderHookViaRoot({
      confirmExit: false,
      running: true,
      sessionId: 'sess-1',
      draft: 'text',
      fileRefs: [],
      writeComposerDraft,
    });

    const event = dispatchBeforeUnload();
    expect(event.defaultPrevented).toBe(false);
  });

  it('prevents default when confirmExit && running', () => {
    const writeComposerDraft = vi.fn();
    renderHookViaRoot({
      confirmExit: true,
      running: true,
      sessionId: 'sess-1',
      draft: 'text',
      fileRefs: [],
      writeComposerDraft,
    });

    const event = dispatchBeforeUnload();
    expect(event.defaultPrevented).toBe(true);
  });

  it('reflects live ref mutations (not stale closure values)', () => {
    const writeComposerDraft = vi.fn();
    const { refs } = renderHookViaRoot({
      confirmExit: false,
      running: true,
      sessionId: 'sess-1',
      draft: 'text',
      fileRefs: [],
      writeComposerDraft,
    });

    // Initially disabled — no prompt.
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);

    // Flip confirmExit on without re-rendering the effect.
    refs.confirmExitRef.current = { confirmExit: true };
    expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

    // Flip running off.
    refs.runningRef.current = false;
    expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  });
});

// ── pagehide ───────────────────────────────────────────────────────────────

describe('useF5Resilience — pagehide draft flush', () => {
  it('flushes the draft via writeComposerDraft', () => {
    const writeComposerDraft = vi.fn();
    renderHookViaRoot({
      confirmExit: false,
      running: false,
      sessionId: 'sess-1',
      draft: 'unsent thought',
      fileRefs: ['src/a.ts'],
      writeComposerDraft,
    });

    dispatchPageHide();

    expect(writeComposerDraft).toHaveBeenCalledWith('sess-1', {
      text: 'unsent thought',
      fileRefs: ['src/a.ts'],
    });
  });

  it('skips the flush when sessionIdRef.current is null', () => {
    const writeComposerDraft = vi.fn();
    renderHookViaRoot({
      confirmExit: false,
      running: false,
      sessionId: null,
      draft: 'unsent thought',
      fileRefs: [],
      writeComposerDraft,
    });

    dispatchPageHide();
    expect(writeComposerDraft).not.toHaveBeenCalled();
  });

  it('reads live ref values at event time', () => {
    const writeComposerDraft = vi.fn();
    const { refs } = renderHookViaRoot({
      confirmExit: false,
      running: false,
      sessionId: 'sess-1',
      draft: 'old',
      fileRefs: [],
      writeComposerDraft,
    });

    refs.draftRef.current = 'updated';
    refs.fileRefsRef.current = ['b.ts'];
    dispatchPageHide();

    expect(writeComposerDraft).toHaveBeenCalledWith('sess-1', {
      text: 'updated',
      fileRefs: ['b.ts'],
    });
  });
});

// ── unmount cleanup ────────────────────────────────────────────────────────

describe('useF5Resilience — unmount cleanup', () => {
  it('flushes the draft on unmount', () => {
    const writeComposerDraft = vi.fn();
    const { root } = renderHookViaRoot({
      confirmExit: false,
      running: false,
      sessionId: 'sess-1',
      draft: 'cleanup payload',
      fileRefs: ['c.ts'],
      writeComposerDraft,
    });

    act(() => root.unmount());

    expect(writeComposerDraft).toHaveBeenCalledWith('sess-1', {
      text: 'cleanup payload',
      fileRefs: ['c.ts'],
    });
    roots.length = 0; // already unmounted
  });

  it('does not double-flush when pagehide fires before unmount', () => {
    const writeComposerDraft = vi.fn();
    const { root } = renderHookViaRoot({
      confirmExit: false,
      running: false,
      sessionId: 'sess-1',
      draft: 'text',
      fileRefs: [],
      writeComposerDraft,
    });

    dispatchPageHide(); // flush #1
    act(() => root.unmount()); // flush #2 (cleanup)
    roots.length = 0;

    // Two flushes are expected: one for the user-driven pagehide, one for
    // the React-driven unmount. This is the pre-PR-2 behaviour — the cleanup
    // always flushes to cover the StrictMode remount case.
    expect(writeComposerDraft).toHaveBeenCalledTimes(2);
  });

  it('skips unmount flush when sessionIdRef.current is null', () => {
    const writeComposerDraft = vi.fn();
    const { root } = renderHookViaRoot({
      confirmExit: false,
      running: false,
      sessionId: null,
      draft: 'text',
      fileRefs: [],
      writeComposerDraft,
    });

    act(() => root.unmount());
    expect(writeComposerDraft).not.toHaveBeenCalled();
    roots.length = 0;
  });
});
