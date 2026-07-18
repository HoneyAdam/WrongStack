import { render } from 'ink-testing-library';
import React, { act, StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTuiActivity } from '../src/hooks/use-tui-activity.js';
import { Text } from '../src/ink.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../src/heap-watchdog.js', () => ({
  startHeapWatchdog: () => () => {},
  takeHeapSample: () => ({
    ts: '2026-07-15T00:00:00.000Z',
    rss: 0,
    heapUsed: 0,
    heapTotal: 0,
    external: 0,
    heapLimit: 0,
    load: 0,
  }),
}));

const stateRef = {
  current: { entries: [], runningTools: new Set() },
} as never;
const agentContext = { state: { messages: [] } } as never;
const dispatch = vi.fn() as never;

function ActivityHarness({
  status,
}: {
  status: 'idle' | 'running' | 'streaming' | 'aborting';
}): React.ReactElement {
  const { workingTimeMs } = useTuiActivity({
    status,
    fleet: {},
    enhanceBusy: false,
    thinkingWord: 'thinking',
    projectRoot: '',
    stateRef,
    agentContext,
    dispatch,
  });
  return React.createElement(Text, null, workingTimeMs);
}

function harness(status: 'idle' | 'running' | 'streaming' | 'aborting'): React.ReactElement {
  return React.createElement(StrictMode, null, React.createElement(ActivityHarness, { status }));
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useTuiActivity foreground working time', () => {
  /** Ink 7.1.1 writes content and trailing whitespace as separate frames;
   *  return the last frame with non-whitespace content. */
  function lastVisibleFrame(view: ReturnType<typeof render>): string {
    const f = view.lastFrame() ?? '';
    if (f.trim().length > 0) return f.trim();
    // Fall back to scanning frames for content
    for (let i = view.frames.length - 1; i >= 0; i--) {
      const candidate = view.frames[i];
      if (candidate && candidate.trim().length > 0) return candidate.trim();
    }
    return f;
  }

  it('counts committed working spells without resets or idle gaps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T00:00:00.000Z'));
    let view!: ReturnType<typeof render>;
    act(() => {
      view = render(harness('idle'));
    });

    act(() => {
      vi.setSystemTime(new Date('2026-07-15T00:00:01.000Z'));
      view.rerender(harness('running'));
    });
    act(() => vi.advanceTimersByTime(2_000));
    expect(lastVisibleFrame(view)).toBe('2000');

    act(() => view.rerender(harness('streaming')));
    act(() => vi.advanceTimersByTime(1_000));
    expect(lastVisibleFrame(view)).toBe('3000');

    act(() => view.rerender(harness('idle')));
    act(() => vi.advanceTimersByTime(1_000));
    expect(lastVisibleFrame(view)).toBe('3000');

    act(() => view.rerender(harness('running')));
    act(() => vi.advanceTimersByTime(2_000));
    expect(lastVisibleFrame(view)).toBe('5000');

    act(() => view.unmount());
  });
});
