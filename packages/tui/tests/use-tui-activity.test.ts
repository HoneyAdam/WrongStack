import { render } from 'ink-testing-library';
import React, { act, StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTuiActivity } from '../src/hooks/use-tui-activity.js';
import { Text } from '../src/ink.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../src/heap-watchdog.js', () => ({
  startHeapWatchdog: () => () => {},
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
    expect(view.lastFrame()).toBe('2000');

    act(() => view.rerender(harness('streaming')));
    act(() => vi.advanceTimersByTime(1_000));
    expect(view.lastFrame()).toBe('3000');

    act(() => view.rerender(harness('idle')));
    act(() => vi.advanceTimersByTime(1_000));
    expect(view.lastFrame()).toBe('3000');

    act(() => view.rerender(harness('running')));
    act(() => vi.advanceTimersByTime(2_000));
    expect(view.lastFrame()).toBe('5000');

    act(() => view.unmount());
  });
});
