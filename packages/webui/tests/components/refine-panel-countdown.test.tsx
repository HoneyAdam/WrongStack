// Regression tests for the RefinePanel pre-refine countdown phase.
//
// Key invariant under test: a parent re-render mid-countdown must NOT reset
// the timer. The original bug was that `onStartRefine` (an inline arrow
// passed by ChatInput) got a new identity on every parent re-render, and
// since it was in the countdown effect's dependency array, any unrelated
// store update (fleet status, file ref change, etc.) tore down the interval
// and restarted the countdown from 3. The fix stored the callback in a ref
// and made the effect depend only on `[status]`.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────
// RefinePanel pulls from useAppTranslation (i18n) and useLocalPrefs. We
// stub both so the test stays focused on countdown mechanics and doesn't
// drag in the full i18n provider chain.

vi.mock('@/i18n', () => ({
  useAppTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && 'seconds' in opts) return `${key}:${String(opts.seconds)}`;
      return key;
    },
  }),
}));

const localPrefsState = {
  enhanceLanguage: 'original' as 'original' | 'english',
  yolo: false,
};
vi.mock('@/stores/local-prefs', () => ({
  useLocalPrefs: (selector: (s: typeof localPrefsState) => unknown) =>
    selector(localPrefsState),
}));

// useWebSocket is used by the panel for updatePrefs in the toggle handlers
// — we don't exercise those here but the import runs at module level.
const updatePrefsMock = vi.fn();
vi.mock('@/hooks/useWebSocket', () => ({
  useWebSocket: () => ({ updatePrefs: updatePrefsMock }),
}));

import { RefinePanel, type RefineDecision } from '../../src/components/RefinePanel.js';
import { useUIStore } from '../../src/stores/ui-store.js';

beforeEach(() => {
  localPrefsState.enhanceLanguage = 'original';
  localPrefsState.yolo = false;
  updatePrefsMock.mockClear();
  useUIStore.setState({ refinePanel: null });
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Helpers ────────────────────────────────────────────────────────────

interface RenderOpts {
  status?: 'countdown' | 'refining' | 'ready' | 'failed';
  onStartRefine?: () => void;
  onDecision?: (d: RefineDecision) => void;
}

function renderCountdown(opts: RenderOpts = {}) {
  const onDecision = opts.onDecision ?? vi.fn();
  const onStartRefine = opts.onStartRefine ?? vi.fn();

  const utils = render(
    <RefinePanel
      original="fix the bug"
      refined="fix the bug"
      english="fix the bug"
      status={opts.status ?? 'countdown'}
      onDecision={onDecision}
      onStartRefine={onStartRefine}
    />,
  );

  return { ...utils, onDecision, onStartRefine };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('RefinePanel — countdown phase', () => {
  it('shows the countdown badge starting at 3', () => {
    renderCountdown();
    // The badge renders the number "3" inside the panel header.
    expect(screen.getByText('3')).toBeDefined();
  });

  it('fires onStartRefine after 3 seconds', () => {
    vi.useFakeTimers();
    const onStartRefine = vi.fn();
    renderCountdown({ onStartRefine });

    expect(onStartRefine).not.toHaveBeenCalled();

    // 1s → still 2
    act(() => vi.advanceTimersByTime(1000));
    expect(onStartRefine).not.toHaveBeenCalled();

    // 2s → still 1
    act(() => vi.advanceTimersByTime(1000));
    expect(onStartRefine).not.toHaveBeenCalled();

    // 3s → fires
    act(() => vi.advanceTimersByTime(1000));
    expect(onStartRefine).toHaveBeenCalledTimes(1);
  });

  it('does NOT reset the countdown when the parent re-renders mid-countdown', () => {
    // This is the core regression test. The original bug: onStartRefine
    // was in the effect's dependency array, so a parent re-render that
    // gave it a new identity tore down + restarted the interval, resetting
    // the counter from 3.
    vi.useFakeTimers();
    const onStartRefine = vi.fn();

    const { rerender } = render(
      <RefinePanel
        original="fix the bug"
        refined="fix the bug"
        english="fix the bug"
        status="countdown"
        onDecision={vi.fn()}
        onStartRefine={onStartRefine}
      />,
    );

    // Advance 1 second → counter should be at 2
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText('2')).toBeDefined();

    // Simulate a parent re-render with a NEW onStartRefine identity
    // (this is what ChatInput does — it passes an inline arrow).
    const onStartRefine2 = vi.fn();
    rerender(
      <RefinePanel
        original="fix the bug"
        refined="fix the bug"
        english="fix the bug"
        status="countdown"
        onDecision={vi.fn()}
        onStartRefine={onStartRefine2}
      />,
    );

    // The counter must still show 2, NOT reset back to 3.
    expect(screen.getByText('2')).toBeDefined();
    expect(screen.queryByText('3')).toBeNull();

    // Advance 1 more second → counter should be at 1 (not 2)
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText('1')).toBeDefined();
    expect(screen.queryByText('3')).toBeNull();

    // Advance the remaining 1 second → onStartRefine fires (total 3s elapsed)
    act(() => vi.advanceTimersByTime(1000));
    expect(onStartRefine2).toHaveBeenCalledTimes(1);
    // The first callback should NOT have fired — the ref held the latest.
    expect(onStartRefine).not.toHaveBeenCalled();
  });

  it('"Refine now" button fires onStartRefine immediately', () => {
    vi.useFakeTimers();
    const onStartRefine = vi.fn();
    renderCountdown({ onStartRefine });

    expect(onStartRefine).not.toHaveBeenCalled();

    // Click the "Refine now" button (identified by its i18n key).
    const refineNowBtn = screen.getByText('activity:refine.countdownStartNow');
    act(() => fireEvent.click(refineNowBtn));

    expect(onStartRefine).toHaveBeenCalledTimes(1);
  });

  it('"Send as-is" button calls onDecision("original")', () => {
    const onDecision = vi.fn();
    renderCountdown({ onDecision });

    const sendAsIsBtn = screen.getByText('activity:refine.countdownSendAsIs');
    fireEvent.click(sendAsIsBtn);

    expect(onDecision).toHaveBeenCalledWith('original');
    expect(onDecision).toHaveBeenCalledTimes(1);
  });

  it('X (cancel) button calls onDecision("original")', () => {
    const onDecision = vi.fn();
    renderCountdown({ onDecision });

    // The cancel (X) button has a title attribute from the i18n key.
    const cancelBtn = screen.getByTitle('activity:refine.cancelTitle');
    fireEvent.click(cancelBtn);

    expect(onDecision).toHaveBeenCalledWith('original');
  });
});

describe('RefinePanel — refining state cancel button', () => {
  it('shows "Cancel & send original" and fires onDecision("original")', () => {
    const onDecision = vi.fn();
    renderCountdown({ status: 'refining', onDecision });

    const cancelBtn = screen.getByText('activity:refine.cancelRefineSendOriginal');
    fireEvent.click(cancelBtn);

    expect(onDecision).toHaveBeenCalledWith('original');
    expect(onDecision).toHaveBeenCalledTimes(1);
  });
});
