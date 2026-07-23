import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '../src/components/history.js';
import {
  type HistoryScrollController,
  ScrollableHistory,
} from '../src/components/scrollable-history.js';
import { renderRealTty, settle } from './helpers/real-tty.js';

/** Drop the 2-column scrollbar band so assertions read content only. */
const contentLines = (frame: string): string[] =>
  frame.split('\n').map((line) => line.slice(0, -2).trimEnd());

/** Longest run of consecutive blank content rows in a frame. Entry cards
 *  legitimately separate with up to ~2 blank rows; a longer run is a hole the
 *  viewport should never show while enough content exists. */
function longestBlankRun(frame: string): number {
  let run = 0;
  let longest = 0;
  for (const line of contentLines(frame)) {
    run = line === '' ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return longest;
}

/** Card entries M01..Mnn (~4 rows each), with `tallIds` rendered ~30 rows
 *  tall via a code fence — far taller than the mount-plan overscan slack, so
 *  an in-place collapse leaves a hole unless the pass re-measures. */
function makeEntries(count: number, tallIds: Set<number>, shrunk = false): HistoryEntry[] {
  return Array.from({ length: count }, (_, i) => {
    const id = i + 1;
    const n = String(id).padStart(2, '0');
    const tall = tallIds.has(id) && !shrunk;
    const text = tall
      ? `M${n} tall\n\`\`\`\n${Array.from({ length: 28 }, (_, r) => `row ${r + 1} of M${n}`).join('\n')}\n\`\`\``
      : `M${n} line`;
    return { id, kind: 'assistant', text } as HistoryEntry;
  });
}

function view(
  entries: HistoryEntry[],
  controllerRef: { current: HistoryScrollController | null },
  viewportRows: number,
) {
  return (
    <ScrollableHistory
      entries={entries}
      toolStream={null}
      viewportRows={viewportRows}
      controllerRef={controllerRef}
    />
  );
}

// In-place mutations: an entry's content changes WITHOUT its id changing
// (tool spinner → final result, stream tail collapsing into a compact card,
// a diff box rendering smaller than its placeholder). The measurement pass
// must re-run for such commits even though the group-id key is unchanged —
// otherwise the height cache goes stale: pinned mode under-mounts (blank band
// above the content), and a scrolled anchor keeps a clip larger than its
// shrunken group (viewport left mostly blank). These drive REAL Ink layout
// via the fake-TTY harness.
describe('in-place entry mutation (same ids, new heights)', () => {
  it('pinned: a mounted entry collapsing in place never leaves a hole above', async () => {
    const VP = 20;
    const controllerRef = { current: null as HistoryScrollController | null };
    const tall = new Set([28]);
    const v = renderRealTty(view(makeEntries(30, tall), controllerRef, VP), {
      columns: 60,
      rows: VP + 2,
    });
    await settle();
    expect(v.lastFrame()).toContain('M30');

    // Entry 28 collapses from ~30 rows to a 4-row card — same id, same order.
    v.rerender(view(makeEntries(30, tall, true), controllerRef, VP));
    await settle();

    expect(v.lastFrame()).toContain('M30');
    expect(
      longestBlankRun(v.lastFrame()),
      `hole in pinned viewport after in-place shrink:\n${v.lastFrame()}`,
    ).toBeLessThanOrEqual(3);
    v.unmount();
  });

  it('scrolled: the anchor entry collapsing in place keeps the viewport full', async () => {
    const VP = 20;
    const controllerRef = { current: null as HistoryScrollController | null };
    const tall = new Set([10]);
    const v = renderRealTty(view(makeEntries(40, tall), controllerRef, VP), {
      columns: 60,
      rows: VP + 2,
    });
    await settle();

    // Scroll to the top, then down until the viewport top row is inside
    // M10's tall body (9 cards ≈ 36 rows above it, then ~10 rows into it).
    controllerRef.current?.scrollToTop();
    await settle();
    controllerRef.current?.scrollBy(-46);
    await settle();
    expect(controllerRef.current?.isScrolled()).toBe(true);
    const before = contentLines(v.lastFrame());
    expect(before.some((line) => line.includes('of M10'))).toBe(true);

    // The anchor entry collapses to a 4-row card — its cached height (and the
    // stored clip) are now far larger than the entry itself.
    v.rerender(view(makeEntries(40, tall, true), controllerRef, VP));
    await settle();

    expect(
      longestBlankRun(v.lastFrame()),
      `hole in scrolled viewport after anchor shrink:\n${v.lastFrame()}`,
    ).toBeLessThanOrEqual(3);
    v.unmount();
  });

  it('pinned: growing a mounted entry in place keeps the newest entry visible', async () => {
    const VP = 20;
    const controllerRef = { current: null as HistoryScrollController | null };
    const tall = new Set([29]);
    // Start with the collapsed (card) variant, then grow entry 29.
    const v = renderRealTty(view(makeEntries(30, tall, true), controllerRef, VP), {
      columns: 60,
      rows: VP + 2,
    });
    await settle();
    expect(v.lastFrame()).toContain('M30');

    v.rerender(view(makeEntries(30, tall), controllerRef, VP));
    await settle();

    // Growth above the tail must not push the newest entry out of view.
    expect(v.lastFrame()).toContain('M30');
    v.unmount();
  });
});
