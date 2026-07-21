import type React from 'react';
import { useEffect, useState } from 'react';
import { Box, Text } from '../../ink.js';
import { mixHex } from '../animation-style.js';
import type { AutonomyAgentStatus, HistoryEntry } from './types.js';
import { shortenPath } from './utils.js';

// Canonical palette from website/public/wrongstack.svg. The mark itself keeps
// these exact colours; only the large terminal wordmark interpolates between
// them.
const STACK_ORANGE = '#FD9F02';
const SIGNAL_PINK = '#FE2E5F';
const BORDER = '#3B3C36';
const MUTED = '#B6B2A8';
const TEXT = '#F5F2E9';

// The SVG is five 60px blocks: four orange blocks share a baseline and the
// pink second block is shifted down by half a block. Two terminal cells make
// each block approximately square in a monospace font.
//
// Row 0: orange blocks with a gap at the pink's home column (1).
// Row 1: full row — orange everywhere except the pink block.
// Row 2: the pink block's "tail" hanging below.
const MARK_COLS = 5;
const PINK_HOME = 1; // resting column for the pink block (0-indexed)

// ── Pink-square bounce animation ─────────────────────────────────────────
// The real mark offsets its pink tile by half a block. In the terminal we
// occasionally lift that tile by one text row, then let it settle. The long
// resting section makes this feel like a small logo gesture instead of a
// loading spinner.
const BOUNCE_INTERVAL_MS = 160;
const PINK_BOUNCE_FRAMES: readonly (0 | 1)[] = Object.freeze([
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1,
]);

export function brandMarkPinkRow(frame: number): 0 | 1 {
  const index = Math.max(0, Math.trunc(frame)) % PINK_BOUNCE_FRAMES.length;
  return PINK_BOUNCE_FRAMES[index] ?? 1;
}

