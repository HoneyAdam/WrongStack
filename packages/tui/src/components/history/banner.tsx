import type React from 'react';
import { Box, Text } from '../../ink.js';
import type { HistoryEntry } from './types.js';
import { shortenPath } from './utils.js';

// ── Brand palette (from website/public/wrongstack.svg) ────────────────
const O = '#FD9F02'; // orange primary
const P = '#FE2E5F'; // pink accent

// ── SVG-inspired "W" logo sign ────────────────────────────────────────
// The SVG has 4 orange blocks (cols 0,2,3,4 at y=170) and 1 pink block
// (col 1 at y=200, shifted 30px down) forming an asymmetric "W".
//
// ASCII: 3 rows × 5 columns. Each block = '██', gap = ' '.
//   ██    ██ ██ ██    ← orange (top: cols 0,2,3,4)
//   ██ ██ ██ ██ ██    ← all 5 (mid: orange + pink)
//     ██              ← pink only (bottom: col 1)
const LOGO_COLS = Object.freeze([
  { c: O, r: Object.freeze([true, true, false]) }, // col 0 — orange, rows 0-1
  { c: P, r: Object.freeze([false, true, true]) }, // col 1 — pink, rows 1-2
  { c: O, r: Object.freeze([true, true, false]) }, // col 2 — orange, rows 0-1
  { c: O, r: Object.freeze([true, true, false]) }, // col 3 — orange, rows 0-1
  { c: O, r: Object.freeze([true, true, false]) }, // col 4 — orange, rows 0-1
]) satisfies ReadonlyArray<{
  c: string;
  r: ReadonlyArray<boolean>;
}>;

