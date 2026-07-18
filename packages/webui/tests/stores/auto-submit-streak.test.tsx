import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAutoSubmitStreak } from '../../src/stores/auto-submit-streak.js';
import { useLocalPrefs } from '../../src/stores/local-prefs.js';
import { useSessionStore } from '../../src/stores/session-store.js';

describe('useAutoSubmitStreak loop guard', () => {
  beforeEach(() => {
    useLocalPrefs.setState({ autonomy: 'auto', autoProceedMaxIterations: 50 });
    useSessionStore.getState().setSession({
      id: 'auto-loop-session',
      startedAt: Date.now(),
      provider: 'test',
      model: 'test',
    });

    const { result, unmount } = renderHook(() => useAutoSubmitStreak());
    act(() => result.current.reset());
    unmount();
  });

  it('shares repetition history across hook instances and latches the halt', () => {
    const first = renderHook(() => useAutoSubmitStreak());
    const second = renderHook(() => useAutoSubmitStreak());

    expect(first.result.current.recordPrompt('Run the focused tests')).toBe(true);
    expect(second.result.current.recordPrompt('  RUN the focused tests  ')).toBe(false);
    expect(first.result.current.canAutoSubmit()).toBe(false);
    expect(second.result.current.recordPrompt('Try a different prompt')).toBe(false);
  });

  it('manual reset clears both the repetition history and halted latch with an unlimited cap', () => {
    useLocalPrefs.setState({ autoProceedMaxIterations: 0 });
    const { result } = renderHook(() => useAutoSubmitStreak());

    expect(result.current.recordPrompt('Continue')).toBe(true);
    expect(result.current.recordPrompt('Continue')).toBe(false);
    expect(result.current.canAutoSubmit()).toBe(false);

    act(() => result.current.reset());

    expect(result.current.canAutoSubmit()).toBe(true);
    expect(result.current.recordPrompt('Continue')).toBe(true);
  });
});
