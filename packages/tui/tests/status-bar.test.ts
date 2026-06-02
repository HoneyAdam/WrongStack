import { describe, expect, it } from 'vitest';
import {
  fmtElapsed,
  renderMeter,
  renderProgress,
  stateChip,
  statusBarAutonomySpan,
  statusBarModelSpan,
} from '../src/components/status-bar.js';

describe('statusBarModelSpan (mouse hit-test geometry)', () => {
  it('places the model chip after the state chip (no version)', () => {
    const span = statusBarModelSpan({ state: 'idle', model: 'anthropic/claude' });
    // padX(1) + "● idle"(6) + gap(2) + "│"(1) + gap(2) = 12
    expect(span).toEqual({ start: 12, len: 'anthropic/claude'.length });
  });

  it('accounts for the leading WS version chip', () => {
    const span = statusBarModelSpan({ version: '0.10.0', state: 'idle', model: 'x/y' });
    // + "WS v0.10.0"(10) + gap(2) + "│"(1) + gap(2) = 15 before the state chip
    expect(span.start).toBe(12 + 15);
  });

  it('widens the offset for the longer "thinking…" state label', () => {
    const idle = statusBarModelSpan({ state: 'idle', model: 'm' });
    const busy = statusBarModelSpan({ state: 'running', model: 'm' });
    // "thinking…"(9) vs "idle"(4) → +5
    expect(busy.start - idle.start).toBe(5);
  });
});

describe('statusBarAutonomySpan (mouse hit-test geometry)', () => {
  it('returns null when autonomy is off or unset', () => {
    expect(statusBarAutonomySpan({ autonomy: 'off' })).toBeNull();
    expect(statusBarAutonomySpan({})).toBeNull();
  });

  it('starts at the left padding when YOLO is not shown', () => {
    expect(statusBarAutonomySpan({ autonomy: 'auto' })).toEqual({
      start: 1,
      len: 2 + 'AUTO'.length,
    });
  });

  it('shifts right past the YOLO chip + separator', () => {
    const span = statusBarAutonomySpan({ yolo: true, autonomy: 'eternal' });
    // padX(1) + "⚠ YOLO"(6) + gap(2) + "│"(1) + gap(2) = 12
    expect(span).toEqual({ start: 12, len: 2 + 'ETERNAL'.length });
  });
});

describe('fmtElapsed', () => {
  it('renders mm:ss under one hour', () => {
    expect(fmtElapsed(0)).toBe('00:00');
    expect(fmtElapsed(5_000)).toBe('00:05');
    expect(fmtElapsed(65_000)).toBe('01:05');
    expect(fmtElapsed(59 * 60_000 + 30_000)).toBe('59:30');
  });

  it('switches to h:mm:ss at exactly one hour', () => {
    expect(fmtElapsed(60 * 60_000)).toBe('1:00:00');
    expect(fmtElapsed(60 * 60_000 + 1_000)).toBe('1:00:01');
    expect(fmtElapsed(3 * 60 * 60_000 + 15 * 60_000 + 7_000)).toBe('3:15:07');
  });

  it('rounds milliseconds down (floor)', () => {
    expect(fmtElapsed(999)).toBe('00:00');
    expect(fmtElapsed(1_999)).toBe('00:01');
  });

  it('pads seconds and minutes with leading zeros under an hour', () => {
    expect(fmtElapsed(3_000)).toBe('00:03');
    expect(fmtElapsed(63_000)).toBe('01:03');
  });
});

describe('stateChip', () => {
  it('shows plain idle when no background agents are running', () => {
    expect(stateChip('idle', 0)).toEqual({ label: 'idle', color: 'cyan' });
  });

  it('surfaces the live agent count when idle but background agents run', () => {
    expect(stateChip('idle', 1)).toEqual({ label: 'agents ▶1', color: 'magenta' });
    expect(stateChip('idle', 3)).toEqual({ label: 'agents ▶3', color: 'magenta' });
  });

  it('keeps foreground states regardless of fleet count', () => {
    // A running/streaming foreground already implies activity — the chip
    // reflects the foreground, not the background fleet.
    expect(stateChip('running', 5)).toEqual({ label: 'thinking…', color: 'green' });
    expect(stateChip('streaming', 5)).toEqual({ label: 'thinking…', color: 'green' });
    expect(stateChip('aborting', 5)).toEqual({ label: 'aborting…', color: 'yellow' });
  });
});

describe('renderProgress', () => {
  it('renders an empty bar at ratio 0', () => {
    expect(renderProgress(0, 10)).toBe('░░░░░░░░░░');
  });

  it('renders a full bar at ratio 1', () => {
    expect(renderProgress(1, 10)).toBe('██████████');
  });

  it('shows at least one filled cell for any non-zero ratio (so 1% != 0%)', () => {
    const bar = renderProgress(0.01, 10);
    expect(bar.startsWith('█')).toBe(true);
    expect(bar.length).toBe(10);
  });

  it('rounds 50% to 5 of 10 cells', () => {
    expect(renderProgress(0.5, 10)).toBe('█████░░░░░');
  });

  it('clamps ratios outside [0,1]', () => {
    expect(renderProgress(-0.5, 8)).toBe('░░░░░░░░');
    expect(renderProgress(1.7, 8)).toBe('████████');
  });

  it('keeps total width stable across all ratios', () => {
    for (let i = 0; i <= 10; i++) {
      expect(renderProgress(i / 10, 12).length).toBe(12);
    }
  });
});

describe('renderMeter (sub-cell precision)', () => {
  it('is empty at 0 and full at 1', () => {
    expect(renderMeter(0, 10)).toBe('░░░░░░░░░░');
    expect(renderMeter(1, 10)).toBe('██████████');
  });

  it('keeps total visual width stable across all ratios', () => {
    for (let i = 0; i <= 24; i++) {
      // Each cell is exactly one character (full block, one-eighth block, or
      // empty track), so the rendered string is always `width` chars.
      expect([...renderMeter(i / 24, 12)].length).toBe(12);
    }
  });

  it('renders a fractional leading cell instead of jumping a whole cell', () => {
    // 1/12 of the bar = a partial block in the first cell, rest empty track.
    const bar = renderMeter(1 / 12 / 2, 12); // half a cell
    expect(bar[0]).not.toBe('█');
    expect(bar[0]).not.toBe('░');
    expect(bar.slice(1)).toBe('░'.repeat(11));
  });

  it('clamps out-of-range ratios', () => {
    expect(renderMeter(-1, 8)).toBe('░░░░░░░░');
    expect(renderMeter(2, 8)).toBe('████████');
  });
});
