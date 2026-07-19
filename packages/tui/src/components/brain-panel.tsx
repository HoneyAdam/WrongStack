import { Box, Text, useStdout } from '../ink.js';
import type React from 'react';
import {
  type BrainPanelRow,
  type BrainPanelSettings,
  brainPanelRows,
} from './brain-panel-model.js';

export type BrainRiskLevel = 'off' | 'low' | 'medium' | 'high' | 'all';

export interface BrainLogEntry {
  kind: string;
  question: string;
  outcome: string;
  age: string;
}

export interface BrainPanelProps {
  riskLevel: BrainRiskLevel;
  log: BrainLogEntry[];
  selected: number;
  hint?: string | undefined;
  /** Settings editor state — absent on hosts without a BrainPanelHost (legacy view). */
  view?: 'settings' | 'log' | undefined;
  settings?: BrainPanelSettings | undefined;
  row?: number | undefined;
  busy?: boolean | undefined;
}

const CHROME_ROWS = 14;

const RISK_DESCS: Record<BrainRiskLevel, string> = {
  off: 'Human decides everything',
  low: 'Auto-decide low risk only',
  medium: 'Auto-decide up to medium risk',
  high: 'Auto-decide up to high risk',
  all: 'Auto-decide everything',
};

const RISK_COLORS: Record<BrainRiskLevel, string> = {
  off: 'gray',
  low: 'green',
  medium: 'yellow',
  high: 'red',
  all: 'magenta',
};

function fmtMs(ms: number | undefined, fallback: string): string {
  if (ms === undefined) return fallback;
  return ms % 60_000 === 0 ? `${ms / 60_000}m` : `${ms / 1000}s`;
}

/** One settings row → label + value strings. */
function rowText(row: BrainPanelRow, s: BrainPanelSettings): { label: string; value: string; dim?: string } {
  switch (row.kind) {
    case 'mode':
      return {
        label: 'Mode',
        value: s.mode.toUpperCase(),
        dim: s.mode === 'headless' ? 'never blocks on you (terminal policy)' : 'escalations prompt you',
      };
    case 'risk':
      return { label: 'Risk ceiling', value: s.riskLevel.toUpperCase(), dim: RISK_DESCS[s.riskLevel] };
    case 'strategy':
      return { label: 'Pool strategy', value: s.strategy, dim: 'fallback = ordered, round-robin = rotate' };
    case 'timeout':
      return { label: 'Decision timeout', value: fmtMs(s.decisionTimeoutMs, 'default (15s)') };
    case 'humanTimeout':
      return {
        label: 'Human timeout',
        value: fmtMs(s.humanTimeoutMs, 'off'),
        dim: s.humanTimeoutMs ? 'then terminal policy' : 'wait indefinitely',
      };
    case 'poolModel': {
      const label = s.pool[row.index] ?? '';
      const resolved = s.poolResolved.some((r) => r === label || r.endsWith(`/${label}`));
      return {
        label: `  ${row.index + 1}.`,
        value: label,
        dim: resolved ? 'd = remove' : 'UNRESOLVED — falls back to session model',
      };
    }
    case 'poolAdd':
      return {
        label: s.pool.length === 0 ? 'Decision model' : '  +',
        value: s.pool.length === 0 ? 'session model' : 'add model…',
        dim: s.pool.length === 0 ? 'Enter = pick a dedicated model' : 'Enter',
      };
    case 'councilToggle':
      return {
        label: 'Council',
        value: s.councilEnabled ? 'ON' : 'off',
        dim: s.councilEnabled
          ? s.voters.length === 0 && s.councilSeats.length > 0
            ? `seats from pool: ${s.councilSeats.join(', ')} · Enter = pick voters`
            : 'multi-LLM vote on high-stakes questions · Enter = add voter'
          : 'Enter = enable + pick voters · ←/→ toggle',
      };
    case 'councilMinRisk':
      return { label: '  risk floor', value: s.councilMinRisk, dim: 'council convenes at/above this risk' };
    case 'voter': {
      const v = s.voters[row.index];
      return {
        label: `  ${row.index + 1}.`,
        value: v?.label ?? '',
        dim: `${v?.persona ?? 'voter'}${v?.veto ? ' · VETO' : ''}${v?.weight ? ` · w=${v.weight}` : ''}  (p persona · v veto · d remove)`,
      };
    }
    case 'voterAdd':
      return { label: '  +', value: 'add voter…', dim: 'Enter' };
    case 'judge':
      return { label: '  judge', value: s.judgeLabel ?? 'auto', dim: 'Enter = pick · d = auto' };
    case 'ledgerToggle':
      return {
        label: 'Ledger',
        value: s.ledgerEnabled ? 'ON' : 'off',
        dim: 'records decisions + outcomes, feeds them back into prompts',
      };
    case 'autoDeny':
      return {
        label: '  auto-deny',
        value: s.autoDenyAfterFailures === undefined ? 'default (3)' : s.autoDenyAfterFailures === 0 ? 'off' : String(s.autoDenyAfterFailures),
        dim: 'deny after N observed consecutive failures',
      };
    default:
      return { label: '', value: '' };
  }
}

