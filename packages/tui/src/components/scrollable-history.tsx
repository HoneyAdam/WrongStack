import type React from 'react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { computeWindow, EntryHeightCache } from '../height-cache.js';
import { SCROLLBAR_HIT_WIDTH } from '../hit-test.js';
import { Box, Text, useStdout } from '../ink.js';
import { theme } from '../theme.js';
import {
  estimateRenderGroupRows,
  groupEntries,
  renderGroupId,
  ToolGroup,
} from './history/tool-group.js';
import {
  ASSISTANT_TAIL_HEIGHT,
  AssistantTail,
  Entry,
  type HistoryEntry,
  type HistoryProps,
  MAX_STREAM_DISPLAY_CHARS,
  ToolStreamBox,
  tailForDisplay,
  toolStreamBoxHeight,
} from './history.js';

export interface ScrollableHistoryProps extends HistoryProps {
  /** Lines scrolled up from the bottom. 0 = pinned to the newest output. */
  scrollOffset: number;
  /** Height of the viewport in rows, computed by App from the bottom region. */
  viewportRows: number;
  /** Reports a bounded estimated scroll extent in rows. The estimate is seeded
   *  before first paint so long transcripts never require a full DOM mount just
   *  to measure themselves. Optional for isolated renderers. */
  onMeasure?: ((totalLines: number) => void) | undefined;
  /** Optional cap on the width used for entry wrapping (right panel mode). */
  maxWidth?: number | undefined;
}

/** Pure thumb geometry for the scrollbar: where the thumb starts and how many
 *  cells it spans, given the track height, scroll offset, and total content
 *  height. Exported for testing. */
export function scrollbarThumb(
  rows: number,
  offset: number,
  total: number,
): { top: number; size: number; scrollable: boolean } {
  const scrollable = total > rows;
  if (!scrollable) return { top: 0, size: rows, scrollable: false };
  // Visible window top in content-line space; 0 = oldest, total = newest.
  const windowTop = Math.max(0, total - rows - offset);
  const size = Math.max(1, Math.round((rows / total) * rows));
  const rawTop = Math.round((windowTop / total) * rows);
  const top = Math.max(0, Math.min(rawTop, rows - size));
  return { top, size, scrollable: true };
}

/** Inverse of {@link scrollbarThumb}: given a clicked/dragged 0-based cell on a
 *  track of `rows` height, return the scroll offset (rows up from the bottom)
 *  that lands the visible window there. Cell 0 (top) → oldest content (max
 *  offset); cell rows-1 (bottom) → newest (offset 0). Exported for testing and
 *  the TUI scrollbar mouse handler. */
export function scrollOffsetForTrackRow(rows: number, total: number, cell: number): number {
  if (total <= rows) return 0;
  const maxOffset = total - rows;
  const clampedCell = Math.max(0, Math.min(rows - 1, cell));
  const windowTop = Math.round((clampedCell / Math.max(1, rows - 1)) * maxOffset);
  return Math.max(0, Math.min(maxOffset, maxOffset - windowTop));
}

/**
 * Right-edge scrollbar for the managed viewport. A 1-column track with a thumb
 * sized and positioned from the scroll offset, total height, and viewport rows.
 * Always reserves its column so toggling scrollability does not reflow content.
 */
function Scrollbar({
  rows,
  offset,
  total,
}: {
  rows: number;
  offset: number;
  total: number;
}): React.ReactElement {
  const { top: thumbTop, size: thumbSize, scrollable } = scrollbarThumb(rows, offset, total);
  const cells: string[] = [];
  for (let i = 0; i < rows; i++) {
    cells.push(i >= thumbTop && i < thumbTop + thumbSize ? '█' : '│');
  }
  return (
    <Box flexDirection="column" marginLeft={1} flexShrink={0}>
      {cells.map((c, i) => (
        <Text
          key={i}
          {...(scrollable ? { color: theme.accent } : {})}
          dimColor={!scrollable || c === '│'}
        >
          {c}
        </Text>
      ))}
    </Box>
  );
}