function LogoSymbol(): React.ReactElement {
  return (
    <Box flexDirection="column" alignSelf="flex-start">
      {[0, 1, 2].map((ri) => (
        <Text key={ri} bold>
          {LOGO_COLS.map((col, ci) => (
            <Text key={ci}>
              <Text color={col.r[ri] ? col.c : undefined}>
                {col.r[ri] ? '██' : '  '}
              </Text>
              {ci < LOGO_COLS.length - 1 ? ' ' : null}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}

// ── "WRONGSTACK" wordmark (7-row block glyphs) ────────────────────────
const WORDMARK_LETTERS: Record<
  string,
  ReadonlyArray<string>
> = Object.freeze({
  W: Object.freeze([
    '█   █',
    '█   █',
    '█ █ █',
    '█ █ █',
    '█ █ █',
    '█ █ █',
    '█   █',
  ]),
  R: Object.freeze([
    '████ ',
    '█   █',
    '█   █',
    '████ ',
    '█ █  ',
    '█  █ ',
    '█   █',
  ]),
  O: Object.freeze([
    ' ███ ',
    '█   █',
    '█   █',
    '█   █',
    '█   █',
    '█   █',
    ' ███ ',
  ]),
  N: Object.freeze([
    '█   █',
    '██  █',
    '██ ██',
    '█ █ █',
    '█  ██',
    '█  ██',
    '█   █',
  ]),
  G: Object.freeze([
    ' ███ ',
    '█    ',
    '█    ',
    '█  ██',
    '█   █',
    '█   █',
    ' ███ ',
  ]),
  S: Object.freeze([
    ' ███ ',
    '█    ',
    '█    ',
    ' ███ ',
    '    █',
    '█   █',
    ' ███ ',
  ]),
  T: Object.freeze([
    '█████',
    '  █  ',
    '  █  ',
    '  █  ',
    '  █  ',
    '  █  ',
    '  █  ',
  ]),
  A: Object.freeze([
    ' ███ ',
    '█   █',
    '█   █',
    '█████',
    '█   █',
    '█   █',
    '█   █',
  ]),
  C: Object.freeze([
    ' ███ ',
    '█    ',
    '█    ',
    '█    ',
    '█    ',
    '█    ',
    ' ███ ',
  ]),
  K: Object.freeze([
    '█   █',
    '█  █ ',
    '█ █  ',
    '███  ',
    '█ █  ',
    '█  █ ',
    '█   █',
  ]),
});

const WRD = 'WRONGSTACK';
const WRD_ROWS = 7;

/** Gradient: orange → pink across the 10 letters */
const WRD_COLORS = Object.freeze([
  O, // W
  O, // R
  '#F48433', // O
  '#F4644A', // N
  '#F45454', // G
  '#F53E5D', // S
  P, // T
  P, // A
  P, // C
  P, // K
]);

function Wordmark(): React.ReactElement {
  return (
    <Box flexDirection="column">
      {Array.from({ length: WRD_ROWS }, (_, ri) => (
        <Text key={ri} bold>
          {[...WRD].map((ch, ci) => (
            <Text key={ci} color={WRD_COLORS[ci]}>
              {WORDMARK_LETTERS[ch]?.[ri] ?? '     '}
              {ci < WRD.length - 1 ? ' ' : null}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}

// ── Separator line (orange→pink gradient ─) ──────────────────────────
function SeparatorLine({ w }: { w: number }): React.ReactElement {
  const n = Math.max(2, Math.floor(w * 0.35));
  const grad = [O, '#F48433', '#F45454', P];
  const sl = Math.max(1, Math.floor(n / grad.length));
  const tail = n - sl * grad.length;
  return (
    <>
      {grad.map((c, i) => (
        <Text key={c} color={c}>
          {'─'.repeat(sl + (i === 0 ? tail : 0))}
        </Text>
      ))}
    </>
  );
}

// ── Fact row ─────────────────────────────────────────────────────────
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
  accent?: boolean;
}): React.ReactElement {
  const lc = accent ? O : P;
  return (
    <Text>
      <Text color={lc}>{icon}</Text>
      <Text color={lc} bold>{` ${label.padEnd(9)} `}</Text>
      <Text color={accent ? '#fff' : '#cdd6f4'}>
        {trunc(value, valueWidth)}
      </Text>
    </Text>
  );
}

// ── Utilities ────────────────────────────────────────────────────────
function trunc(s: string, w: number): string {
  if (w <= 0 || !s) return '';
  if (s.length <= w) return s;
  return w === 1 ? '…' : s.slice(0, w - 1) + '…';
}

const DEFAULT_TERM_WIDTH = 80;

// ── Banner component ─────────────────────────────────────────────────
export function Banner({
  entry,
  termWidth = DEFAULT_TERM_WIDTH,
}: {
  entry: Extract<HistoryEntry, { kind: 'banner' }>;
  termWidth?: number;
}): React.ReactElement {
  const pw = Math.max(20, Math.floor(termWidth)); // panel width
  const compact = pw < 56;
  const px = compact ? 1 : 2; // horizontal padding
  const cw = Math.max(1, pw - px * 2 - 2); // inner content width
  const fvw = Math.max(1, Math.floor(cw * 0.5) - 14); // 2-col fact value width
  const cwd = shortenPath(entry.cwd, fvw);
  const help = compact
    ? '/help · F1 · F10 · /exit'
    : '/help · F1 projects · F10 sessions · /exit';
  const tagline = trunc(
    compact
      ? ' WRONG STACK. RIGHT RESULTS.'
      : ' BUILT ON THE WRONG STACK. SHIPPED ANYWAY.',
    Math.max(1, cw - 10),
  );
  const ver = trunc(entry.version, Math.max(1, cw - 9));
  const showWordmark = cw >= 56; // need room for the full wordmark

  // Outer content width: all rows use same start column so the W logo
  // and the wordmark are left-aligned.
  return (
    <Box
      width={pw}
      flexDirection="column"
      borderStyle="round"
      borderColor={O}
      paddingX={px}
      paddingY={0}
    >
      {compact ? (
        /* ── Compact layout (narrow terminal) ────────────────────── */
        <>
          <Text>
            <Text backgroundColor={O} color="#121210" bold>
              {' WrongStack '}
            </Text>
            <Text dimColor>{' // TERMINAL AI ENGINE'}</Text>
          </Text>
          <Text>
            <Text color="#a6e3a1">●</Text>
            <Text color="#a6e3a1"> READY </Text>
            <Text dimColor>v</Text>
            <Text bold>{ver}</Text>
          </Text>
          <Text color={O} bold>
            WRONG<Text color={P}>STACK</Text>
          </Text>
          <Box marginTop={1} flexDirection="column">
            <Fact
              icon="◆"
              label="ROUTE"
              value={`${entry.provider} › ${entry.model}`}
              valueWidth={cw - 12}
              accent
            />
            {entry.family ? (
              <Fact
                icon="◇"
                label="FAMILY"
                value={entry.family}
                valueWidth={cw - 12}
              />
            ) : null}
            {entry.keyTail ? (
              <Fact
                icon="◈"
                label="KEY"
                value={`•••• ${entry.keyTail}`}
                valueWidth={cw - 12}
              />
            ) : null}
            <Fact
              icon="⌁"
              label="WORKSPACE"
              value={cwd}
              valueWidth={cw - 12}
            />
            <Fact
              icon="⌘"
              label="COMMANDS"
              value={help}
              valueWidth={cw - 12}
            />
          </Box>
        </>
      ) : (
        /* ── Full layout ─────────────────────────────────────────── */
        <>
          {/* ── Header: logo + info sidebar ── */}
          <Box flexDirection="row" marginTop={1}>
            {/* Logo zone: 14 cols wide */}
            <LogoSymbol />
            {/* Info zone: title, subtitle + version, route */}
            <Box flexDirection="column" marginLeft={2}>
              <Text bold color={O}>
                {trunc('WRONGSTACK', cw - 16)}
              </Text>
              <Text>
                <Text dimColor>
                  {trunc('TERMINAL AI ENGINE', Math.floor(cw * 0.5))}{' '}
                </Text>
                <Text color="#a6e3a1">●</Text>
                <Text color="#a6e3a1"> READY </Text>
                <Text dimColor>v</Text>
                <Text bold>{ver}</Text>
              </Text>
              <Text>
                <Text color={O}>◆</Text>
                <Text color={O} bold>
                  {' '}
                  ROUTE{' '}
                </Text>
                <Text color="#cdd6f4">
                  {trunc(
                    `${entry.provider} › ${entry.model}`,
                    cw - 22,
                  )}
                </Text>
              </Text>
            </Box>
          </Box>

          {/* ── Wordmark (ASCII art "WRONGSTACK") ── */}
          {showWordmark && (
            <Box marginTop={1} alignSelf="flex-start">
              <Wordmark />
            </Box>
          )}

          {/* ── Separator + tagline ── */}
          <Text>
            <SeparatorLine w={cw} />
            <Text dimColor>{tagline}</Text>
          </Text>

          {/* ── Facts in 2 columns ── */}
          <Box flexDirection="row" marginTop={1}>
            <Box flexDirection="column" flexGrow={1}>
              {entry.family ? (
                <Fact
                  icon="◇"
                  label="FAMILY"
                  value={entry.family}
                  valueWidth={fvw}
                />
              ) : null}
              {entry.keyTail ? (
                <Fact
                  icon="◈"
                  label="KEY"
                  value={`•••• ${entry.keyTail}`}
                  valueWidth={fvw}
                />
              ) : null}
            </Box>
            <Box flexDirection="column" flexGrow={1} marginLeft={2}>
              <Fact
                icon="⌁"
                label="WORKSPACE"
                value={cwd}
                valueWidth={fvw}
              />
              <Fact
                icon="⌘"
                label="COMMANDS"
                value={help}
                valueWidth={fvw}
              />
            </Box>
          </Box>
        </>
      )}
    </Box>
  );
}
