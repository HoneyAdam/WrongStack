import type React from 'react';
import { Box, Text } from '../../ink.js';
import type { HistoryEntry } from './types.js';
import { shortenPath } from './utils.js';
import { mixHex } from '../animation-style.js';
import { useEffect, useState } from 'react';
import type { AutonomyAgentStatus } from './types.js';

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
const MARK_ROWS: ReadonlyArray<ReadonlyArray<string | null>> = Object.freeze([
  Object.freeze([STACK_ORANGE, null, STACK_ORANGE, STACK_ORANGE, STACK_ORANGE]),
  Object.freeze([STACK_ORANGE, SIGNAL_PINK, STACK_ORANGE, STACK_ORANGE, STACK_ORANGE]),
  Object.freeze([null, SIGNAL_PINK, null, null, null]),
]);

function BrandMark(): React.ReactElement {
  return (
    <Box flexDirection="column" alignItems="center">
      {MARK_ROWS.map((row, rowIndex) => (
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

// Five-row pixel lettering echoes the crisp block construction of the logo.
// At 59 columns it fits a standard 80-column terminal without looking cramped.
const PIXEL_GLYPHS: Readonly<Record<string, ReadonlyArray<string>>> = Object.freeze({
  W: Object.freeze(['█   █', '█   █', '█ █ █', '█ █ █', ' █ █ ']),
  R: Object.freeze(['████ ', '█   █', '████ ', '█  █ ', '█   █']),
  O: Object.freeze([' ███ ', '█   █', '█   █', '█   █', ' ███ ']),
  N: Object.freeze(['█   █', '██  █', '█ █ █', '█  ██', '█   █']),
  G: Object.freeze([' ████', '█    ', '█  ██', '█   █', ' ████']),
  S: Object.freeze([' ████', '█    ', ' ███ ', '    █', '████ ']),
  T: Object.freeze(['█████', '  █  ', '  █  ', '  █  ', '  █  ']),
  A: Object.freeze([' ███ ', '█   █', '█████', '█   █', '█   █']),
  C: Object.freeze([' ████', '█    ', '█    ', '█    ', ' ████']),
  K: Object.freeze(['█   █', '█  █ ', '███  ', '█  █ ', '█   █']),
});

const WORDMARK = 'WRONGSTACK';
const WORDMARK_ROWS = 5;
const GLYPH_WIDTH = 5;
const WORDMARK_WIDTH = WORDMARK.length * GLYPH_WIDTH + WORDMARK.length - 1;
const WORDMARK_LINES = Object.freeze(
  Array.from({ length: WORDMARK_ROWS }, (_, row) =>
    [...WORDMARK]
      .map((letter) => PIXEL_GLYPHS[letter]?.[row] ?? ' '.repeat(GLYPH_WIDTH))
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
      </Box>

      <Box justifyContent="center" marginTop={compact ? 0 : 1}>
        <BrandMark />
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
        {entry.profile ? (
          <InfoRow
            icon="⚙"
            label="profile"
            value={entry.profile}
            contentWidth={contentWidth}
            compact={compact}
            accent
          />
        ) : null}
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
