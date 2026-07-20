// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type StatusNotice, useStatusNotice } from '../src/hooks/use-status-notice.js';

/**
 * PR-1 safety net for `useStatusNotice`. The hook was extracted verbatim from
 * `app.tsx`'s composer notice lifecycle. These tests pin the auto-dismiss and
 * replacement contract so future refactors cannot silently regress it.
 *
 * Harness mirrors `agent-chat-pane.test.tsx`: real `createRoot` + `act`, no
 * extra testing-library dependency.
 *
 * Coverage:
 *  - A pushed notice is observable immediately.
 *  - It auto-clears after the 5s window.
 *  - Pushing a different notice replaces the current one and restarts the timer.
 *  - `clearNotice()` clears immediately and is safe when nothing is shown.
 *  - A newer notice survives the older timer's scheduled fire time.
 */

function makeNotice(id: string, text = `notice-${id}`): StatusNotice {
  return { id, text, tone: 'info' };
}

interface CapturedNotice {
  current: ReturnType<typeof useStatusNotice>;
}

function renderHookViaRoot(captured: CapturedNotice): Root {
  function Probe(): null {
    captured.current = useStatusNotice();
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
  vi.useFakeTimers();
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useStatusNotice — lifecycle', () => {
  it('starts with no notice', () => {
    const captured: CapturedNotice = { current: undefined as never };
    const root = renderHookViaRoot(captured);

    expect(captured.current.notice).toBeNull();
    roots.push(root);
  });

  it('exposes a pushed notice immediately', () => {
    const captured: CapturedNotice = { current: undefined as never };
    const root = renderHookViaRoot(captured);

    act(() => captured.current.showNotice(makeNotice('a')));

    expect(captured.current.notice).toEqual(makeNotice('a'));
    roots.push(root);
  });

  it('auto-clears after the timeout window', () => {
    const captured: CapturedNotice = { current: undefined as never };
    const root = renderHookViaRoot(captured);

    act(() => captured.current.showNotice(makeNotice('a')));
    expect(captured.current.notice).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(4_999);
    });
    expect(captured.current.notice).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(captured.current.notice).toBeNull();
    roots.push(root);
  });

  it('does not auto-clear a newer notice when an older timer fires', () => {
    const captured: CapturedNotice = { current: undefined as never };
    const root = renderHookViaRoot(captured);

    act(() => captured.current.showNotice(makeNotice('old')));
    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    act(() => captured.current.showNotice(makeNotice('new')));
    // Advance past the OLD notice's original 5s deadline. The newer notice
    // must survive because its timer started 3s later.
    act(() => {
      vi.advanceTimersByTime(2_500);
    });
    expect(captured.current.notice).toEqual(makeNotice('new'));

    act(() => {
      vi.advanceTimersByTime(2_500);
    });
    expect(captured.current.notice).toBeNull();
    roots.push(root);
  });
});

describe('useStatusNotice — manual control', () => {
  it('clearNotice clears immediately and cancels the pending timer', () => {
    const captured: CapturedNotice = { current: undefined as never };
    const root = renderHookViaRoot(captured);

    act(() => captured.current.showNotice(makeNotice('a')));
    act(() => captured.current.clearNotice());
    expect(captured.current.notice).toBeNull();

    // Firing the timer after clear must not re-introduce the notice.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(captured.current.notice).toBeNull();
    roots.push(root);
  });

  it('clearNotice is a no-op when no notice is shown', () => {
    const captured: CapturedNotice = { current: undefined as never };
    const root = renderHookViaRoot(captured);

    expect(() => {
      act(() => captured.current.clearNotice());
    }).not.toThrow();
    expect(captured.current.notice).toBeNull();
    roots.push(root);
  });
});
