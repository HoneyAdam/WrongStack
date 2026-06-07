import { Box, Text, useStdout } from 'ink';
import type React from 'react';
import type { SlashCommandMatch } from '../app.js';

export interface SlashMenuProps {
  query: string;
  matches: SlashCommandMatch[];
  selected: number;
}

type Row =
  | { type: 'header'; category: string }
  | { type: 'item'; match: SlashCommandMatch; index: number };

export function SlashMenu({ query, matches, selected }: SlashMenuProps): React.ReactElement {
  const placeholder = query ? `/${query}` : '/';
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;

  // Build the flat row list (category headers interleaved with items) while
  // preserving the flat item ordering used for keyboard navigation.
  const rows: Row[] = [];
  let lastCategory = '';
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i] as SlashCommandMatch;
    if (m.category !== lastCategory) {
      lastCategory = m.category;
      rows.push({ type: 'header', category: m.category });
    }
    rows.push({ type: 'item', match: m, index: i });
  }

  // Budget how many rows we can show without overflowing the terminal. Reserve
  // space for: hint line (1) + border (2) + padding (2) + the two "+N more"
  // indicators (2) + a few rows for the prompt/input below the menu (~6).
  const overhead = 1 + 2 + 2 + 2 + 6;
  const maxBodyRows = Math.max(4, termRows - overhead);

  // Window the rows around the selected item so the menu fits on screen and
  // scrolls as the selection moves. We window over the flat `rows` array (which
  // includes headers) and re-attach the header for the first visible item so a
  // scrolled view never loses its category context.
  const selectedRowIdx = rows.findIndex((r) => r.type === 'item' && r.index === selected);
  const visible = windowRows(rows, selectedRowIdx < 0 ? 0 : selectedRowIdx, maxBodyRows);

  const hiddenAbove = visible.start;
  const hiddenBelow = rows.length - visible.end;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text dimColor>
        {placeholder || '/'} — ↑/↓ select, Enter dispatch, Tab autocomplete, Esc close
        {matches.length > 0 ? `  (${selected + 1}/${matches.length})` : ''}
      </Text>
      {hiddenAbove > 0 && <Text dimColor>{'  '}↑ {hiddenAbove} more</Text>}
      {visible.contextHeader && (
        <Text bold color="yellow" dimColor>
          {'  '}{visible.contextHeader}
        </Text>
      )}
      {visible.rows.map((row) => {
        if (row.type === 'header') {
          return (
            <Text key={`cat-${row.category}`} bold color="yellow" dimColor>
              {'  '}{row.category}
            </Text>
          );
        }
        const { match: m, index: i } = row;
        return (
          <Text key={m.name} inverse={i === selected} {...(i === selected ? { color: 'cyan' } : {})}>
            {i === selected ? '› ' : '  '}
            <Text bold>{m.name}</Text>
            {m.argsHint ? <Text dimColor> {m.argsHint}</Text> : null}
            <Text dimColor> — {m.description}</Text>
          </Text>
        );
      })}
      {hiddenBelow > 0 && <Text dimColor>{'  '}↓ {hiddenBelow} more</Text>}
      {matches.length === 0 && <Text dimColor>No matching commands</Text>}
    </Box>
  );
}

/**
 * Pick a contiguous slice of `rows` of at most `max` entries that keeps the row
 * at `focus` visible, scrolling the window as `focus` moves toward either edge.
 * Returns the slice plus the [start, end) bounds (so the caller can render
 * "+N more" indicators) and, when the slice starts mid-category, the category
 * header to re-attach above it so context is never lost while scrolled.
 */
function windowRows(
  rows: Row[],
  focus: number,
  max: number,
): { rows: Row[]; start: number; end: number; contextHeader: string | null } {
  if (rows.length <= max) {
    return { rows, start: 0, end: rows.length, contextHeader: null };
  }
  // Center the focus in the window, then clamp to the array bounds.
  let start = focus - Math.floor(max / 2);
  if (start < 0) start = 0;
  let end = start + max;
  if (end > rows.length) {
    end = rows.length;
    start = end - max;
  }
  // If the window starts on an item, find the category header that governs it
  // so a scrolled view still shows which category the first item belongs to.
  let contextHeader: string | null = null;
  if (start > 0) {
    const first = rows[start];
    if (first && first.type === 'item') {
      for (let i = start - 1; i >= 0; i--) {
        const r = rows[i];
        if (r && r.type === 'header') {
          contextHeader = r.category;
          break;
        }
      }
    }
  }
  return { rows: rows.slice(start, end), start, end, contextHeader };
}
