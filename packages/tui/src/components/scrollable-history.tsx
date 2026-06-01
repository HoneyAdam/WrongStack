import { Box, type DOMElement, measureElement, Text, useStdout } from 'ink';
import type React from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AssistantTail,
  Entry,
  type HistoryEntry,
  type HistoryProps,
  MAX_STREAM_DISPLAY_CHARS,
  ToolStreamBox,
  tailForDisplay,
} from './history.js';

/** Max history entries laid out in the managed viewport at once. Generous
 *  enough to cover a long session's in-app scrollback while bounding the
 *  per-frame Yoga layout cost. */
const MAX_MOUNTED = 500;

export interface ScrollableHistoryProps extends HistoryProps {
  /** Lines scrolled up from the bottom. 0 = pinned to the newest output. */
  scrollOffset: number;
  /** Height of the viewport in rows, computed by App from the bottom region. */
  viewportRows: number;
  /** Reports the measured total content height (rows) after every layout so
   *  App can clamp the scroll offset and drive the "N new lines" affordance. */
  onMeasure: (totalLines: number) => void;
}

/**
 * Mouse-mode replacement for {@link History}. Instead of streaming each entry
 * into the terminal's native scrollback via `<Static>`, it renders all entries
 * into a fixed-height, `overflowY:'hidden'` viewport that the app scrolls
 * itself. The terminal's wheel is captured by mouse mode, so scrolling MUST be
 * managed here.
 *
 * Mechanism (Ink-5 verified): the parent Box is height-bounded with
 * `justifyContent:'flex-end'`, so when content overflows, its BOTTOM aligns to
 * the viewport bottom — newest output visible, oldest clipped off the top. That
 * is the pinned (offset 0) state for free, with no height math. Scrolling up is
 * a single `marginBottom={scrollOffset}` on the content box: it pushes the
 * content up, dropping `scrollOffset` rows off the bottom of the clip and
 * revealing that many older rows at the top. Ink's output clipper slices the
 * over/underflowing child at both edges while preserving ANSI styling.
 *
 * Streaming tails (assistant + tool) are the last children of the content box,
 * so they participate in the scrolled content and auto-follow when pinned.
 */
export function ScrollableHistory({
  entries,
  streamingText,
  toolStream,
  scrollOffset,
  viewportRows,
  onMeasure,
}: ScrollableHistoryProps): React.ReactElement {
  const { stdout } = useStdout();
  const [termWidth, setTermWidth] = useState(stdout?.columns ?? 80);
  useEffect(() => {
    const onResize = () => setTermWidth(stdout?.columns ?? 80);
    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
    };
  }, [stdout]);

  const tail = streamingText ? tailForDisplay(streamingText, MAX_STREAM_DISPLAY_CHARS) : '';
  const toolTail = toolStream?.text
    ? tailForDisplay(toolStream.text, MAX_STREAM_DISPLAY_CHARS)
    : '';

  // Performance bound: the managed viewport re-lays-out every mounted entry
  // each frame (unlike the <Static> path, which prints once). Mounting only
  // the most recent MAX_MOUNTED keeps Yoga layout O(MAX_MOUNTED) regardless of
  // how long the session runs. Older entries stay in the reducer + on disk;
  // they're just not laid out. (True windowing — spacer boxes for measured
  // off-screen entries — is a later upgrade; this is the safe bound.)
  const hiddenCount = Math.max(0, entries.length - MAX_MOUNTED);
  const shown = hiddenCount > 0 ? entries.slice(-MAX_MOUNTED) : entries;

  // Measure the content box height after each commit and report it up only
  // when it changes. The content's own computed height does NOT depend on
  // viewportRows or marginBottom (margins/justify are layout-outside), so this
  // is stable — no measure → dispatch → re-measure feedback loop.
  const contentRef = useRef<DOMElement | null>(null);
  const lastReported = useRef(-1);
  useLayoutEffect(() => {
    const node = contentRef.current;
    if (!node) return;
    const { height } = measureElement(node);
    if (height !== lastReported.current) {
      lastReported.current = height;
      onMeasure(height);
    }
  });

  return (
    <Box
      flexDirection="column"
      height={Math.max(1, viewportRows)}
      overflowY="hidden"
      justifyContent="flex-end"
    >
      <Box
        ref={contentRef}
        flexDirection="column"
        marginBottom={Math.max(0, scrollOffset)}
        flexShrink={0}
      >
        {hiddenCount > 0 ? (
          <Box flexShrink={0}>
            <Text dimColor italic>
              {`  ↑ ${hiddenCount} earlier ${hiddenCount === 1 ? 'entry' : 'entries'} (scroll lives in this session; full log on disk)`}
            </Text>
          </Box>
        ) : null}
        {shown.map((entry) => (
          <Box key={entry.id} marginBottom={entry.kind === 'turn-summary' ? 1 : 0} flexShrink={0}>
            <Entry entry={entry} termWidth={termWidth} />
          </Box>
        ))}
        {tail ? <AssistantTail text={tail} /> : null}
        {toolTail ? (
          <ToolStreamBox
            name={toolStream!.name}
            text={toolTail}
            startedAt={toolStream!.startedAt}
            termWidth={termWidth}
          />
        ) : null}
      </Box>
    </Box>
  );
}

// Re-exported for convenience so app.tsx can import both from one module.
export type { HistoryEntry };