/**
 * Bounded history viewport. Instead of streaming each entry into the terminal's
 * native scrollback via `<Static>`, it renders retained entries
 * into a fixed-height, `overflowY:'hidden'` viewport that the app scrolls
 * itself. PageUp/PageDown always scroll it; mouse mode additionally captures
 * wheel and scrollbar interactions.
 *
 * Mechanism (Ink-5 verified): the parent Box is height-bounded. At offset 0,
 * `justifyContent:'flex-end'` pins short content to the viewport bottom. Once
 * scrolled, `justifyContent:'flex-start'` anchors the computed virtual slice at
 * the top; `computeWindow()` selects the visible render groups, while its
 * partial-entry spacer and omitted-suffix spacer preserve row alignment.
 *
 * Streaming tails (assistant + tool) are a fixed-height suffix in the same
 * scroll space, so they auto-follow while pinned and move below the clip as the
 * offset crosses into committed history.
 *
 * Wrapped in `React.memo` so keystrokes in the input buffer don't
 * trigger a full managed-viewport re-layout. All props are primitives
 * or stable reducer references.
 */
export const ScrollableHistory = memo(function ScrollableHistory({
  entries,
  streamingText,
  toolStream,
  scrollOffset,
  viewportRows,
  onMeasure,
  maxWidth,
  setSuggestions,
  autonomyMode,
  multiDiffSummaryThreshold,
  todos,
  showModelReasoning,
}: ScrollableHistoryProps): React.ReactElement {
  const { stdout } = useStdout();
  const resolveViewportWidth = useCallback(() => {
    const raw = stdout?.columns ?? 80;
    return maxWidth ? Math.min(raw, maxWidth) : raw;
  }, [stdout, maxWidth]);
  const [viewportWidth, setViewportWidth] = useState(resolveViewportWidth);
  // The history column shares its row with a one-column scrollbar and its
  // one-column gap. Pass only the remaining width into entry/tail renderers so
  // long assistant/tool-result lines wrap before reaching the track.
  const termWidth = useMemo(
    () => Math.max(1, viewportWidth - SCROLLBAR_HIT_WIDTH),
    [viewportWidth],
  );
  useEffect(() => {
    const handleResize = () => {
      setViewportWidth(resolveViewportWidth());
    };
    stdout?.on('resize', handleResize);
    return () => {
      stdout?.off('resize', handleResize);
    };
  }, [stdout, resolveViewportWidth]);

  const tail = streamingText ? tailForDisplay(streamingText, MAX_STREAM_DISPLAY_CHARS) : '';
  const assistantTailHeight = tail ? ASSISTANT_TAIL_HEIGHT : 0;
  const toolTail = toolStream?.text
    ? tailForDisplay(toolStream.text, MAX_STREAM_DISPLAY_CHARS)
    : '';
  const toolTailHeight = toolTail && toolStream ? toolStreamBoxHeight(toolStream.name) : 0;
  const liveTailHeight = assistantTailHeight + toolTailHeight;
  const groupedEntries = useMemo(() => groupEntries(entries), [entries]);
  const groupIds = useMemo(() => groupedEntries.map(renderGroupId), [groupedEntries]);
  const groupIdsKey = groupIds.join(',');

  // Seed conservative heights before first paint so even a long resumed
  // transcript is virtualized immediately. Synchronization is keyed by stable
  // group ids because reducer commits often replace `entries` without changing
  // its content and should not repeat the O(n) cache preparation.
  const heightCacheRef = useRef<EntryHeightCache | null>(null);
  if (heightCacheRef.current === null) heightCacheRef.current = new EntryHeightCache();
  const heightCache = heightCacheRef.current;
  const preparedGroupIdsRef = useRef<string | null>(null);
  const preparedEstimateWidthRef = useRef<number | null>(null);
  if (
    preparedGroupIdsRef.current !== groupIdsKey ||
    preparedEstimateWidthRef.current !== termWidth
  ) {
    const estimateById = new Map(
      groupedEntries.map((group) => [renderGroupId(group), estimateRenderGroupRows(group, termWidth)]),
    );
    heightCache.sync(groupIds);
    heightCache.recordMany(groupIds.map((id) => [id, estimateById.get(id) ?? 3] as const));
    preparedGroupIdsRef.current = groupIdsKey;
    preparedEstimateWidthRef.current = termWidth;
  }

  const lastReported = useRef(-1);
  const cacheTotal = useMemo(() => heightCache.totalHeight(), [groupIdsKey, heightCache]);
  useLayoutEffect(() => {
    const reportedHeight = cacheTotal + liveTailHeight;
    if (reportedHeight === lastReported.current) return;
    lastReported.current = reportedHeight;
    onMeasure?.(reportedHeight);
  }, [cacheTotal, liveTailHeight, onMeasure]);

  // The cache owns committed-entry rows; live assistant/tool tails form a
  // separate, fixed-height suffix in the same scroll space. Keeping those
  // dimensions separate prevents callers from ambiguously including or
  // excluding live-tail rows in a fallback total.
  const entryTotal = cacheTotal;
  const scrollbarTotal = entryTotal + liveTailHeight;

  const vp = Math.max(1, viewportRows);
  // Clamp the shared entry+tail range here. When committed entries are
  // windowed below, computeWindow() independently clamps its viewportTop.
  const effectiveOffset = Math.min(
    Math.max(0, scrollOffset),
    Math.max(0, scrollbarTotal - vp),
  );

  // ── Virtual window computation ──────────────────────────────────────
  // When the cache has data and content exceeds the viewport, compute
  // which entries to render and how tall the spacers should be.
  const visibleTailRows = Math.max(0, liveTailHeight - effectiveOffset);
  const entryViewportRows = Math.max(1, vp - visibleTailRows);
  const entryScrollOffset = Math.max(0, effectiveOffset - liveTailHeight);
  const windowed =
    entryTotal > 0 && groupedEntries.length > 0 && entryTotal > entryViewportRows;
  const win = windowed
    ? computeWindow(
        entryTotal,
        entryViewportRows,
        entryScrollOffset,
        groupedEntries.length,
        heightCache,
      )
    : null;

  // Window the same render groups whose heights populate the cache, so virtual
  // indexes and rendered rows stay aligned when consecutive tools compact.
  const renderGroups = win?.windowed
    ? groupedEntries.slice(win.startIdx, win.endIdx)
    : groupedEntries;

  return (
    <Box flexDirection="row" width={viewportWidth}>
      <Box
        flexDirection="column"
        flexGrow={1}
        height={vp}
        overflowY="hidden"
        justifyContent={effectiveOffset > 0 ? 'flex-start' : 'flex-end'}
      >
        <Box flexDirection="column" flexShrink={0}>
          {/* `spacerAbove` is only the clipped part of the first visible entry;
              omitted entries are represented by the selected slice itself. */}
          {win?.windowed && win.spacerAbove > 0 ? (
            <Box height={win.spacerAbove} flexShrink={0} />
          ) : null}

          {/* Visible entries, with consecutive same-tool calls compacted under
              one header inside the already-selected virtual slice. */}
          {renderGroups.map((group) => {
            if (group.type === 'tool-group') {
              const groupId = renderGroupId(group);
              return (
                <Box key={`tool-group-${groupId}`} flexShrink={0}>
                  <ToolGroup data={group.data} termWidth={termWidth} />
                </Box>
              );
            }
            const { entry } = group;
            return (
              <Box
                key={entry.id}
                marginBottom={entry.kind === 'turn-summary' ? 1 : 0}
                flexShrink={0}
              >
                <Entry
                  entry={entry}
                  termWidth={termWidth}
                  termHeight={vp}
                  setSuggestions={setSuggestions}
                  autonomyMode={autonomyMode}
                  multiDiffSummaryThreshold={multiDiffSummaryThreshold}
                  todos={todos}
                  showModelReasoning={showModelReasoning}
                />
              </Box>
            );
          })}

          {/* Keep the live tail after the omitted suffix. At scrolled positions
              this spacer naturally pushes the tail below the clipped viewport. */}
          {win?.windowed && win.spacerBelow > 0 ? (
            <Box height={win.spacerBelow} flexShrink={0} />
          ) : null}

          {/* Streaming assistant tail — only rendered while content exists.
              When absent, the viewport's justifyContent="flex-end" keeps
              the remaining content pinned to the bottom with no gap. */}
          {tail ? (
            <Box height={ASSISTANT_TAIL_HEIGHT} flexShrink={0}>
              <AssistantTail text={tail} termWidth={termWidth} />
            </Box>
          ) : null}
          {toolTail && toolStream ? (
            <ToolStreamBox
              name={toolStream.name}
              text={toolTail}
              startedAt={toolStream.startedAt}
              termWidth={termWidth}
            />
          ) : null}
        </Box>
      </Box>
      <Scrollbar rows={vp} offset={effectiveOffset} total={scrollbarTotal} />
    </Box>
  );
});

// Re-exported for convenience so app.tsx can import both from one module.
export type { HistoryEntry };
