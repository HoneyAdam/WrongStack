import type React from 'react';
import { contextBar } from '../context-slash.js';
import { Box, Text, useInput } from '../ink.js';
import type { MemoryContextMonitorState } from '../memory-context-monitor.js';
import { theme } from '../theme.js';
import { glyphs } from '../ui-glyphs.js';
import {
  EmptyPanelState,
  KeyCap,
  MonitorShell,
  SectionLabel,
  useMonitorSize,
} from './monitor-shell.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ContextPanelData {
  ctxPct: number | undefined;
  ctxTokens: number | undefined;
  ctxMaxTokens: number | undefined;
  provider: string;
  model: string;
  mode: string;
  uptime: string;
  fleetEntries: Array<{
    name: string;
    status: string;
    currentTool: string | undefined;
    ctxPct: number | undefined;
  }>;
  leaderIterations: number;
  leaderToolCalls: number;
  leaderStatus: string;
  memoryContext: MemoryContextMonitorState;
}

export interface ContextPanelProps {
  data: ContextPanelData;
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type ZoneLevel = 'safe' | 'warning' | 'critical' | 'danger';

function zoneFor(pct: number): ZoneLevel {
  if (pct > 0.95) return 'danger';
  if (pct > 0.85) return 'critical';
  if (pct > 0.6) return 'warning';
  return 'safe';
}

function zoneColor(zone: ZoneLevel): string {
  switch (zone) {
    case 'safe':
      return theme.success;
    case 'warning':
      return theme.warn;
    case 'critical':
      return theme.error;
    case 'danger':
      return '#f2cdcd'; // flamingo
  }
}

function zoneEmoji(pct: number): string {
  const z = zoneFor(pct);
  switch (z) {
    case 'safe':
      return '🟢';
    case 'warning':
      return '🟡';
    case 'critical':
      return '🔴';
    case 'danger':
      return '⚫';
  }
}

function zoneLabel(pct: number): string {
  const z = zoneFor(pct);
  switch (z) {
    case 'safe':
      return 'HEALTHY';
    case 'warning':
      return 'WARNING';
    case 'critical':
      return 'CRITICAL';
    case 'danger':
      return 'DANGER';
  }
}

const SOURCE_BREAKDOWN: Array<{ icon: string; label: string; pct: number }> = [
  { icon: '💬', label: 'History', pct: 0.42 },
  { icon: '⚙️', label: 'System', pct: 0.2 },
  { icon: '🔧', label: 'Tools', pct: 0.14 },
  { icon: '🔌', label: 'MCP', pct: 0.09 },
  { icon: '📎', label: 'Files', pct: 0.06 },
  { icon: '🎯', label: 'Custom', pct: 0.04 },
];

const ZONES: Array<{ label: string; emoji: string; from: number; to: number; desc: string }> = [
  { label: 'Safe', emoji: '🟢', from: 0, to: 60, desc: 'normal operation' },
  { label: 'Warning', emoji: '🟡', from: 60, to: 85, desc: 'compaction advised' },
  { label: 'Critical', emoji: '🔴', from: 85, to: 95, desc: 'compact now' },
  { label: 'Danger', emoji: '⚫', from: 95, to: 100, desc: 'context nearly full' },
];

/** Render a thin horizontal colored bar using block chars. */
function thinBar(fillPct: number, totalLen: number): string {
  if (totalLen <= 0) return '';
  const f = Math.round(Math.min(1, Math.max(0, fillPct)) * totalLen);
  return '█'.repeat(Math.max(1, f)) + '░'.repeat(Math.max(0, totalLen - f));
}

/** Render the threshold axis line with markers. */
function renderAxis(pct: number, barWidth: number): { axis: string; label: string } {
  const softPos = Math.round(0.6 * barWidth);
  const nowPos = Math.round(pct * barWidth);
  const hardPos = Math.round(0.85 * barWidth);
  const dangerPos = Math.round(0.95 * barWidth);

  const axisChars: string[] = [];
  for (let i = 0; i <= barWidth; i++) {
    if (i === 0) axisChars.push('├');
    else if (i === softPos || i === hardPos || i === dangerPos) axisChars.push('┼');
    else if (i === barWidth) axisChars.push('┤');
    else axisChars.push('─');
  }

  const markers: Array<{ pos: number; text: string }> = [
    { pos: 0, text: '0%' },
    { pos: softPos, text: 'soft' },
    { pos: nowPos, text: '◀now' },
    { pos: hardPos, text: 'hard' },
    { pos: dangerPos, text: 'max' },
    { pos: barWidth, text: '100%' },
  ];
  let label = '';
  let lastEnd = 0;
  for (const m of markers) {
    const pad = Math.max(1, m.pos - lastEnd);
    label += ' '.repeat(pad) + m.text;
    lastEnd = m.pos + m.text.length;
  }

  return { axis: axisChars.join(''), label };
}

// ── Section renderers ─────────────────────────────────────────────────────────

function PressureSection({
  data,
  contentWidth,
}: {
  data: ContextPanelData;
  contentWidth: number;
}): React.ReactElement {
  const pct = data.ctxPct ?? 0;
  const barWidth = Math.min(40, Math.max(10, contentWidth - 14));
  const { axis, label } = renderAxis(pct, barWidth);
  const emoji = zoneEmoji(pct);

  return (
    <Box flexDirection="column" marginTop={1}>
      <SectionLabel>PRESSURE</SectionLabel>
      <Box marginTop={1}>
        <Text color={zoneColor(zoneFor(pct))}>{emoji}</Text>
        <Text> </Text>
        <Text>{contextBar(pct, barWidth)}</Text>
      </Box>
      <Text color={theme.textMuted}> {axis}</Text>
      <Text color={theme.textMuted}> {label}</Text>
    </Box>
  );
}

function CompositionSection({
  data,
  contentWidth,
}: {
  data: ContextPanelData;
  contentWidth: number;
}): React.ReactElement | null {
  if (data.ctxTokens == null) return null;
  const barLen = Math.min(20, Math.max(6, contentWidth - 30));

  return (
    <Box flexDirection="column" marginTop={1}>
      <SectionLabel>CONTEXT COMPOSITION</SectionLabel>
      <Text color={theme.textMuted}>
        Estimated breakdown of {data.ctxTokens.toLocaleString('en-US')} tokens
      </Text>
      {SOURCE_BREAKDOWN.map((src) => {
        const srcTokens = Math.round(data.ctxTokens! * src.pct).toLocaleString('en-US');
        return (
          <Box key={src.label}>
            <Text>
              <Text>{src.icon} </Text>
              <Text color={theme.textSecondary}>{src.label.padEnd(12)}</Text>
              <Text color={theme.textMuted}>{thinBar(src.pct, barLen)}</Text>
              <Text> </Text>
              <Text color={theme.textMuted}>{(src.pct * 100).toFixed(1)}%</Text>
              <Text> </Text>
              <Text color={theme.textSecondary}>{srcTokens}</Text>
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

function ThresholdSection({ data }: { data: ContextPanelData }): React.ReactElement {
  const curVal = (data.ctxPct ?? 0) * 100;

  // Zone strip across the top
  const stripLen = 30;
  let zoneStrip = '';
  for (const z of ZONES) {
    const zLen = Math.round(((z.to - z.from) / 100) * stripLen);
    zoneStrip += `${z.emoji}${'█'.repeat(Math.max(1, zLen))}`;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <SectionLabel>THRESHOLD MAP</SectionLabel>
      <Text color={theme.textMuted}> {zoneStrip}</Text>
      {ZONES.map((z) => {
        const marker = curVal >= z.from && curVal < z.to ? '  ◀' : '';
        return (
          <Box key={z.label}>
            <Text>
              <Text color={theme.textSecondary}>
                {z.emoji} {z.label.padEnd(10)}
              </Text>
              <Text color={theme.textMuted}>
                {' '}
                {z.from}%–{z.to}%{' '.repeat(4)}
                {z.desc.padEnd(24)}
              </Text>
              <Text color={zoneColor(zoneFor(data.ctxPct ?? 0))}>{marker}</Text>
            </Text>
          </Box>
        );
      })}
      <Text color={theme.textMuted}>
        {' '}
        ▲ {curVal.toFixed(1)}% →{' '}
        <Text color={zoneColor(zoneFor(data.ctxPct ?? 0))}>
          {zoneEmoji(data.ctxPct ?? 0)} {zoneLabel(data.ctxPct ?? 0)}
        </Text>
        {'    '}trigger: 85% limit: 100%
      </Text>
    </Box>
  );
}

function CompactionSection({ data }: { data: ContextPanelData }): React.ReactElement {
  const max = data.ctxMaxTokens ?? 200_000;
  const pct = data.ctxPct ?? 0;
  const recoveryEst = Math.round(max * 0.18).toLocaleString('en-US');
  const needsCompact = pct > 0.65;

  return (
    <Box flexDirection="column" marginTop={1}>
      <SectionLabel>COMPACTION ENGINE</SectionLabel>
      <Box>
        <Text color={theme.textMuted}>Strategy </Text>
        <Text color={theme.textPrimary}>
          hybrid <Text color={theme.success}>(auto ✅)</Text>
        </Text>
      </Box>
      <Box>
        <Text color={theme.textMuted}>Next trigger</Text>
        <Text color={theme.textSecondary}> {(max * 0.85).toLocaleString('en-US')} (85%)</Text>
      </Box>
      <Box>
        <Text color={theme.textMuted}>Recovery </Text>
        <Text color={theme.textSecondary}> ~{recoveryEst} (~18% of window)</Text>
      </Box>
      <Box>
        <Text color={theme.textMuted}>Recommend </Text>
        <Text color={needsCompact ? theme.warn : theme.success}>
          {needsCompact ? '⚠️ Compact now — reclaim ~18%' : '✅ No compaction needed'}
        </Text>
      </Box>
    </Box>
  );
}

function AgentFootprintSection({
  data,
  contentWidth,
}: {
  data: ContextPanelData;
  contentWidth: number;
}): React.ReactElement | null {
  const leaderPct = data.ctxPct;
  const fleet = data.fleetEntries.filter((e) => e.ctxPct != null);
  if (leaderPct == null && fleet.length === 0) return null;

  const allAgents: Array<{ name: string; ctxPct: number }> = [];
  if (leaderPct != null) allAgents.push({ name: 'LEADER', ctxPct: leaderPct });
  for (const e of fleet) {
    if (e.ctxPct != null) allAgents.push({ name: e.name, ctxPct: e.ctxPct });
  }

  const agentBarLen = Math.min(30, contentWidth - 22);

  return (
    <Box flexDirection="column" marginTop={1}>
      <SectionLabel>PER-AGENT FOOTPRINT</SectionLabel>
      {allAgents.map((a) => {
        const apct = Math.min(1, Math.max(0, a.ctxPct));
        const aEmoji = zoneEmoji(apct);
        const aColor = zoneColor(zoneFor(apct));
        const aPct = `${(apct * 100).toFixed(0)}%`.padStart(4);
        const tag = a.name === 'LEADER' ? '👑' : '  ';
        const aBar = thinBar(apct, agentBarLen);
        return (
          <Box key={a.name}>
            <Text>
              <Text>{tag} </Text>
              <Text color={theme.textSecondary}>{a.name.padEnd(14)}</Text>
              <Text color={aColor}>
                {aEmoji} {aBar} {aPct}
              </Text>
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

function MetricsSection({ data }: { data: ContextPanelData }): React.ReactElement | null {
  if (data.ctxTokens == null) return null;
  const used = data.ctxTokens;
  const max = data.ctxMaxTokens ?? 200_000;
  const pct = data.ctxPct ?? (max > 0 ? used / max : 0);
  const free = max - used;
  const freePct = max > 0 ? ((free / max) * 100).toFixed(1) : '0.0';
  const utilBar = thinBar(pct, 20);

  return (
    <Box flexDirection="column" marginTop={1}>
      <SectionLabel>TOKEN METRICS</SectionLabel>
      <Box>
        <Text color={theme.textMuted}>Used </Text>
        <Text color={theme.textPrimary}>{used.toLocaleString('en-US')}</Text>
      </Box>
      <Box>
        <Text color={theme.textMuted}>Free </Text>
        <Text color={theme.textSecondary}>
          {free.toLocaleString('en-US')} ({freePct}%)
        </Text>
      </Box>
      <Box>
        <Text color={theme.textMuted}>Capacity </Text>
        <Text color={theme.textPrimary}>{max.toLocaleString('en-US')}</Text>
      </Box>
      <Box>
        <Text color={theme.textMuted}>Utilization</Text>
        <Text> </Text>
        <Text color={zoneColor(zoneFor(pct))}>{utilBar}</Text>
        <Text> </Text>
        <Text color={theme.textSecondary}>{(pct * 100).toFixed(1)}%</Text>
      </Box>
      <Box>
        <Text color={theme.textMuted}>Model </Text>
        <Text color={theme.textPrimary}>{data.model}</Text>
        <Text color={theme.textMuted}> · </Text>
        <Text color={theme.textPrimary}>{data.provider}</Text>
      </Box>
      <Box>
        <Text color={theme.textMuted}>Mode </Text>
        <Text color={theme.textSecondary}>{data.mode}</Text>
      </Box>
      <Box>
        <Text color={theme.textMuted}>Uptime </Text>
        <Text color={theme.textSecondary}>{data.uptime}</Text>
      </Box>
    </Box>
  );
}

function StatusSection({ data }: { data: ContextPanelData }): React.ReactElement {
  const pct = data.ctxPct ?? 0;
  const z = zoneFor(pct);
  const emoji = zoneEmoji(pct);

  let verdict: string;
  if (pct > 0.85) {
    verdict = `${emoji} CRITICAL — Context at ${(pct * 100).toFixed(1)}%. Consider compacting or a fresh session.`;
  } else if (pct > 0.65) {
    verdict = `${emoji} WARNING  — Context at ${(pct * 100).toFixed(1)}%. Plan compaction soon.`;
  } else if (pct > 0.45) {
    verdict = `${emoji} MODERATE — Context at ${(pct * 100).toFixed(1)}%. Healthy, monitor as it grows.`;
  } else {
    verdict = `${emoji} HEALTHY  — Context at ${(pct * 100).toFixed(1)}%. Plenty of room for more conversation.`;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <SectionLabel>STATUS</SectionLabel>
      <Text color={zoneColor(z)}>{verdict}</Text>
      <Text color={theme.textMuted}>
        <Text> </Text>
        Run{' '}
        <Text color={theme.assistant} bold>
          /context
        </Text>{' '}
        for the full dashboard with git, fleet, memory & env.
      </Text>
    </Box>
  );
}

function MemoryContextSection({ data }: { data: ContextPanelData }): React.ReactElement | null {
  const ctx = data.memoryContext;
  if (!ctx || (Object.keys(ctx.memories).length === 0 && ctx.transitions.length === 0)) {
    return null;
  }
  const records = Object.values(ctx.memories)
    .slice()
    .sort((a, b) => {
      if (b.lastSeenAt !== a.lastSeenAt) return b.lastSeenAt < a.lastSeenAt ? -1 : 1;
      return a.id.localeCompare(b.id);
    });
  let active = 0;
  let pending = 0;
  let exited = 0;
  for (const m of records) {
    if (m.state === 'active') active++;
    else if (m.state === 'injected') pending++;
    else exited++;
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      <SectionLabel>SUPER MEMORY IN CONTEXT</SectionLabel>
      <Text>
        <Text color={theme.success}>{`${active} ctx`}</Text>
        <Text color={theme.warn}>{` · ${pending} pending`}</Text>
        <Text color={theme.textMuted}>{` · ${exited} left · exact provider request snapshot`}</Text>
      </Text>
      {records.length === 0 ? (
        <Text color={theme.textMuted}>No memory has entered this session context.</Text>
      ) : (
        records.slice(0, 10).map((memory) => {
          const stateLabel =
            memory.state === 'active'
              ? 'CONTEXT'
              : memory.state === 'injected'
                ? 'PENDING'
                : 'LEFT';
          const arrow = memory.state === 'exited' ? '↳' : '↲';
          const stateColor =
            memory.state === 'active'
              ? theme.success
              : memory.state === 'injected'
                ? theme.warn
                : theme.textMuted;
          return (
            <Box key={memory.id} flexDirection="column" marginTop={1}>
              <Text>
                <Text color={stateColor}>{`${arrow} ${stateLabel.padEnd(7)}`}</Text>
                <Text color={theme.assistant}>{memory.id}</Text>
                <Text color={theme.textMuted}>{` [${memory.kind}] ${memory.persistence}`}</Text>
              </Text>
              <Text color={theme.textSecondary}>{memory.text}</Text>
              {memory.isPlaceholder !== true && memory.activationReasons.length > 0 && (
                <Text color={theme.textMuted}>
                  {`score ${memory.score.toFixed(2)} · confidence ${memory.confidence.toFixed(2)} · freshness ${memory.freshness.toFixed(2)} · importance ${memory.importance.toFixed(2)}`}
                </Text>
              )}
              <Text color={theme.textMuted}>
                {`why: ${memory.activationReasons.join(' · ') || 'context snapshot'}`}
              </Text>
            </Box>
          );
        })
      )}
      {data.memoryContext.transitions.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.textSecondary}>CAME / WENT</Text>
          {data.memoryContext.transitions.slice(0, 8).map((transition) => (
            <Text
              key={transition.id}
              color={transition.action === 'exited' ? theme.textMuted : theme.success}
            >
              {`${transition.action === 'exited' ? '↳' : '↲'} ${transition.action.padEnd(8)} ${transition.memoryId} · ${transition.reason}`}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ContextPanel({ data, onClose }: ContextPanelProps): React.ReactElement {
  const size = useMonitorSize();
  const contentWidth = size.contentWidth;

  useInput((_input, key) => {
    if (key.escape) {
      onClose();
    }
  });

  if (
    data.ctxPct == null &&
    data.ctxTokens == null &&
    Object.keys(data.memoryContext.memories).length === 0 &&
    data.memoryContext.transitions.length === 0 &&
    data.memoryContext.latest === undefined
  ) {
    return (
      <MonitorShell
        accent={theme.monitor.fleet}
        icon={glyphs.context}
        title="CONTEXT"
        kicker={size.columns >= 80 ? 'context window' : undefined}
        right={
          <Text color={theme.textMuted}>
            {glyphs.clock} {data.uptime}
          </Text>
        }
        footer={<KeyCap keyName="Esc" label="close" color={theme.monitor.fleet} />}
      >
        <EmptyPanelState
          icon={glyphs.context}
          title="No context data yet"
          detail="Context metrics appear once the agent starts processing a request."
          accent={theme.textMuted}
        />
      </MonitorShell>
    );
  }

  const pct = data.ctxPct ?? 0;
  const z = zoneFor(pct);
  const emoji = zoneEmoji(pct);
  const zoneClr = zoneColor(z);

  return (
    <MonitorShell
      accent={zoneClr}
      icon={glyphs.context}
      title="CONTEXT WINDOW"
      kicker={size.columns >= 80 ? `${data.model} · ${data.provider}` : undefined}
      right={
        <Text>
          <Text color={zoneClr}>{emoji}</Text>
          <Text color={theme.textMuted}> {zoneLabel(pct)}</Text>
          <Text> </Text>
          <Text color={theme.textMuted}>
            {glyphs.clock} {data.uptime}
          </Text>
        </Text>
      }
      footer={
        <Box gap={2}>
          <KeyCap keyName="Esc" label="close" color={zoneClr} />
          <Text color={theme.textMuted}>
            ctx = latest provider request · pending = next request
          </Text>
        </Box>
      }
    >
      <Box flexDirection="column" paddingX={1}>
        {/* Identity line */}
        <Box>
          <Text color={theme.textSecondary}>{emoji} </Text>
          <Text color={theme.textPrimary}>{data.model}</Text>
          <Text color={theme.textMuted}> · </Text>
          <Text color={theme.textPrimary}>{data.provider}</Text>
          <Text color={theme.textMuted}> · </Text>
          <Text color={theme.textSecondary}>{data.mode}</Text>
          <Box flexGrow={1} />
          <Text color={theme.textMuted}>
            L{data.leaderIterations} · T{data.leaderToolCalls}
            {data.leaderStatus !== 'idle' ? ` · ${data.leaderStatus}` : ''}
          </Text>
        </Box>

        {/* Sections */}
        <PressureSection data={data} contentWidth={contentWidth} />
        <CompositionSection data={data} contentWidth={contentWidth} />
        <ThresholdSection data={data} />
        <CompactionSection data={data} />
        <AgentFootprintSection data={data} contentWidth={contentWidth} />
        <MemoryContextSection data={data} />
        <MetricsSection data={data} />
        <StatusSection data={data} />

        {/* Bottom spacer */}
        <Box height={1} />
      </Box>
    </MonitorShell>
  );
}
