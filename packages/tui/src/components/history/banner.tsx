import type React from 'react';
import { Box, Text } from '../../ink.js';
import type { HistoryEntry } from './types.js';
import { shortenPath } from './utils.js';

// ── SVG-inspired "W" logo sign ─────────────────────────────────────────────
// The SVG has 4 orange #FD9F02 blocks (cols 0,2,3,4 at top)
// and 1 pink #FE2E5F block (col 1, shifted down) forming a stylised W.
const LOGO_COLS: ReadonlyArray<{
  color: string;
  rows: ReadonlyArray<boolean>;
}> = Object.freeze([
  { color: '#FD9F02', rows: [true,  true,  true,  false] },  // col 0 — orange
  { color: '#FE2E5F', rows: [false, true,  true,  true ] },  // col 1 — pink (shifted down)
  { color: '#FD9F02', rows: [true,  true,  true,  false] },  // col 2 — orange
  { color: '#FD9F02', rows: [true,  true,  true,  false] },  // col 3 — orange
  { color: '#FD9F02', rows: [true,  true,  true,  false] },  // col 4 — orange
]);

function LogoSymbol(): React.ReactElement {
  const rowCount = LOGO_COLS[0]!.rows.length;
  return (
    <Box flexDirection="column" alignSelf="center">
      {Array.from({ length: rowCount }, (_, ri) => (
        <Text key={ri} bold>
          {LOGO_COLS.map((col, ci) => (
            <Text key={ci} color={col.rows[ri] ? col.color : undefined}>
              {col.rows[ri] ? '█' : ' '}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}

// ── Wordmark glyphs ────────────────────────────────────────────────────────
// Each letter is rendered as a 7-row × 5-column block pattern.

const WORDMARK = 'WRONGSTACK';

const WORDMARK_GLYPHS: Readonly<Record<string, ReadonlyArray<string>>> = Object.freeze({
  W: [
    '█   █',
    '█   █',
    '█ █ █',
    '█ █ █',
    '█ █ █',
    '█   █',
    '█   █',
  ],
  R: [
    '████ ',
    '█   █',
    '█   █',
    '████ ',
    '█  █ ',
    '█   █',
    '█   █',
  ],
  O: [
    ' ███ ',
    '█   █',
    '█   █',
    '█   █',
    '█   █',
    '█   █',
    ' ███ ',
  ],
  N: [
    '█   █',
    '██  █',
    '██ ██',
    '█ █ █',
    '█  ██',
    '█  ██',
    '█   █',
  ],
  G: [
    ' ███ ',
    '█    ',
    '█  ██',
    '█   █',
    '█   █',
    '█   █',
    ' ███ ',
  ],
  S: [
    ' ███ ',
    '█    ',
    ' ███ ',
    '    █',
    '    █',
    '█   █',
    ' ███ ',
  ],
  T: [
    '█████',
    '  █  ',
    '  █  ',
    '  █  ',
    '  █  ',
    '  █  ',
    '  █  ',
  ],
  A: [
    ' ███ ',
    '█   █',
    '█   █',
    '█████',
    '█   █',
    '█   █',
    '█   █',
  ],
  C: [
    ' ███ ',
    '█    ',
    '█    ',
    '█    ',
    '█    ',
    '█    ',
    ' ███ ',
  ],
  K: [
    '█   █',
    '█  █ ',
    '███  ',
    '█ █  ',
    '█  █ ',
    '█   █',
    '█   █',
  ],
});

// ── Color gradient: orange (#FD9F02) → pink (#FE2E5F) ──────────────────────
// Mirrors the SVG palette.
const WORDMARK_COLORS: ReadonlyArray<string> = Object.freeze([
  '#FD9F02',  // W — orange
  '#FD9F02',  // R — orange
  '#F48433',  // O — warm orange
  '#F4644A',  // N — orange-red
  '#F45454',  // G — warm red
  '#F53E5D',  // S — red-pink
  '#FE2E5F',  // T — brand pink
  '#FE2E5F',  // A — brand pink
  '#FE2E5F',  // C — brand pink
  '#FE2E5F',  // K — brand pink
]);

const GLYPH_ROWS = 7;
const GLYPH_COLS = 5;
const WORDMARK_WIDTH = WORDMARK.length * GLYPH_COLS + WORDMARK.length - 1;
const DEFAULT_TERM_WIDTH = 80;

function truncateEnd(value: string, width: number): string {
  if (width <= 0) return '';
  if (value.length <= width) return value;
  if (width === 1) return '…';
  return `${value.slice(0, width - 1)}…`;
}

function Wordmark(): React.ReactElement {
  return (
    <Box flexDirection="column">
      {Array.from({ length: GLYPH_ROWS }, (_, row) => (
        <Text key={row} bold>
          {[...WORDMARK].map((letter, column) => (
            <Text key={`${letter}-${column}`} color={WORDMARK_COLORS[column]}>
              {WORDMARK_GLYPHS[letter]?.[row] ?? '     '}
              {column === WORDMARK.length - 1 ? '' : ' '}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}

// ── Decorative separator line (orange→pink gradient) ───────────────────────

function SeparatorLine({ contentWidth }: { contentWidth: number }): React.ReactElement {
  // The gradient gives ~40 % of the width to the sep, the rest to the tagline.
  const sepLen = Math.max(2, Math.floor(contentWidth * 0.35));
  const sepColors = ['#FD9F02', '#F48433', '#F45454', '#FE2E5F'];
  const segLen = Math.max(1, Math.floor(sepLen / sepColors.length));
  const segments = sepColors.map((c) => (
    <Text key={c} color={c}>{'─'.repeat(segLen)}</Text>
  ));
  // leftover chars
  const tail = sepLen - segLen * sepColors.length;
  if (tail > 0) {
    segments.push(<Text key="tail" color="#FE2E5F">{'─'.repeat(tail)}</Text>);
  }
  return <>{segments}</>;
}

// ── Fact row ───────────────────────────────────────────────────────────────

function Fact({
  icon,
  label,
  value,
  valueWidth,
  accent = false,
}: {
  icon: string;
  label: string;
  value: string;
  valueWidth: number;
  accent?: boolean | undefined;
}): React.ReactElement {
  return (
    <Text>
      <Text color={accent ? '#FD9F02' : '#FE2E5F'}>{icon}</Text>
      <Text color={accent ? '#FD9F02' : '#FE2E5F'} bold>{` ${label.padEnd(9)} `}</Text>
      <Text color={accent ? '#fff' : '#cdd6f4'}>{truncateEnd(value, valueWidth)}</Text>
    </Text>
  );
}

// ── Banner component ───────────────────────────────────────────────────────

/**
 * Startup splash with a wide ASCII wordmark, an SVG-inspired logo sign,
 * and an automatic compact mode. The width comes from History's live
 * terminal measurement, so the banner stays inside the viewport in both
 * inline and managed-history renderers.
 *
 * Colours follow the SVG brand palette: orange (#FD9F02) primary,
 * pink (#FE2E5F) accent.
 */
export function Banner({
  entry,
  termWidth = DEFAULT_TERM_WIDTH,
}: {
  entry: Extract<HistoryEntry, { kind: 'banner' }>;
  termWidth?: number | undefined;
}): React.ReactElement {
  const panelWidth = Math.max(20, Math.floor(termWidth));
  const compact = panelWidth < 56;
  const paddingX = compact ? 1 : 2;
  const contentWidth = Math.max(1, panelWidth - paddingX * 2 - 2);
  const showWordmark = contentWidth >= WORDMARK_WIDTH;
  // icon + leading gap + 9-column label + trailing gap
  const labelWidth = 12;
  const valueWidth = Math.max(1, contentWidth - labelWidth);
  const route = `${entry.provider} › ${entry.model}`;
  const cwdShort = shortenPath(entry.cwd, valueWidth);
  const shortcuts = compact
    ? '/help · F1 · F10 · /exit'
    : '/help · F1 projects · F10 sessions · /exit';
  const tagline = truncateEnd(
    compact ? ' WRONG STACK. RIGHT RESULTS.' : ' BUILT ON THE WRONG STACK. SHIPPED ANYWAY.',
    Math.max(1, contentWidth - 10),
  );
  const releaseVersion = truncateEnd(entry.version, Math.max(1, contentWidth - 9));

  const identity = (
    <Text>
      <Text backgroundColor="#FD9F02" color="#121210" bold>
        {' WrongStack '}
      </Text>
      {!compact ? <Text dimColor>{' // TERMINAL AI ENGINE'}</Text> : null}
    </Text>
  );
  const release = (
    <Text>
      <Text color="#a6e3a1">●</Text>
      <Text color="#a6e3a1"> READY </Text>
      <Text dimColor>v</Text>
      <Text bold>{releaseVersion}</Text>
    </Text>
  );

  return (
    <Box
      width={panelWidth}
      flexDirection="column"
      borderStyle="round"
      borderColor="#FD9F02"
      paddingX={paddingX}
      paddingY={0}
    >
      {compact ? (
        <>
          {identity}
          {release}
        </>
      ) : (
        <Box flexDirection="row" justifyContent="space-between">
          {identity}
          {release}
        </Box>
      )}

      {showWordmark ? (
        <>
          <Box marginTop={1} alignSelf="center">
            <LogoSymbol />
          </Box>
          <Box marginTop={1} marginBottom={1} alignSelf="center">
            <Wordmark />
          </Box>
        </>
      ) : (
        <Text color="#FD9F02" bold>
          {'▟▛ WRONG'}
          <Text color="#FE2E5F">STACK</Text>
        </Text>
      )}

      <Text>
        <SeparatorLine contentWidth={contentWidth} />
        <Text dimColor>{tagline}</Text>
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Fact icon="◆" label="ROUTE" value={route} valueWidth={valueWidth} accent />
        {entry.family ? (
          <Fact icon="◇" label="FAMILY" value={entry.family} valueWidth={valueWidth} />
        ) : null}
        {entry.keyTail ? (
          <Fact icon="◈" label="KEY" value={`•••• ${entry.keyTail}`} valueWidth={valueWidth} />
        ) : null}
        <Fact icon="⌁" label="WORKSPACE" value={cwdShort} valueWidth={valueWidth} />
        <Fact icon="⌘" label="COMMANDS" value={shortcuts} valueWidth={valueWidth} />
      </Box>
    </Box>
  );
}
