/**
 * Anchor-based scroll model for the managed history viewport.
 *
 * The scroll position is a {@link ScrollAnchor}: the index of the render group
 * whose row band contains the viewport's top row, plus how many of that
 * group's rows are clipped above the viewport (`clip`). Rendering starts AT
 * the anchor and proceeds downward, so what appears on screen depends only on
 * the anchor and the heights of the groups actually mounted — never on the
 * (possibly estimated) heights of content above or below the window. That is
 * the property that kills the estimate-vs-actual spacer misalignment class of
 * bugs: an off-window estimate being wrong can no longer move a single pixel.
 *
 * `null` means "pinned to the newest output" (follow mode). Pinned rendering
 * uses `justifyContent:'flex-end'` and needs no position math at all.
 *
 * Prefix sums over the {@link EntryHeightCache} are still used — but only to
 * *translate* scroll gestures (wheel deltas, page jumps, scrollbar clicks)
 * into a new anchor, and to size the scrollbar thumb. Estimate error there
 * affects only the step size of a jump through unmeasured territory, which is
 * invisible; it can never misalign rendered content.
 *
 * Pure TypeScript — no React, no Ink. Unit-testable without mounting anything.
 */

import type { EntryHeightCache } from './height-cache.js';

/** Scroll position of the managed viewport. */
export interface ScrollAnchor {
  /** Index (into the render-group array) of the group at the viewport top. */
  index: number;
  /** Rows of that group clipped above the viewport top. Always >= 0 and less
   *  than the group's height (self-heals via clamping when heights change). */
  clip: number;
}

/** Everything the pure scroll math needs to know about current geometry. */
export interface ScrollGeometry {
  /** Height cache whose prefix sums cover exactly the render groups. */
  cache: EntryHeightCache;
  /** Number of render groups (must equal the cache's synced id count). */
  groupCount: number;
  /** Viewport height in rows (>= 1). */
  viewportRows: number;
  /** Fixed-height live tail rendered after the last group (0 when absent). */
  tailRows: number;
}

/** Extra rows mounted beyond the visible viewport so rapid scrolling has
 *  content ready before the next measurement pass. */
export const OVERSCAN_ROWS = 8;

/** Total scrollable content height in rows (groups + live tail). */
export function contentRows(geometry: ScrollGeometry): number {
  return geometry.cache.totalHeight() + geometry.tailRows;
}

/** Highest legal viewport-top row. 0 when everything fits in the viewport. */
export function maxTopRow(geometry: ScrollGeometry): number {
  return Math.max(0, contentRows(geometry) - Math.max(1, geometry.viewportRows));
}

/**
 * Absolute content row of the viewport top implied by an anchor, clamped to
 * the legal range. `null` (pinned) maps to {@link maxTopRow}.
 */
export function anchorTopRow(geometry: ScrollGeometry, anchor: ScrollAnchor | null): number {
  const max = maxTopRow(geometry);
  if (anchor === null) return max;
  const raw = geometry.cache.accumulatedHeight(anchor.index) + Math.max(0, anchor.clip);
  return Math.max(0, Math.min(max, raw));
}

/**
 * Anchor for an absolute viewport-top row. Returns `null` (pinned) when the
 * row is at or past the bottom-most position. The returned anchor always
 * points inside a real group: a top row landing inside the tail suffix is
 * clamped back onto the last group.
 */
export function anchorAtTopRow(geometry: ScrollGeometry, topRow: number): ScrollAnchor | null {
  const max = maxTopRow(geometry);
  if (max <= 0) return null;
  const clamped = Math.max(0, Math.min(max, Math.round(topRow)));
  if (clamped >= max) return null;
  const { cache, groupCount } = geometry;
  if (groupCount <= 0) return null;
  const index = Math.min(groupCount - 1, cache.entryIndexAtOffset(clamped));
  const clip = Math.max(0, clamped - cache.accumulatedHeight(index));
  return { index, clip };
}

