import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

// ── Mocks ─────────────────────────────────────────────────────────────────
const onSpy = vi.hoisted(() => vi.fn(() => () => {}));

vi.mock('@/lib/ws-client', () => ({
  getWSClient: () => ({ on: onSpy }),
}));

// ── SUT (imported after mocks) ────────────────────────────────────────────
import { useWsHandlers } from '../../src/hooks/use-ws-handlers';

describe('useWsHandlers', () => {
  beforeEach(() => {
    onSpy.mockClear();
    onSpy.mockImplementation(() => () => {});
  });

  it('registers every handler in the map on mount', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    renderHook(() =>
      useWsHandlers({
        'session.start': h1,
        'text_delta': h2,
      }),
    );

    expect(onSpy).toHaveBeenCalledTimes(2);
    expect(onSpy).toHaveBeenCalledWith('session.start', h1);
    expect(onSpy).toHaveBeenCalledWith('text_delta', h2);
  });

  it('tears down every registration on unmount', () => {
    const off1 = vi.fn();
    const off2 = vi.fn();
    onSpy.mockImplementationOnce(() => off1);
    onSpy.mockImplementationOnce(() => off2);

    const { unmount } = renderHook(() =>
      useWsHandlers({ 'session.start': vi.fn(), 'text_delta': vi.fn() }),
    );

    unmount();
    expect(off1).toHaveBeenCalledTimes(1);
    expect(off2).toHaveBeenCalledTimes(1);
  });

  it('skips falsy handlers (partial map)', () => {
    renderHook(() =>
      useWsHandlers({
        'session.start': vi.fn(),
        'text_delta': undefined,
      }),
    );

    expect(onSpy).toHaveBeenCalledTimes(1);
  });

  it('re-subscribes when deps change', () => {
    const off1 = vi.fn();
    onSpy.mockImplementation(() => off1);

    let dep = 'a';
    const { rerender } = renderHook(() => useWsHandlers({ 'session.start': vi.fn() }, [dep]));

    expect(onSpy).toHaveBeenCalledTimes(1);
    expect(off1).not.toHaveBeenCalled();

    dep = 'b';
    rerender();

    // Old registration torn down, new one made.
    expect(off1).toHaveBeenCalledTimes(1);
    expect(onSpy).toHaveBeenCalledTimes(2);
  });
});