export function BrainPanel({
  riskLevel,
  log,
  selected,
  hint,
  view,
  settings,
  row,
  busy,
}: BrainPanelProps): React.ReactElement {
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;

  const editable = settings !== undefined;
  const activeView = editable ? (view ?? 'settings') : 'log';

  // Window the log entries: reserve ~7 rows for the risk header + chrome.
  const maxVisible = Math.max(4, termRows - CHROME_ROWS);
  const total = log.length;
  const windowStart =
    total <= maxVisible
      ? 0
      : Math.max(0, Math.min(selected - Math.floor(maxVisible / 2), total - maxVisible));
  const windowEnd = Math.min(windowStart + maxVisible, total);
  const above = windowStart;
  const below = total - windowEnd;

  const headerHint =
    activeView === 'settings'
      ? '↑/↓ row · ←/→ change · Enter pick/toggle · d remove · Tab log · Esc close'
      : editable
        ? '↑/↓ navigate log · Tab settings · Esc close'
        : '↑/↓ navigate log · ←/→ change risk · Esc close';

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
      <Text bold color="magenta">
        {`━━ Brain ━━${busy ? '  …' : ''}`}
      </Text>
      <Text dimColor>{headerHint}</Text>

      {activeView === 'settings' && settings ? (
        <Box marginTop={1} flexDirection="column">
          {brainPanelRows(settings).map((r, i) => {
            const focused = i === (row ?? 0);
            const { label, value, dim } = rowText(r, settings);
            return (
              <Text key={`${r.kind}-${'index' in r ? r.index : 0}`} wrap="truncate-end">
                {focused ? <Text color="magenta">{'› '}</Text> : '  '}
                <Text bold={focused}>{label.padEnd(18)}</Text>
                <Text
                  color={r.kind === 'risk' ? RISK_COLORS[settings.riskLevel] : focused ? 'cyan' : undefined}
                  bold={r.kind === 'risk' || r.kind === 'mode'}
                  inverse={focused}
                >
                  {value}
                </Text>
                {dim ? <Text dimColor>{`  ${dim}`}</Text> : null}
              </Text>
            );
          })}
          <Box marginTop={1}>
            <Text dimColor>changes apply live and persist to the active profile config</Text>
          </Box>
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          {/* ── Risk ceiling section (legacy/log view) ── */}
          <Box>
            <Text bold>Risk ceiling: </Text>
            <Text color={RISK_COLORS[riskLevel]} bold>
              {riskLevel.toUpperCase()}
            </Text>
            <Text dimColor>{`  ${RISK_DESCS[riskLevel]}`}</Text>
          </Box>

          {/* ── Recent decisions section ── */}
          <Box marginTop={1} flexDirection="column">
            <Text bold color="blue">
              Recent decisions
            </Text>
            {total === 0 ? (
              <Text dimColor>  No decisions recorded yet this session.</Text>
            ) : (
              <>
                {above > 0 ? <Text dimColor>{`  ↑ ${above} more`}</Text> : null}
                {log.slice(windowStart, windowEnd).map((entry, i) => {
                  const index = windowStart + i;
                  const focused = index === selected;
                  return (
                    <Text
                      key={`${entry.kind}-${i}`}
                      inverse={focused}
                      {...(focused ? { color: 'magenta' } : {})}
                      wrap="truncate-end"
                    >
                      {focused ? '› ' : '  '}
                      <Text dimColor>{entry.age.padEnd(8)}</Text>
                      <Text color="cyan">{entry.kind.padEnd(12)}</Text>
                      <Text>{entry.question.length > 60 ? `${entry.question.slice(0, 57)}…` : entry.question}</Text>
                      {entry.outcome ? <Text dimColor>{` → ${entry.outcome.length > 20 ? `${entry.outcome.slice(0, 17)}…` : entry.outcome}`}</Text> : null}
                    </Text>
                  );
                })}
                {below > 0 ? <Text dimColor>{`  ↓ ${below} more`}</Text> : null}
              </>
            )}
          </Box>
        </Box>
      )}

      {hint ? (
        <Box marginTop={1}>
          <Text dimColor>{hint}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
