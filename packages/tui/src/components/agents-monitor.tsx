import { Box, Text, useInput, useStdout } from '../ink.js';
import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import type { AgentTimelineEntry } from '@wrongstack/core/coordination';
import type { FleetEntry } from '../app.js';
import type { HistoryEntry } from './history/types.js';
import { bucketActivity, fmtModelLabel, sparkline } from './fleet-monitor.js';
import { fmtElapsed } from './status-bar.js';
import { getToolVisual } from '../tool-glyph.js';

/**
 * Narrow read-only view of per-subagent transcripts. AgentMonitorService
 * (created in the CLI host) satisfies this structurally; the TUI never
 * imports from @wrongstack/cli. `getTranscript` returns entries NEWEST
 * FIRST (mirroring AgentMonitorService.getTranscript).
 */
export interface AgentTranscriptReader {
  getTranscript(subagentId: string, limit?: number): AgentTimelineEntry[];
}

export interface AgentsMonitorProps {
  entries: Record<string, FleetEntry>;
  /** Fleet (subagents) accumulated cost — excludes the leader/main session. */
  totalCost: number;
  /**
   * Leader (main session) cost — the same figure the statusline shows. Added
   * to `totalCost` for a trustworthy grand total. Optional for callers that
   * don't track it (defaults to 0).
   */
  leaderCost?: number | undefined;
  /** Fleet-wide token totals, when available. */
  totalTokens?: { input: number; output: number };
  /** 1s clock tick so elapsed times + sparklines stay live. */
  nowTick: number;
  /** Called when there are no active/detail-worthy agents left to show. */
  onClose?: (() => void) | undefined;
  /**
   * Optional transcript reader — when provided, the selected agent's
   * detail card renders a scrollable full-transcript pane (PgUp/PgDn)
   * with a CONSTANT-height layout, so switching agents never changes the
   * panel height (no scrollback churn). Falls back to the streaming-tail
   * snippet when absent.
   */
  transcripts?: AgentTranscriptReader | undefined;
  /**
   * Optional leader history source (oldest first) — the main chat's own
   * entries mapped to timeline shape, WITHOUT subagent lines, so selecting
   * LEADER shows a clean per-agent view just like the subagents.
   */
  leaderTranscript?: (() => AgentTimelineEntry[]) | undefined;
  /**
   * Fullscreen mode: the App hides the chat history while this monitor is
   * open, so the transcript pane may claim every row the chrome doesn't
   * need (the usual 24-row cap is lifted).
   */
  fullscreen?: boolean | undefined;
}

const STATUS: Record<FleetEntry['status'], { icon: string; color: string }> = {
  idle: { icon: '○', color: 'gray' },
  running: { icon: '▶', color: 'yellow' },
  success: { icon: '✓', color: 'green' },
  failed: { icon: '✗', color: 'red' },
  timeout: { icon: '⏱', color: 'yellow' },
  stopped: { icon: '⊘', color: 'gray' },
};

/** Retained for callers/tests that tune the empty-state grace window. */
export const IDLE_HIDE_MS = 60_000;
export const EMPTY_AGENTS_CLOSE_DELAY_MS = 7_500;

function isLeaderEntry(entry: FleetEntry): boolean {
  return entry.id === 'leader' || entry.name === 'LEADER';
}

/**
 * Select the agents the live monitor should render. Only actively-running
 * subagents are detail-worthy; idle workers are retained by the coordinator for
 * reuse but should not keep the TUI crowded after their task closes. LEADER
 * stays visible while a subagent is running (or while LEADER itself is running)
 * so F3 always has a detail card fallback.
 */
export function selectLiveAgents(
  all: FleetEntry[],
  _now: number,
  _idleHideMs: number = IDLE_HIDE_MS,
): FleetEntry[] {
  const leader = all.find(isLeaderEntry);
  const activeSubagents = all.filter((entry) => !isLeaderEntry(entry) && entry.status === 'running');
  const showLeader = leader !== undefined && (leader.status !== 'idle' || activeSubagents.length > 0);
  return all.filter((entry) => (isLeaderEntry(entry) ? showLeader : activeSubagents.some((active) => active.id === entry.id)));
}

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function fmtExactTokens(n: number): string {
  return `${Math.round(n).toLocaleString('en-US')} tok`;
}

function snippet(s: string, max = 72): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

function fmtShortDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m${s.toString().padStart(2, '0')}s`;
}

function fmtSignedTokens(n: number): string {
  return n <= 0 ? '0' : fmtTokens(n);
}

function fmtOptionalTimestamp(ms?: number): string {
  if (!ms || ms <= 0) return 'unknown';
  return new Date(ms).toLocaleTimeString('en-US', { hour12: false });
}

export function formatContextRunway(tokens?: number, maxTokens?: number): string {
  if (!tokens || !maxTokens || maxTokens <= 0) return 'ctx unknown';
  const left = Math.max(0, maxTokens - tokens);
  return `${fmtTokens(tokens)}/${fmtTokens(maxTokens)} · ${fmtSignedTokens(left)} free`;
}

export function formatRecentToolChip(tool: FleetEntry['recentTools'][number]): string {
  const status = tool.ok === false ? '✗' : '✓';
  const duration = typeof tool.durationMs === 'number' ? ` ${fmtShortDuration(tool.durationMs)}` : '';
  const lines = typeof tool.outputLines === 'number' && tool.outputLines > 0 ? ` ${tool.outputLines}L` : '';
  const bytes = typeof tool.outputBytes === 'number' && tool.outputBytes > 0 ? ` ${fmtTokens(tool.outputBytes)}B` : '';
  return `${status} ${tool.name}${duration}${lines}${bytes}`;
}

export function formatAgentDetailHeader(entry: FleetEntry): string {
  return entry.name || entry.id;
}

export function agentRisk(entry: FleetEntry): 'calm' | 'busy' | 'hot' | 'critical' {
  const pct = entry.ctxPct ?? 0;
  if (entry.budgetWarning || entry.failureReason || pct >= 0.9) return 'critical';
  if (pct >= 0.75 || (entry.extensions ?? 0) > 0) return 'hot';
  if (entry.status === 'running' || pct >= 0.55) return 'busy';
  return 'calm';
}

function riskMeta(risk: ReturnType<typeof agentRisk>): { icon: string; color: string; label: string } {
  switch (risk) {
    case 'critical':
      return { icon: '◆', color: 'red', label: 'critical' };
    case 'hot':
      return { icon: '▲', color: 'yellow', label: 'hot' };
    case 'busy':
      return { icon: '●', color: 'cyan', label: 'busy' };
    case 'calm':
      return { icon: '○', color: 'green', label: 'calm' };
  }
}

function currentAction(entry: FleetEntry, now: number): string {
  if (entry.currentTool) return `→ ${entry.currentTool.name} ${fmtShortDuration(now - entry.currentTool.startedAt)}`;
  if (entry.status === 'running') return 'thinking';
  const last = entry.recentTools[entry.recentTools.length - 1];
  if (last) return `last ${last.name}`;
  const msg = entry.recentMessages[entry.recentMessages.length - 1];
  if (msg) return `msg ${snippet(msg.text, 34)}`;
  return 'standing by';
}

export function selectAgentDetail(live: FleetEntry[], selectedId?: string): FleetEntry | undefined {
  return live.find((entry) => entry.id === selectedId) ?? live.find(isLeaderEntry) ?? live[0];
}

export function nextEmptyAgentsCloseStartedAt(
  liveCount: number,
  now: number,
  currentStartedAt?: number,
): number | undefined {
  if (liveCount > 0) return undefined;
  return currentStartedAt ?? now;
}

export function shouldCloseEmptyAgentsMonitor(
  liveCount: number,
  now: number,
  emptyStartedAt: number | undefined,
  delayMs = EMPTY_AGENTS_CLOSE_DELAY_MS,
): boolean {
  return liveCount === 0 && emptyStartedAt !== undefined && now - emptyStartedAt >= delayMs;
}

function selectHotAgent(entries: FleetEntry[]): FleetEntry | undefined {
  const riskScore = { critical: 3, hot: 2, busy: 1, calm: 0 } as const;
  return [...entries]
    .sort((a, b) => {
      const ar = riskScore[agentRisk(a)];
      const br = riskScore[agentRisk(b)];
      if (br !== ar) return br - ar;
      const bp = b.ctxPct ?? 0;
      const ap = a.ctxPct ?? 0;
      if (bp !== ap) return bp - ap;
      if (b.toolCalls !== a.toolCalls) return b.toolCalls - a.toolCalls;
      return b.lastEventAt - a.lastEventAt;
    })
    .at(0);
}

/** Colored context-window fill bar: ████░░░░░░ 67% */
function ContextBar({
  pct,
  tokens,
  maxTokens,
}: {
  pct: number;
  tokens?: number | undefined;
  maxTokens?: number | undefined;
}): React.ReactElement {
  const clamped = Math.max(0, Math.min(1, pct)); // cap visual at 100%
  const totalBars = 10;
  const filled = Math.round(clamped * totalBars);
  const empty = totalBars - filled;
  const color = clamped < 0.6 ? 'green' : clamped < 0.75 ? 'yellow' : 'red';
  // Display pct capped at 100% since compact mode manages over-budget scenarios.
  const pctText = `${Math.min(Math.round(pct * 100), 100)}%`;
  const tokenText = tokens ? ` ${fmtTokens(tokens)}/${fmtTokens(maxTokens ?? 200_000)}` : '';
  return (
    <Text color={color}>
      {'█'.repeat(filled)}
      {'░'.repeat(Math.max(0, empty))} {pctText}
      {tokenText}
    </Text>
  );
}

function pctTextFromRatio(pct: number | undefined): string {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return '0%';
  return `${Math.min(100, Math.max(0, Math.round(pct * 100)))}%`;
}

/**
 * Compact single-line agent row. All the essential info in one line:
 * status icon, name, model, iterations/tools, context bar, cost.
 */
function AgentRow({
  entry,
  now,
  selected,
}: {
  entry: FleetEntry;
  now: number;
  selected: boolean;
}): React.ReactElement {
  const s = STATUS[entry.status];
  const elapsed =
    entry.status === 'running' ? fmtElapsed(Math.max(0, now - entry.startedAt)) : entry.status;
  const modelLabel = fmtModelLabel(entry.provider, entry.model);
  const activity = sparkline(bucketActivity(entry.recentTools, now, 10, 3000));
  const risk = riskMeta(agentRisk(entry));
  const ctxCostStr = entry.ctxCost !== undefined && entry.ctxCost > 0
    ? ` ctx ${entry.ctxCost.toFixed(4)}`
    : '';

  return (
    <Box flexDirection="row" gap={1}>
      {/* Selection indicator */}
      <Text color={selected ? 'magenta' : 'gray'}>{selected ? '▶' : ' '}</Text>
      {/* Status icon */}
      <Text color={s.color} bold>
        {s.icon}
      </Text>
      <Text color={risk.color}>{risk.icon}</Text>
      {/* Name */}
      <Text bold={selected} {...(selected ? { color: 'magenta' } : {})}>
        {entry.name}
      </Text>
      {/* Provider / Model — fmtModelLabel handles all cases (including undefined model) */}
      {modelLabel ? <Text dimColor>{modelLabel}</Text> : null}
      {/* Iterations / tool calls */}
      <Text dimColor>
        L{entry.iterations} {entry.toolCalls}t
      </Text>
      {activity ? <Text color="green">{activity}</Text> : null}
      {/* Context bar */}
      {entry.ctxPct !== undefined ? (
        <ContextBar pct={entry.ctxPct} tokens={entry.ctxTokens} maxTokens={entry.ctxMaxTokens} />
      ) : null}
      {/* Context cost */}
      {ctxCostStr ? <Text color="yellow">{ctxCostStr}</Text> : null}
      {/* Current activity (inline) */}
      <Text color={entry.currentTool ? 'cyan' : 'gray'}>{currentAction(entry, now)}</Text>
      {/* Elapsed */}
      <Text dimColor>{elapsed}</Text>
      {/* Extensions badge */}
      {entry.extensions && entry.extensions > 0 ? (
        <Text color="yellow">⚡×{entry.extensions}</Text>
      ) : null}
      {/* Cost */}
      {entry.cost > 0 ? <Text color="green">${entry.cost.toFixed(4)}</Text> : null}
    </Box>
  );
}

// ── Transcript pane (F3 detail) ──────────────────────────────────────

/** Fallback rows of transcript content when terminal height is unknown. */
export const TRANSCRIPT_ROWS = 10;

/** Full in-memory transcript depth to fetch (AgentMonitorService ring size). */
export const TRANSCRIPT_FETCH_LIMIT = 500;

/**
 * Rows of transcript content for the current terminal. Constant for a
 * given terminal size and agent count, so agent switches never change
 * the panel height — only explicit resizes / fleet composition do.
 * `fullscreen` lifts the 24-row cap: the F3 monitor owns the whole
 * screen (chat history hidden), so the pane should fill every row the
 * chrome doesn't need.
 */
export function transcriptRowsForTerminal(
  termRows: number | undefined,
  rosterCount: number,
  fullscreen = false,
): number {
  // Chrome above/below the pane: monitor header (4 rows) + roster lines +
  // detail chrome (3 rows) + pane border/header (3) + input/status margin (~8).
  const chrome = 4 + Math.max(0, rosterCount - 1) + 3 + 3 + 8;
  const available = (termRows ?? 30) - chrome;
  return Math.max(6, fullscreen ? available : Math.min(24, available));
}

const TRANSCRIPT_GLYPHS: Record<AgentTimelineEntry['kind'], string> = {
  text: '💬',
  thinking: '∴',
  tool_use: '🔧',
  tool_result: '📎',
  status: '·',
  error: '❌',
  system: '·',
};

/** One transcript entry as a single display line: `HH:MM:SS L3 🔧 …`. */
export function formatTranscriptLine(e: AgentTimelineEntry, maxWidth = 110): string {
  // Leader entries synthesized from chat history carry no timestamp /
  // iteration — omit those segments instead of printing placeholders.
  const time = e.ts
    ? (() => {
        const d = new Date(e.ts);
        return `${Number.isNaN(d.getTime()) ? '??:??:??' : d.toLocaleTimeString('en-US', { hour12: false })} `;
      })()
    : '';
  const iter = e.iteration > 0 ? `L${e.iteration} ` : '';
  const glyph = TRANSCRIPT_GLYPHS[e.kind] ?? '·';
  // tool_result content can be huge (up to ~20KB) — first line only, then snippet.
  const lines = e.content.split('\n');
  const firstLine = (lines[0] ?? '').trim();
  // The content's first line usually already names the tool ("glob({…})",
  // "Completed read (2ms)") — repeating the bare toolName produced noise
  // like "glob glob". Only prefix it when the content doesn't carry it.
  const tool = e.toolName && !firstLine.includes(e.toolName)
    ? `${e.toolName}${e.toolOk === false ? ' ✗' : ''} `
    : e.toolName && e.toolOk === false && !firstLine.includes('✗') && !firstLine.startsWith('Failed')
      ? '✗ '
      : '';
  const extraLines = lines.length - 1;
  const tail = extraLines > 0 ? ` (+${extraLines})` : '';
  const head = `${time}${iter}${glyph} ${tool}`;
  return `${head}${snippet(firstLine, Math.max(16, maxWidth - head.length - tail.length))}${tail}`;
}

/**
 * Map the main chat's history entries into the transcript timeline shape
 * so LEADER gets its own clean per-agent view in the F3 monitor. Subagent
 * lines are EXCLUDED — that separation (leader vs subagents, not
 * interleaved) is the whole point of the per-agent view. Banners and
 * confirm prompts are UI chrome, not history, and are skipped too.
 */
export function leaderTimelineFromEntries(entries: readonly HistoryEntry[]): AgentTimelineEntry[] {
  const out: AgentTimelineEntry[] = [];
  for (const e of entries) {
    const base = { id: `h${e.id}`, subagentId: 'leader', agentName: 'LEADER', ts: '', iteration: 0 } as const;
    switch (e.kind) {
      case 'user':
        out.push({ ...base, kind: 'status', content: `❯ ${e.text}` });
        break;
      case 'assistant':
        out.push({ ...base, kind: 'text', content: e.text });
        break;
      case 'thinking':
        out.push({ ...base, kind: 'thinking', content: e.text });
        break;
      case 'tool': {
        const meta = [
          e.durationMs > 0 ? `${e.durationMs}ms` : '',
          typeof e.outputLines === 'number' && e.outputLines > 0 ? `${e.outputLines}L` : '',
        ].filter(Boolean).join(' · ');
        out.push({ ...base, kind: 'tool_use', toolName: e.name, toolOk: e.ok, content: meta });
        break;
      }
      case 'error':
        out.push({ ...base, kind: 'error', content: e.text });
        break;
      case 'warn':
        out.push({ ...base, kind: 'system', content: `⚠ ${e.text}` });
        break;
      case 'info':
      case 'turn-summary':
        out.push({ ...base, kind: 'system', content: e.text });
        break;
      case 'brain':
        out.push({ ...base, kind: 'system', content: `🧠 ${e.question}${e.decision ? ` → ${e.decision}` : ''}` });
        break;
      // banner / confirm / subagent: intentionally skipped.
      default:
        break;
    }
  }
  return out;
}

/**
 * Slice a transcript (OLDEST first) into the fixed viewing window.
 * `scrollOffset` counts lines scrolled UP from the tail (0 = pinned to
 * newest). Returns the visible slice plus how many entries are hidden
 * above/below the window.
 */
export function selectTranscriptWindow(
  entries: readonly AgentTimelineEntry[],
  scrollOffset: number,
  rows: number = TRANSCRIPT_ROWS,
): { slice: AgentTimelineEntry[]; above: number; below: number } {
  const total = entries.length;
  const maxOffset = Math.max(0, total - rows);
  const offset = Math.max(0, Math.min(scrollOffset, maxOffset));
  const end = total - offset;
  const start = Math.max(0, end - rows);
  return { slice: entries.slice(start, end), above: start, below: offset };
}

/**
 * Fixed-height transcript pane. Constant row count in every state so the
 * surrounding inline-Ink layout never grows/shrinks while streaming
 * (growth at the bottom edge leaks rows into native scrollback).
 */
function TranscriptPane({
  entries,
  scrollOffset,
  rows = TRANSCRIPT_ROWS,
}: {
  entries: readonly AgentTimelineEntry[];
  scrollOffset: number;
  rows?: number | undefined;
}): React.ReactElement {
  const { slice, above, below } = selectTranscriptWindow(entries, scrollOffset, rows);
  const padding = Math.max(0, rows - slice.length);
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Box flexDirection="row" gap={1}>
        <Text dimColor bold>transcript</Text>
        <Text dimColor>
          {entries.length} entries · PgUp/PgDn scroll
          {above > 0 ? ` · ↑ ${above} earlier` : ''}
          {below > 0 ? ` · ↓ ${below} newer` : ''}
        </Text>
      </Box>
      {slice.map((e) => (
        <Text key={e.id} dimColor={e.kind === 'thinking' || e.kind === 'system'} color={e.kind === 'error' ? 'red' : undefined}>
          {formatTranscriptLine(e)}
        </Text>
      ))}
      {Array.from({ length: padding }, (_, i) => (
        <Text key={`pad-${i}`}> </Text>
      ))}
    </Box>
  );
}

/**
 * Expanded detail card for the selected agent — shows sparkline, last tool,
 * streaming text, budget warnings, and failure reason.
 */
function AgentDetail({
  entry,
  now,
  transcript,
  transcriptScroll = 0,
  transcriptRows = TRANSCRIPT_ROWS,
}: {
  entry: FleetEntry;
  now: number;
  /** Full transcript, OLDEST first. Undefined = no reader wired (fallback UI). */
  transcript?: AgentTimelineEntry[] | undefined;
  transcriptScroll?: number | undefined;
  transcriptRows?: number | undefined;
}): React.ReactElement {
  // Transcript mode: a CONSTANT-height card — exactly 3 chrome rows plus the
  // fixed transcript pane, with no conditional rows. Switching agents (or an
  // agent picking up budget warnings / costs mid-run) must never change the
  // card height: in inline Ink a growing bottom region leaks rows into the
  // native scrollback and yanks the user's scroll position.
  if (transcript) {
    const modelLbl = fmtModelLabel(entry.provider, entry.model) || [entry.provider, entry.model].filter(Boolean).join('/');
    const statusMeta = STATUS[entry.status];
    // Row 3 is a single always-present line: the most urgent of
    // failure > budget pressure > live stream tail > current activity.
    // The stream tail is the one place that updates in-place word by word —
    // the transcript pane below shows whole segments, not a delta ticker.
    const liveTail = entry.status === 'running' && entry.streamingText
      ? snippet(entry.streamingText.slice(-160), 110)
      : '';
    const alert = entry.failureReason && entry.status !== 'success'
      ? { color: 'red', text: `✗ ${snippet(entry.failureReason, 90)}` }
      : entry.budgetWarning
        ? { color: 'yellow', text: `⚡ ${entry.budgetWarning.kind} ${entry.budgetWarning.used}/${entry.budgetWarning.limit}${entry.extensions ? ` ×${entry.extensions}` : ''}` }
        : liveTail
          ? { color: 'gray', text: `∴ …${liveTail}` }
          : { color: entry.currentTool ? 'cyan' : 'gray', text: currentAction(entry, now) };
    return (
      <Box alignSelf="stretch" flexDirection="column" width="100%" flexGrow={1}>
        <Box
          alignSelf="stretch"
          flexDirection="column"
          width="100%"
          flexGrow={1}
          paddingX={1}
          borderStyle="single"
          borderColor="magenta"
        >
          <Box flexDirection="row" gap={1}>
            <Text color="magenta" bold>{formatAgentDetailHeader(entry)}</Text>
            <Text dimColor>{entry.id}</Text>
            {modelLbl ? <Text color="cyan">{modelLbl}</Text> : <Text dimColor>·</Text>}
            <Text color={statusMeta.color}>{statusMeta.icon} {entry.status}</Text>
          </Box>
          <Box flexDirection="row" gap={1}>
            <Text dimColor>runtime</Text>
            <Text>{fmtElapsed(Math.max(0, now - entry.startedAt))}</Text>
            <Text color="cyan">L{entry.iterations} {entry.toolCalls}t</Text>
            <Text dimColor>ctx</Text>
            <Text>{formatContextRunway(entry.ctxTokens, entry.ctxMaxTokens)}</Text>
            <Text color="green">${entry.cost.toFixed(4)}</Text>
          </Box>
          <Box flexDirection="row" gap={1}>
            <Text color={alert.color}>{alert.text}</Text>
          </Box>
          <TranscriptPane entries={transcript} scrollOffset={transcriptScroll} rows={transcriptRows} />
        </Box>
      </Box>
    );
  }

  const spark = sparkline(bucketActivity(entry.recentTools, now));
  const lastTool = entry.recentTools[entry.recentTools.length - 1];
  const lastMessage = entry.recentMessages[entry.recentMessages.length - 1];
  const streamTail = entry.streamingText ? snippet(entry.streamingText.slice(-160)) : '';
  const risk = riskMeta(agentRisk(entry));
  const ctxLine = formatContextRunway(entry.ctxTokens, entry.ctxMaxTokens);
  const modelLabel = fmtModelLabel(entry.provider, entry.model) || [entry.provider, entry.model].filter(Boolean).join('/');

  return (
    <Box alignSelf="stretch" flexDirection="column" width="100%" flexGrow={1}>
      <Box
        alignSelf="stretch"
        flexDirection="column"
        width="100%"
        flexGrow={1}
        paddingX={1}
        borderStyle="single"
        borderColor="magenta"
      >
        <Box flexDirection="row" gap={1}>
          <Text color="magenta" bold>
            {formatAgentDetailHeader(entry)}
          </Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text dimColor>id</Text>
          <Text>{entry.id}</Text>
          {modelLabel ? (
            <>
              <Text dimColor>· model</Text>
              <Text color="cyan">{modelLabel}</Text>
            </>
          ) : null}
          <Text dimColor>· status</Text>
          <Text color={STATUS[entry.status].color}>{STATUS[entry.status].icon} {entry.status}</Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text dimColor>runtime</Text>
          <Text>{fmtElapsed(Math.max(0, now - entry.startedAt))}</Text>
          <Text dimColor>· started</Text>
          <Text>{fmtOptionalTimestamp(entry.startedAt)}</Text>
          <Text dimColor>· last event</Text>
          <Text>{fmtShortDuration(Math.max(0, now - entry.lastEventAt))} ago</Text>
          {entry.extensions && entry.extensions > 0 ? <Text color="yellow">· extensions ⚡×{entry.extensions}</Text> : null}
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text dimColor>throughput</Text>
          <Text color="cyan">{entry.iterations} iterations</Text>
          <Text dimColor>·</Text>
          <Text color="cyan">{entry.toolCalls} tools</Text>
          <Text dimColor>· current</Text>
          <Text color={entry.currentTool ? 'cyan' : 'gray'}>{currentAction(entry, now)}</Text>
        </Box>
      {/* Activity sparkline + last completed tool */}
      {spark || lastTool ? (
        <Box flexDirection="row" gap={1}>
          <Text color="green">{spark || ''}</Text>
          {lastTool ? (
            <Text dimColor>
              last: {lastTool.name}
              {typeof lastTool.durationMs === 'number' ? ` ${lastTool.durationMs}ms` : ''}
              {lastTool.ok === false ? ' ✗' : ''}
            </Text>
          ) : null}
        </Box>
      ) : null}

      <Box flexDirection="row" gap={1}>
        <Text color={risk.color}>{risk.icon} {risk.label}</Text>
        <Text dimColor>ctx</Text>
        <Text color={risk.color}>{ctxLine}</Text>
        <Text dimColor>idle {fmtShortDuration(Math.max(0, now - entry.lastEventAt))}</Text>
      </Box>

      {/* Cost breakdown */}
      {(entry.cost > 0 || (entry.ctxCost && entry.ctxCost > 0)) ? (
        <Box>
          <Text dimColor>cost: </Text>
          {entry.cost > 0 ? <Text color="green">${entry.cost.toFixed(4)} total</Text> : null}
          {entry.cost > 0 && entry.ctxCost && entry.ctxCost > 0 ? <Text dimColor>  ·  </Text> : null}
          {entry.ctxCost && entry.ctxCost > 0 ? (
            <Text color="yellow">${entry.ctxCost.toFixed(4)} ctx</Text>
          ) : null}
        </Box>
      ) : null}

      {entry.transcriptPath ? (
        <Box>
          <Text dimColor>transcript: {snippet(entry.transcriptPath, 120)}</Text>
        </Box>
      ) : null}

      {entry.recentTools.length > 0 ? (
        <Box flexDirection="row" gap={1}>
          <Text dimColor>recent</Text>
          {entry.recentTools.slice(-4).map((tool, i) => {
            const visual = getToolVisual(tool.name);
            return (
              <Text key={`${tool.name}-${tool.at}-${i}`} color={tool.ok === false ? 'red' : visual.color}>
                {`‹${visual.glyph} ${formatRecentToolChip(tool)}›`}
              </Text>
            );
          })}
        </Box>
      ) : null}

      {/* Live streaming tail */}
      {entry.status === 'running' && streamTail ? (
        <Box>
          <Text dimColor>
            {'>'} {streamTail}
          </Text>
        </Box>
      ) : null}

      {/* Latest finished-message snippet */}
      {(entry.status !== 'running' || !streamTail) && lastMessage ? (
        <Box>
          <Text dimColor>msg: {snippet(lastMessage.text)}</Text>
        </Box>
      ) : null}

      {/* Budget pressure */}
      {entry.budgetWarning ? (
        <Box>
          <Text color="yellow">
            ⚡ {entry.budgetWarning.kind} {entry.budgetWarning.used}/{entry.budgetWarning.limit} —
            extending
          </Text>
        </Box>
      ) : null}

      {/* Failure reason */}
      {entry.failureReason && entry.status !== 'success' ? (
        <Box>
          <Text color="red">✗ {entry.failureReason}</Text>
        </Box>
      ) : null}
      </Box>
    </Box>
  );
}

/**
 * Live per-agent monitor (Ctrl+G / F3). Hybrid compact view:
 * - All agents, including LEADER, are available via ↑↓ navigation.
 * - Non-selected agents render as single-line rows.
 * - The selected agent expands in place into a titled detail rectangle.
 */
export function AgentsMonitor({
  entries,
  totalCost,
  leaderCost = 0,
  totalTokens,
  nowTick,
  onClose,
  transcripts,
  leaderTranscript,
  fullscreen = false,
}: AgentsMonitorProps): React.ReactElement {
  const all = Object.values(entries);
  const grandCost = leaderCost + totalCost;

  const live = useMemo(() => selectLiveAgents(all, nowTick), [all, nowTick]);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [emptyAgentsCloseStartedAt, setEmptyAgentsCloseStartedAt] = useState<number | undefined>(undefined);

  useEffect(() => {
    const nextStartedAt = nextEmptyAgentsCloseStartedAt(live.length, nowTick, emptyAgentsCloseStartedAt);
    if (nextStartedAt !== emptyAgentsCloseStartedAt) setEmptyAgentsCloseStartedAt(nextStartedAt);
    if (shouldCloseEmptyAgentsMonitor(live.length, nowTick, nextStartedAt)) onClose?.();
  }, [emptyAgentsCloseStartedAt, live.length, nowTick, onClose]);

  const selected = selectAgentDetail(live, selectedId);
  const selectedIndex = selected ? live.findIndex((entry) => entry.id === selected.id) : -1;

  // Selected agent's full transcript, refreshed on the 1s nowTick (poll —
  // AgentMonitorService's per-delta events would re-render per token).
  // Subagents: getTranscript returns newest-first, the pane wants oldest-
  // first. LEADER: the main chat's own entries (already oldest-first),
  // supplied by the App WITHOUT subagent lines, so every agent — leader
  // included — gets its own clean, separate history.
  const [transcriptScroll, setTranscriptScroll] = useState(0);
  const selectedTranscriptId = selected?.id;
  const transcript = useMemo(() => {
    if (!selected) return undefined;
    if (isLeaderEntry(selected)) {
      return leaderTranscript ? leaderTranscript().slice(-TRANSCRIPT_FETCH_LIMIT) : undefined;
    }
    return transcripts
      ? transcripts.getTranscript(selected.id, TRANSCRIPT_FETCH_LIMIT).slice().reverse()
      : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nowTick drives the 1 Hz refresh
  }, [transcripts, leaderTranscript, selectedTranscriptId, nowTick]);
  // Re-pin to the newest entries when the selection changes.
  useEffect(() => {
    setTranscriptScroll(0);
  }, [selectedTranscriptId]);

  // Pane height: constant for a given terminal size + roster size, so
  // ↑↓ agent switches never change the overall panel height.
  const { stdout } = useStdout();
  const paneRows = transcriptRowsForTerminal(stdout?.rows, live.length, fullscreen);

  // Keyboard navigation. Arrow keys ONLY — the chat input stays live beneath
  // this panel, so j/k are left free to type into the message buffer rather
  // than being captured here as navigation. PgUp/PgDn scroll the transcript
  // pane (safe: the composer skips PgUp/PgDn while an overlay is open).
  useInput((_input, key) => {
    if (live.length === 0) return;
    if (key.upArrow) {
      const next = Math.max(0, selectedIndex - 1);
      setSelectedId(live[next]?.id);
    } else if (key.downArrow) {
      const next = Math.min(live.length - 1, selectedIndex + 1);
      setSelectedId(live[next]?.id);
    } else if (key.pageUp && transcript) {
      const maxOffset = Math.max(0, transcript.length - paneRows);
      setTranscriptScroll((s) => Math.min(maxOffset, s + paneRows));
    } else if (key.pageDown && transcript) {
      setTranscriptScroll((s) => Math.max(0, s - paneRows));
    }
  });

  const running = live.filter((e) => e.status === 'running').length;
  const totalDone = all.filter((e) => e.status === 'success').length;
  const totalFailed = all.filter((e) => e.status === 'failed' || e.status === 'timeout').length;
  const hotAgent = selectHotAgent(live);
  const pressure = live.length > 0
    ? live.reduce((max, e) => Math.max(max, e.ctxPct ?? 0), 0)
    : 0;
  const toolCalls = live.reduce((sum, e) => sum + e.toolCalls, 0);
  const iterations = live.reduce((sum, e) => sum + e.iterations, 0);


  return (
    <Box
      alignSelf="stretch"
      flexDirection="column"
      width="100%"
      borderStyle="round"
      borderColor="magenta"
      paddingX={1}
      flexGrow={1}
    >
      {/* Header */}
      <Box flexDirection="row" gap={1}>
        <Text bold color="magenta">
          AGENTS · LIVE
        </Text>
        <Text dimColor>│</Text>
        <Text color="yellow">▶{running}</Text>
        <Text dimColor>─────────────────</Text>
        <Text dimColor>done</Text>
        <Text color="green">✓{totalDone}</Text>
        <Text dimColor>·</Text>
        <Text dimColor>failed</Text>
        {totalFailed > 0 ? <Text color="red">✗{totalFailed}</Text> : null}
        <Text dimColor>· ↑↓ nav{transcripts ? ' · PgUp/PgDn transcript' : ''} · Esc / Ctrl+G / F3 close</Text>
      </Box>

      {/* Mission-control pulse: pressure, hottest agent, total throughput. */}
      <Box flexDirection="row" gap={1}>
        <Text dimColor>pulse</Text>
        <Text color={pressure >= 0.9 ? 'red' : pressure >= 0.75 ? 'yellow' : 'green'}>
          max ctx {pctTextFromRatio(pressure)}
        </Text>
        <Text dimColor>· hot</Text>
        {hotAgent ? (
          <Text color={riskMeta(agentRisk(hotAgent)).color}>
            {hotAgent.name} {hotAgent.ctxPct !== undefined ? pctTextFromRatio(hotAgent.ctxPct) : ''}
          </Text>
        ) : (
          <Text dimColor>none</Text>
        )}
        <Text dimColor>· throughput</Text>
        <Text color="cyan">{iterations}L/{toolCalls}t</Text>
      </Box>

      {/* Agent-type → model mapping (compact one-liner) */}
      {live.length > 0 ? (
        <Box flexDirection="row" gap={1}>
          <Text dimColor>models</Text>
          {(() => {
            const seen = new Map<string, string>();
            for (const e of live) {
              if (e.model) seen.set(e.name ?? e.id, `${e.provider ?? '?'}/${e.model}`);
            }
            return [...seen.entries()].slice(0, 4).map(([name, mod]) => (
              <Text key={name} dimColor>{name}:{mod}</Text>
            ));
          })()}
        </Box>
      ) : null}

      {/* Token + cost row */}
      <Box flexDirection="row" gap={1}>
        <Text dimColor>shown</Text>
        <Text color="magenta">{live.length}</Text>
        {totalTokens ? (
          <Text dimColor>
            {' '}
            {fmtTokens(totalTokens.input)}↑ {fmtTokens(totalTokens.output)}↓
          </Text>
        ) : null}
        <Text dimColor>total</Text>
        <Text color="green" bold>
          ${grandCost.toFixed(4)}
        </Text>
        <Text dimColor>
          (leader ${leaderCost.toFixed(4)} · fleet ${totalCost.toFixed(4)})
        </Text>
      </Box>

      {live.length === 0 ? (
        <Text dimColor>No live agents — spawn with /spawn or /fleet dispatch.</Text>
      ) : null}

      {/* Agent rows: only the selected entry expands in-place. */}
      {live.map((e) => (
        e.id === selected?.id ? (
          <AgentDetail
            key={e.id}
            entry={e}
            now={nowTick}
            transcript={transcript}
            transcriptScroll={transcriptScroll}
            transcriptRows={paneRows}
          />
        ) : (
          <AgentRow key={e.id} entry={e} now={nowTick} selected={false} />
        )
      ))}
    </Box>
  );
}