function BrandMark({ pinkRow = 1 }: { pinkRow?: 0 | 1 }): React.ReactElement {
  const rows = Array.from({ length: 3 }, (_, row) =>
    Array.from({ length: MARK_COLS }, (_, column) => {
      if (column === PINK_HOME && (row === pinkRow || row === pinkRow + 1)) {
        return SIGNAL_PINK;
      }
      if (row < 2 && column !== PINK_HOME) return STACK_ORANGE;
      return null;
    }),
  );

  return (
    <Box flexDirection="column" alignItems="center">
      {rows.map((row, rowIndex) => (
        <Text key={rowIndex} bold>
          {row.map((color, columnIndex) => (
            <Text key={columnIndex} color={color ?? undefined}>
              {color ? '██' : '  '}
              {columnIndex < row.length - 1 ? ' ' : ''}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}

/** Hook that drives the mark's restrained vertical bounce. */
function useBrandMarkAnimation(enabled: boolean): 0 | 1 {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % PINK_BOUNCE_FRAMES.length);
    }, BOUNCE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled]);

  return brandMarkPinkRow(frame);
}

// ── Soft 5×5 wordmark ─────────────────────────────────────────────────────
//
// Each letter is designed on a 5×5 grid where every cell carries a *density*
// in {0,1,2,3}.  Rendering expands every cell into two terminal rows:
//
//   0 = empty        (top ' '  bottom ' ')
//   1 = lower half   (top ' '  bottom '▄')
//   2 = upper half   (top '▀'  bottom ' ')
//   3 = full         (top '▀'  bottom '█')
//
// The half-block density values let diagonals and slanted strokes fade in
// and out smoothly (e.g. the W's centre "V" can drop from full → upper-half
// → empty across the three columns) instead of the previous hard
// "either fully lit or fully blank" look.  The result is a 10-row × 5-col
// glyph per letter, keeping the same 53-column footprint as the old design
// (9 letters × 5 cols + 8 letter-spacers) while doubling the vertical
// resolution of the curves.
//
// Glyph tables are written as 5 rows of 5 single-digit tokens.  A small
// helper below decodes them into the 10 terminal lines the renderer paints.
const WORDMARK_GLYPH_DENSITY: Readonly<Record<string, ReadonlyArray<string>>> = Object.freeze({
  W: Object.freeze([
    '30003',
    '30003',
    '30303',
    '32323',
    '33033',
  ]),
  R: Object.freeze([
    '33002',
    '30003',
    '33002',
    '30230',
    '30003',
  ]),
  O: Object.freeze([
    '02330',
    '30003',
    '30003',
    '30003',
    '02330',
  ]),
  N: Object.freeze([
    '30003',
    '33003',
    '30303',
    '30033',
    '30003',
  ]),
  G: Object.freeze([
    '02332',
    '30000',
    '30233',
    '30003',
    '02330',
  ]),
  S: Object.freeze([
    '02332',
    '30000',
    '02330',
    '00003',
    '33220',
  ]),
  T: Object.freeze([
    '33333',
    '00200',
    '00200',
    '00200',
    '00200',
  ]),
  A: Object.freeze([
    '02330',
    '30003',
    '33333',
    '30003',
    '30003',
  ]),
  C: Object.freeze([
    '02332',
    '30000',
    '30000',
    '30000',
    '02332',
  ]),
  K: Object.freeze([
    '30003',
    '30030',
    '33300',
    '30030',
    '30003',
  ]),
});

const WORDMARK = 'WRONGSTACK';
const WORDMARK_GLYPH_ROWS = 5;
const WORDMARK_GLYPH_COLS = 5;
const WORDMARK_RENDER_ROWS = WORDMARK_GLYPH_ROWS * 2; // 10
const GLYPH_WIDTH = WORDMARK_GLYPH_COLS;
const WORDMARK_WIDTH = WORDMARK.length * GLYPH_WIDTH + WORDMARK.length - 1;

// Map a single cell density (0..3) to the character painted on the *upper*
// half of the 2-row cell.  The lower half is computed by the same table
// shifted one position down, so density 3 ('█' on both rows) yields the
// classic fully-filled block.
const CELL_TOP: Readonly<Record<0 | 1 | 2 | 3, string>> = Object.freeze({
  0: ' ',
  1: ' ',
  2: '▀',
  3: '▀',
});
const CELL_BOTTOM: Readonly<Record<0 | 1 | 2 | 3, string>> = Object.freeze({
  0: ' ',
  1: '▄',
  2: ' ',
  3: '█',
});

/**
 * Decode a 5-row density table into 10 terminal lines of 5 characters each.
 * Exported for testing.
 */
export function decodeSoftGlyph(density: ReadonlyArray<string>): ReadonlyArray<string> {
  if (density.length !== WORDMARK_GLYPH_ROWS) {
    throw new Error(`soft glyph must be ${WORDMARK_GLYPH_ROWS} rows, got ${density.length}`);
  }
  const out: string[] = [];
  for (let row = 0; row < WORDMARK_GLYPH_ROWS; row++) {
    const tokens = density[row] ?? '';
    if (tokens.length !== WORDMARK_GLYPH_COLS) {
      throw new Error(`soft glyph row must be ${WORDMARK_GLYPH_COLS} columns, got ${tokens.length}`);
    }
    let topChunk = '';
    let bottomChunk = '';
    for (let col = 0; col < WORDMARK_GLYPH_COLS; col++) {
      const token = tokens[col];
      const value = (token === '0' || token === '1' || token === '2' || token === '3'
        ? (Number(token) as 0 | 1 | 2 | 3)
        : 0);
      topChunk += CELL_TOP[value];
      bottomChunk += CELL_BOTTOM[value];
    }
    out.push(topChunk, bottomChunk);
  }
  return Object.freeze(out);
}

const WORDMARK_GLYPH_LINES: Readonly<Record<string, ReadonlyArray<string>>> = Object.freeze(
  Object.fromEntries(
    Object.keys(WORDMARK_GLYPH_DENSITY).flatMap((letter) => {
      const glyph = WORDMARK_GLYPH_DENSITY[letter];
      return glyph ? [[letter, decodeSoftGlyph(glyph)] as const] : [];
    }),
  ),
);

const WORDMARK_LINES = Object.freeze(
  Array.from({ length: WORDMARK_RENDER_ROWS }, (_, row) =>
    [...WORDMARK]
      .map((letter) => WORDMARK_GLYPH_LINES[letter]?.[row] ?? ' '.repeat(GLYPH_WIDTH))
      .join(' '),
  ),
);

export function bannerGradientColor(position: number, length: number): string {
  const progress = length > 1 ? position / (length - 1) : 0.5;
  return mixHex(STACK_ORANGE, SIGNAL_PINK, progress);
}

function GradientText({ text }: { text: string }): React.ReactElement {
  return (
    <Text bold>
      {[...text].map((character, index) =>
        character === ' ' ? (
          ' '
        ) : (
          <Text key={index} color={bannerGradientColor(index, text.length)}>
            {character}
          </Text>
        ),
      )}
    </Text>
  );
}

function PixelWordmark(): React.ReactElement {
  return (
    <Box flexDirection="column" alignItems="center">
      {WORDMARK_LINES.map((line, row) => (
        <GradientText key={row} text={line} />
      ))}
    </Box>
  );
}

function trunc(value: string, width: number): string {
  if (width <= 0 || !value) return '';
  if (value.length <= width) return value;
  return width === 1 ? '…' : `${value.slice(0, width - 1)}…`;
}

function InfoRow({
  icon,
  label,
  value,
  contentWidth,
  compact = false,
  accent = false,
}: {
  icon: string;
  label: string;
  value: string;
  contentWidth: number;
  compact?: boolean;
  accent?: boolean;
}): React.ReactElement {
  const labelWidth = compact ? 6 : 9;
  const valueWidth = Math.max(1, contentWidth - labelWidth - 3);
  const color = accent ? STACK_ORANGE : MUTED;
  return (
    <Text>
      <Text color={color}>{icon}</Text>
      <Text color={color} bold>{` ${trunc(label, labelWidth).padEnd(labelWidth)} `}</Text>
      <Text color={accent ? TEXT : MUTED}>{trunc(value, valueWidth)}</Text>
    </Text>
  );
}

// Renders the profile row with the full config.json path, highlighting the
// profile-name segment (the directory between "profiles/" and "/config.json")
// in the accent color. Falls back to a plain InfoRow when only the bare
// profile name is available. When the path overflows the value column it is
// shortened from the left (…/<tail>) so the trailing filename survives.
function ProfileRow({
  profile,
  profileConfigPath,
  contentWidth,
  compact,
}: {
  profile?: string | undefined;
  profileConfigPath?: string | undefined;
  contentWidth: number;
  compact: boolean;
}): React.ReactElement | null {
  if (!profileConfigPath && !profile) return null;
  const labelWidth = compact ? 6 : 9;
  const valueWidth = Math.max(1, contentWidth - labelWidth - 3);
  const icon = '⚙';
  const label = 'profile';

  // Bare-name fallback: render as a normal accent InfoRow.
  if (!profileConfigPath) {
    return (
      <InfoRow
        icon={icon}
        label={label}
        value={profile as string}
        contentWidth={contentWidth}
        compact={compact}
        accent
      />
    );
  }

  const fullPath = profileConfigPath;
  const displayPath =
    fullPath.length <= valueWidth ? fullPath : shortenPath(fullPath, valueWidth);

  // Locate the profile-name segment so we can highlight just that part.
  // Match either "/profiles/<name>/config.json" or "\profiles\<name>\config.json".
  const segmentMatch = fullPath.match(/[/\\]profiles[/\\]([^/\\]+)[/\\]config\.json$/);
  const profileSegment = segmentMatch?.[1] ?? '';
  // lastIndexOf returns -1 when the segment was truncated away — in that case
  // we fall through to a plain muted render rather than mis-highlighting.
  const segIdx = profileSegment ? displayPath.lastIndexOf(profileSegment) : -1;

  return (
    <Text>
      <Text color={STACK_ORANGE}>{icon}</Text>
      <Text color={STACK_ORANGE} bold>{` ${trunc(label, labelWidth).padEnd(labelWidth)} `}</Text>
      {segIdx >= 0 && profileSegment ? (
        <>
          <Text color={MUTED}>{displayPath.slice(0, segIdx)}</Text>
          <Text color={STACK_ORANGE} bold>{profileSegment}</Text>
          <Text color={MUTED}>{displayPath.slice(segIdx + profileSegment.length)}</Text>
        </>
      ) : (
        <Text color={MUTED}>{displayPath}</Text>
      )}
    </Text>
  );
}

// OSC 8 terminal hyperlinks — the same escape-sequence mechanism used by the
// OAuth flows. Terminals that support clickable links (iTerm2, Windows Terminal,
// Kitty, etc.) will render these as interactive; others see plain underlined text.
const OSC8_WRONGSTACK =
  '\x1b]8;;https://wrongstack.com\x1b\\wrongstack.com\x1b]8;;\x1b\\';
const OSC8_GITHUB =
  '\x1b]8;;https://github.com/wrongstack/wrongstack\x1b\\github\x1b]8;;\x1b\\';

function Footer({ contentWidth, compact }: { contentWidth: number; compact: boolean }): React.ReactElement {
  return (
    <Box flexDirection="column" alignItems="center" marginTop={1} marginBottom={1}>
      <Text>
        <Text color={SIGNAL_PINK}>◆ </Text>
        <Text dimColor>{OSC8_WRONGSTACK}</Text>
        {!compact || contentWidth >= 35 ? (
          <>
            <Text dimColor> · </Text>
            <Text color={STACK_ORANGE}>★ </Text>
            <Text dimColor>{OSC8_GITHUB}</Text>
          </>
        ) : null}
      </Text>
    </Box>
  );
}

// ── Animated autonomy agent status ────────────────────────────────────────

/** Frames for the alive-spinner next to each online agent. */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL_MS = 100;
/** Agent display order (canonical left-to-right). */
const AGENT_ORDER: ReadonlyArray<string> = [
  'Brain',
  'Shadow',
  'Kanban',
  'Mailbox',
  'Memory',
];

function AutonomyAgentsSection({
  agents,
  contentWidth,
  compact,
}: {
  agents: ReadonlyArray<AutonomyAgentStatus>;
  contentWidth: number;
  compact: boolean;
}): React.ReactElement {
  // Animated spinner frame — cycles through the braille spinners.
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // Build a lookup so we preserve the canonical order.
  const lookup = new Map(agents.map((a) => [a.name, a]));

  // Decide per-agent indicator
  const spinner = SPINNER_FRAMES[frame];
  const maxLabelWidth = Math.max(1, contentWidth - 4);

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Thin rule to separate from footer */}
      <Text color={BORDER}>──────────────</Text>
      <Box flexDirection="row" flexWrap="wrap" marginTop={0}>
        {AGENT_ORDER.map((name) => {
          const agent = lookup.get(name);
          if (!agent) return null;

          const online = agent.online;
          const indicator = online ? spinner : '·';
          const color = online ? STACK_ORANGE : MUTED;
          const detail = agent.detail;

          return (
            <Box key={name} flexDirection="row" marginRight={2}>
              <Text color={color}>{indicator}</Text>
              <Text color={color}>{' '}{trunc(compact ? name.slice(0, 4) : name, compact ? 4 : 8)}</Text>
              {!compact && detail ? (
                <Text dimColor>{' '}{trunc(detail, Math.max(1, maxLabelWidth - 12))}</Text>
              ) : null}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

const DEFAULT_TERM_WIDTH = 80;
const FULL_LAYOUT_MIN_WIDTH = WORDMARK_WIDTH + 6;

export function Banner({
  entry,
  termWidth = DEFAULT_TERM_WIDTH,
}: {
  entry: Extract<HistoryEntry, { kind: 'banner' }>;
  termWidth?: number;
}): React.ReactElement {
  const panelWidth = Math.max(20, Math.floor(termWidth));
  const compact = panelWidth < FULL_LAYOUT_MIN_WIDTH;
  const paddingX = compact ? 1 : 2;
  const contentWidth = Math.max(1, panelWidth - paddingX * 2 - 2);
  const cwd = shortenPath(entry.cwd, Math.max(1, contentWidth - (compact ? 9 : 12)));
  const version = trunc(entry.version, Math.max(1, contentWidth - 1));
  const route = `${entry.provider} › ${entry.model}`;

  // Keep motion to the small brand mark and only in the full layout.
  const pinkRow = useBrandMarkAnimation(!compact);

  return (
    <Box
      width={panelWidth}
      flexDirection="column"
      borderStyle="round"
      borderColor={BORDER}
      paddingX={paddingX}
      paddingY={0}
    >
      <Box justifyContent="flex-end" marginTop={1}>
        <Text color={MUTED}>v{version}</Text>
        {entry.updateAvailable && entry.latestVersion ? (
          <Text color={STACK_ORANGE}> · (update available: v{entry.latestVersion})</Text>
        ) : null}
      </Box>

      <Box justifyContent="center" marginTop={compact ? 0 : 1}>
        <BrandMark pinkRow={pinkRow} />
      </Box>

      {compact ? (
        <>
          <Box justifyContent="center" marginTop={1}>
            <GradientText text="WrongStack" />
          </Box>
          <Box justifyContent="center">
            <Text color={MUTED}>{trunc('TERMINAL AI ENGINE', contentWidth)}</Text>
          </Box>
        </>
      ) : (
        <>
          <Box justifyContent="center" marginTop={1}>
            <PixelWordmark />
          </Box>
          <Box justifyContent="center" marginTop={1}>
            <Text color={MUTED} italic>
              BUILT ON THE WRONG STACK. SHIPPED ANYWAY.
            </Text>
          </Box>
        </>
      )}

      <Box flexDirection="column" marginTop={1}>
        <InfoRow
          icon="◆"
          label="route"
          value={route}
          contentWidth={contentWidth}
          compact={compact}
          accent
        />
        {entry.family ? (
          <InfoRow
            icon="◇"
            label="family"
            value={entry.family}
            contentWidth={contentWidth}
            compact={compact}
          />
        ) : null}
        {entry.keyTail ? (
          <InfoRow
            icon="◈"
            label="key"
            value={`•••• ${entry.keyTail}`}
            contentWidth={contentWidth}
            compact={compact}
          />
        ) : null}
        {entry.sessionId ? (
          <InfoRow
            icon="◈"
            label="session"
            value={entry.sessionId}
            contentWidth={contentWidth}
            compact={compact}
          />
        ) : null}
        <InfoRow
          icon="⌁"
          label={compact ? 'cwd' : 'workspace'}
          value={cwd}
          contentWidth={contentWidth}
          compact={compact}
        />
        <ProfileRow
          profile={entry.profile}
          profileConfigPath={entry.profileConfigPath}
          contentWidth={contentWidth}
          compact={compact}
        />
      </Box>

      <Footer contentWidth={contentWidth} compact={compact} />

      {entry.autonomyAgents && entry.autonomyAgents.length > 0 ? (
        <AutonomyAgentsSection
          agents={entry.autonomyAgents}
          contentWidth={contentWidth}
          compact={compact}
        />
      ) : null}
    </Box>
  );
}