/**
 * Move the viewport by `deltaUp` rows (positive scrolls toward older content,
 * negative toward newer). From pinned, positive deltas un-pin; reaching the
 * bottom returns `null` (re-pin).
 */
export function scrollAnchorBy(
  geometry: ScrollGeometry,
  current: ScrollAnchor | null,
  deltaUp: number,
): ScrollAnchor | null {
  return anchorAtTopRow(geometry, anchorTopRow(geometry, current) - deltaUp);
}

/** Anchor for the very top of the transcript (or `null` when it all fits). */
export function scrollAnchorToTop(geometry: ScrollGeometry): ScrollAnchor | null {
  return anchorAtTopRow(geometry, 0);
}

/** Rows moved by one PageUp/PageDown press. */
export function pageRows(viewportRows: number): number {
  return Math.max(1, viewportRows - 1);
}

/**
 * Anchor for a 0-based cell clicked on a scrollbar track of `viewportRows`
 * height: cell 0 → oldest content, the last cell → pinned to newest.
 */
export function anchorForTrackCell(
  geometry: ScrollGeometry,
  cell: number,
): ScrollAnchor | null {
  const rows = Math.max(1, geometry.viewportRows);
  const max = maxTopRow(geometry);
  if (max <= 0) return null;
  const clampedCell = Math.max(0, Math.min(rows - 1, cell));
  const topRow = Math.round((clampedCell / Math.max(1, rows - 1)) * max);
  return anchorAtTopRow(geometry, topRow);
}

/** Result of planning which groups to mount for one frame. */
export interface MountPlan {
  /** First group index to mount (inclusive). */
  startIdx: number;
  /** Last group index to mount (exclusive). */
  endIdx: number;
  /** Whether the live tail should be mounted after the groups. */
  mountTail: boolean;
}

/**
 * Plan the mounted window for a scrolled viewport: from the anchor downward
 * until the (estimated or measured) heights cover the anchor clip, the
 * viewport, the overscan, and `extraRows` of underfill correction. Estimates
 * only ever decide HOW MANY groups to mount — mounting too many is harmless
 * (the viewport clips them), and mounting too few is corrected by the
 * measurement pass bumping `extraRows`.
 */
export function planFromAnchor(
  geometry: ScrollGeometry,
  anchor: ScrollAnchor,
  extraRows = 0,
): MountPlan {
  const { cache, groupCount } = geometry;
  const startIdx = Math.max(0, Math.min(groupCount - 1, anchor.index));
  const needed =
    Math.max(0, anchor.clip) + Math.max(1, geometry.viewportRows) + OVERSCAN_ROWS + extraRows;
  const startTop = cache.accumulatedHeight(startIdx);
  let endIdx = startIdx;
  while (endIdx < groupCount && cache.accumulatedHeight(endIdx + 1) - startTop < needed) {
    endIdx++;
  }
  endIdx = Math.min(groupCount, endIdx + 1);
  return { startIdx, endIdx, mountTail: endIdx >= groupCount };
}

/**
 * Plan the mounted window for the pinned viewport: from the bottom upward
 * until the heights cover the viewport (minus the always-mounted tail) plus
 * overscan and correction. Overfill is clipped from the top by
 * `justifyContent:'flex-end'`, so generosity is safe.
 */
export function planPinned(geometry: ScrollGeometry, extraRows = 0): MountPlan {
  const { cache, groupCount } = geometry;
  const needed = Math.max(
    1,
    Math.max(1, geometry.viewportRows) + OVERSCAN_ROWS + extraRows - geometry.tailRows,
  );
  const total = cache.totalHeight();
  // Rows covered by groups [startIdx, groupCount) = total - accum(startIdx).
  let startIdx = groupCount;
  while (startIdx > 0 && total - cache.accumulatedHeight(startIdx) < needed) {
    startIdx--;
  }
  if (startIdx > 0) startIdx--;
  return { startIdx, endIdx: groupCount, mountTail: true };
}
