import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { Text } from '../src/ink.js';
import type { ChipMeta } from '../src/components/statusline-picker.js';
import {
  computeExpiredChipKeys,
  computeStreamChipActions,
  useStreamChipExpiration,
} from '../src/hooks/use-stream-chip-expiration.js';

function chip(key: 'brain' | 'enhance', shownAt = 0, expiresIn = 5): ChipMeta {
  return { key, shownAt, expiresIn };
}

// ── computeStreamChipActions (pure) ──────────────────────────────────

describe('computeStreamChipActions', () => {
  it('shows the brain chip when a brain prompt appears', () => {
    expect(
      computeStreamChipActions({
        brainPromptNow: true,
        brainPromptPrev: false,
        enhanceNow: false,
        enhancePrev: false,
        visibleChipKeys: [],
      }),
    ).toEqual([{ type: 'statuslineChipShow', key: 'brain', expiresIn: 5 }]);
  });

  it('expires the brain chip when the prompt clears and the chip is visible', () => {
    expect(
      computeStreamChipActions({
        brainPromptNow: false,
        brainPromptPrev: true,
        enhanceNow: false,
        enhancePrev: false,
        visibleChipKeys: ['brain'],
      }),
    ).toEqual([{ type: 'statuslineChipExpire', key: 'brain' }]);
  });

  it('does NOT expire brain chip when prompt clears but brain is not visible', () => {
    expect(
      computeStreamChipActions({
        brainPromptNow: false,
        brainPromptPrev: true,
        enhanceNow: false,
        enhancePrev: false,
        visibleChipKeys: [],
      }),
    ).toEqual([]);
  });

  it('shows and expires the enhance chip symmetrically', () => {
    expect(
      computeStreamChipActions({
        brainPromptNow: false,
        brainPromptPrev: false,
        enhanceNow: true,
        enhancePrev: false,
        visibleChipKeys: [],
      }),
    ).toEqual([{ type: 'statuslineChipShow', key: 'enhance', expiresIn: 5 }]);

    expect(
      computeStreamChipActions({
        brainPromptNow: false,
        brainPromptPrev: false,
        enhanceNow: false,
        enhancePrev: true,
        visibleChipKeys: ['enhance'],
      }),
    ).toEqual([{ type: 'statuslineChipExpire', key: 'enhance' }]);
  });

  it('returns no actions when visibility and source state are unchanged', () => {
    expect(
      computeStreamChipActions({
        brainPromptNow: false,
        brainPromptPrev: false,
        enhanceNow: true,
        enhancePrev: true,
        visibleChipKeys: ['enhance'],
      }),
    ).toEqual([]);
  });

  it('handles both brain and enhance transitions simultaneously', () => {
    expect(
      computeStreamChipActions({
        brainPromptNow: true,
        brainPromptPrev: false,
        enhanceNow: true,
        enhancePrev: false,
        visibleChipKeys: [],
      }),
    ).toEqual([
      { type: 'statuslineChipShow', key: 'brain', expiresIn: 5 },
      { type: 'statuslineChipShow', key: 'enhance', expiresIn: 5 },
    ]);
  });
});

// ── computeExpiredChipKeys (pure) ────────────────────────────────────

describe('computeExpiredChipKeys', () => {
  it('returns only chip keys whose expiration window has elapsed', () => {
    const now = 10 * 60 * 1000;
    expect(computeExpiredChipKeys([chip('brain', 1, 5), chip('enhance', now, 5)], now)).toEqual([
      'brain',
    ]);
  });

  it('returns an empty list when nothing has expired', () => {
    const now = 2 * 60 * 1000;
    expect(computeExpiredChipKeys([chip('brain', 1, 5)], now)).toEqual([]);
  });

  it('returns keys when chip has exactly expired', () => {
    const now = 6 * 60 * 1000;
    expect(computeExpiredChipKeys([chip('brain', 1, 5)], now)).toEqual(['brain']);
  });

  it('returns empty for empty chips array', () => {
    expect(computeExpiredChipKeys([], 1000)).toEqual([]);
  });

  it('chip at boundary (shownAt + expiresIn === now) is NOT expired', () => {
    const now = 6 * 60 * 1000;
    expect(computeExpiredChipKeys([chip('brain', 1, 6)], now)).toEqual([]);
  });
});

// ── useStreamChipExpiration (hook) ───────────────────────────────────

describe('useStreamChipExpiration', () => {
  it('sets up cleanup interval on unmount', () => {
    vi.useFakeTimers();
    const dispatch = vi.fn();
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    function Harness(): React.ReactElement {
      useStreamChipExpiration({
        brainPrompt: false,
        enhance: false,
        visibleChips: [] as ChipMeta[],
        dispatch,
      });
      return React.createElement(Text, null, 'test');
    }
    const view = render(React.createElement(Harness));
    view.unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('interval is set up and cleaned up on unmount', () => {
    vi.useFakeTimers();
    const dispatch = vi.fn();
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    function Harness(): React.ReactElement {
      useStreamChipExpiration({
        brainPrompt: false,
        enhance: false,
        visibleChips: [] as ChipMeta[],
        dispatch,
      });
      return React.createElement(Text, null, 'test');
    }
    const view = render(React.createElement(Harness));

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30000);

    view.unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('handles truthy brainPrompt at mount', () => {
    const dispatch = vi.fn();

    // The hook uses useRef to store prevBrainPrompt, init with brainPrompt value.
    // On first mount, both prev and current are the same truthy value,
    // so no show action is dispatched on mount.
    // This test just verifies no crash.
    function Harness(): React.ReactElement {
      useStreamChipExpiration({
        brainPrompt: { data: 'test' },
        enhance: false,
        visibleChips: [] as ChipMeta[],
        dispatch,
      });
      return React.createElement(Text, null, 'test');
    }
    expect(() => render(React.createElement(Harness))).not.toThrow();
  });
});
