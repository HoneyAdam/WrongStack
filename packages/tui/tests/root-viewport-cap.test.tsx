/**
 * Pins the AppView root-cap contract: the app's root box is fixed at exactly
 * `termRows` with `overflowY:'hidden'` + `justifyContent:'flex-end'`, so
 *
 *  1. a frame can NEVER be taller than the terminal — the bottom region
 *     growing a commit before the history viewport shrinks (vp is measured in
 *     a layout effect, Ink writes at resetAfterCommit, i.e. earlier) used to
 *     produce a 1-frame overflow that scrolled the terminal and stranded rows
 *     in native scrollback ("arap saçı" garbage accumulation);
 *  2. the overflow is clipped at the TOP (Ink-7: flex-end clips top), so the
 *     freshly-grown bottom region (picker, multiline input, confirm prompt)
 *     stays fully visible while history briefly loses its top rows;
 *  3. when content underfills the cap, the bottom region stays pinned to the
 *     terminal's bottom edge (blank rows appear at the top, not the bottom).
 *
 * Uses the real-TTY harness: real yoga layout, exact frames.
 */
import { describe, expect, it } from 'vitest';
import { Box, Text } from '../src/ink.js';
import { renderRealTty, settle } from './helpers/real-tty.js';

const ROWS = 12;
const COLS = 40;

/** Mirror of AppView's root structure: capped root + [history(vp), bottom]. */
function CappedRoot({ vp, bottomLines }: { vp: number; bottomLines: number }) {
  return (
    <Box flexDirection="column" height={ROWS} overflowY="hidden" justifyContent="flex-end">
      <Box flexDirection="column" flexShrink={0}>
        <Box flexDirection="column" height={vp} overflowY="hidden" flexShrink={0}>
          {Array.from({ length: vp }, (_, i) => (
            <Text key={i}>{`history-${i}`}</Text>
          ))}
        </Box>
        <Box flexDirection="column" flexShrink={0}>
          {Array.from({ length: bottomLines }, (_, i) => (
            <Text key={i}>{`bottom-${i}`}</Text>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

describe('root viewport cap', () => {
  it('never emits a frame taller than the terminal, even mid-overflow', async () => {
    // Steady state: vp + bottom = ROWS exactly.
    const view = renderRealTty(<CappedRoot vp={ROWS - 3} bottomLines={3} />, {
      columns: COLS,
      rows: ROWS,
    });
    await settle();
    expect(view.lines().length).toBeLessThanOrEqual(ROWS);
    expect(view.lastFrame()).toContain('history-0');
    expect(view.lastFrame()).toContain('bottom-2');

    // Bottom region grows (picker opened) BEFORE vp shrank — the overflow
    // frame must stay capped at ROWS and keep the whole bottom region visible.
    view.rerender(<CappedRoot vp={ROWS - 3} bottomLines={7} />);
    await settle();
    const lines = view.lines();
    expect(lines.length).toBeLessThanOrEqual(ROWS);
    // Clip happened at the TOP: newest bottom line visible, oldest history
    // line clipped away.
    expect(view.lastFrame()).toContain('bottom-6');
    expect(view.lastFrame()).not.toContain('history-0');
    view.unmount();
  });

  it('keeps the bottom region on the last row when content underfills', async () => {
    const view = renderRealTty(<CappedRoot vp={4} bottomLines={3} />, {
      columns: COLS,
      rows: ROWS,
    });
    await settle();
    const lines = view.lines();
    // Frame is exactly the cap height (fixed-height root renders its blank rows).
    expect(lines.length).toBe(ROWS);
    // Bottom region hugs the bottom edge; the blank slack sits at the top.
    expect(lines[ROWS - 1]?.trimEnd()).toBe('bottom-2');
    expect(lines[0]?.trim()).toBe('');
    view.unmount();
  });
});
