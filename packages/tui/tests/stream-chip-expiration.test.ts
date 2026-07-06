import type { ChipMeta } from '../src/components/statusline-picker.js';
import { describe, expect, it } from 'vitest';
import {
  computeExpiredChipKeys,
  computeStreamChipActions,
} from '../src/hooks/use-stream-chip-expiration.js';

function chip(key: 'brain' | 'enhance', shownAt = 0, expiresIn = 5): ChipMeta {
  return { key, shownAt, expiresIn };
}

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
});

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
});
