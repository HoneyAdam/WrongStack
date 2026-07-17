import {
  Activity,
  Bot,
  Building2,
  Check,
  Clock3,
  Code2,
  File,
  FilePenLine,
  FolderSearch,
  Globe2,
  HardDrive,
  MemoryStick,
  Network,
  PanelsTopLeft,
  Search,
  TerminalSquare,
  Wifi,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useAppTranslation } from '@/i18n';
import {
  buildAgentToolCalls,
  classifyOfficeTool,
  synthesizeCurrentTool,
  type OfficeToolCall,
  type OfficeToolKind,
} from '@/lib/agent-office';
import { cn } from '@/lib/utils';
import { useFleetStore, useMonitorStore, useSessionStore, useVizStore } from '@/stores';
import type { ResolvedAgent, ResolvedClient } from './OfficeMapCanvas/resolve.js';
import { resolveClients } from './OfficeMapCanvas/resolve.js';
import './AgentOfficeView.css';

interface AgentOfficeViewProps {
  onOpenTopology: () => void;
}

interface OfficeAgentModel {
  key: string;
  client: ResolvedClient;
  agent: ResolvedAgent;
  calls: OfficeToolCall[];
  current?: OfficeToolCall | undefined;
  display?: OfficeToolCall | undefined;
  history: OfficeToolCall[];
}

interface SelectedAction {
  call: OfficeToolCall;
  agentName: string;
}

const TOOL_ICONS: Record<OfficeToolKind, LucideIcon> = {
  read: Search,
  write: FilePenLine,
  edit: FilePenLine,
  terminal: TerminalSquare,
  web: Globe2,
  search: FolderSearch,
  memory: MemoryStick,
  other: Code2,
};

function shortPath(value: string | undefined, max = 46): string | undefined {
  if (!value || value.length <= max) return value;
  const parts = value.split(/[\\/]/);
  const tail = parts.slice(-2).join('/');
  return tail.length <= max ? `…/${tail}` : `…${value.slice(-(max - 1))}`;
}

function relativeTime(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 5) return 'now';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) return '—';
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
}

function stringify(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function fallbackLogCalls(
  agent: ResolvedAgent,
  client: ResolvedClient,
  logs: Array<{ name: string; ok: boolean; durationMs: number; at: number }>,
): OfficeToolCall[] {
  return logs.map((log, index) => ({
    ...synthesizeCurrentTool(agent.serverId, log.name, client.sessionId),
    id: `${agent.serverId}:log:${log.at}:${index}`,
    kind: classifyOfficeTool(log.name),
    status: log.ok ? 'succeeded' : 'failed',
    startedAt: Math.max(0, log.at - log.durationMs),
    completedAt: log.at,
    durationMs: log.durationMs,
    summary: log.ok ? `${log.name} completed` : `${log.name} failed`,
  }));
}

function mergeFallbackCalls(rich: OfficeToolCall[], fallback: OfficeToolCall[]): OfficeToolCall[] {
  const merged = [...rich];
  for (const call of fallback) {
    const timestamp = call.completedAt ?? call.startedAt;
    const duplicate = rich.some(
      (candidate) =>
        candidate.toolName === call.toolName &&
        Math.abs((candidate.completedAt ?? candidate.startedAt) - timestamp) < 2500,
    );
    if (!duplicate) merged.push(call);
  }
  return merged.sort(
    (left, right) => (right.completedAt ?? right.startedAt) - (left.completedAt ?? left.startedAt),
  );
}

function ToolGlyph({ kind, active }: { kind: OfficeToolKind; active?: boolean }) {
  const Icon = TOOL_ICONS[kind];
  return (
    <span className={cn('agent-office__tool-glyph', `is-${kind}`, active && 'is-active')}>
      {kind === 'read' && <File className="agent-office__file-underlay" aria-hidden="true" />}
      <Icon aria-hidden="true" />
    </span>
  );
}

function AgentAvatar({ active, failed }: { active: boolean; failed: boolean }) {
  return (
    <div
      className={cn('agent-office__avatar', active && 'is-active', failed && 'is-failed')}
      aria-hidden="true"
    >
      <span className="agent-office__avatar-chair" />
      <span className="agent-office__avatar-body" />
      <span className="agent-office__avatar-head">
        <span className="agent-office__avatar-hair" />
        <span className="agent-office__avatar-face" />
        <span className="agent-office__avatar-headset" />
      </span>
      <span className="agent-office__avatar-arm" />
    </div>
  );
}

function ToolParcel({
  call,
  compact = false,
  onSelect,
}: {
  call: OfficeToolCall;
  compact?: boolean;
  onSelect: () => void;
}) {
  const active = call.status === 'running';
  return (
    <button
      type="button"
      className={cn(
        'agent-office__parcel',
        `is-${call.kind}`,
        compact && 'is-compact',
        active && 'is-running',
        call.status === 'failed' && 'is-failed',
      )}
      onClick={onSelect}
      aria-label={`${call.toolName}: ${call.summary}`}
    >
      <ToolGlyph kind={call.kind} active={active} />
      <span className="agent-office__parcel-copy">
        <span className="agent-office__parcel-topline">
          <strong>{call.toolName}</strong>
          {call.lineLabel && <span className="agent-office__line-chip">{call.lineLabel}</span>}
        </span>
        {!compact && call.target && (
          <span className="agent-office__parcel-target">{shortPath(call.target)}</span>
        )}
        <span className="agent-office__parcel-summary">{call.summary}</span>
      </span>
      <span className="agent-office__parcel-state" aria-hidden="true">
        {active ? (
          <span className="agent-office__pulse-dot" />
        ) : call.status === 'failed' ? (
          <X />
        ) : (
          <Check />
        )}
      </span>
    </button>
  );
}

function EmptyParcel({ active }: { active: boolean }) {
  const { t } = useAppTranslation();
  return (
    <div className="agent-office__parcel agent-office__parcel--empty">
      <span className="agent-office__tool-glyph">
        <Bot aria-hidden="true" />
      </span>
      <span className="agent-office__parcel-copy">
        <strong>
          {active ? t('activity:agentOffice.thinking') : t('activity:agentOffice.waiting')}
        </strong>
        <span>
          {active ? t('activity:agentOffice.preparing') : t('activity:agentOffice.deskReady')}
        </span>
      </span>
    </div>
  );
}

function AgentLane({
  model,
  now,
  onSelect,
}: {
  model: OfficeAgentModel;
  now: number;
  onSelect: (selected: SelectedAction) => void;
}) {
  const { t } = useAppTranslation();
  const { agent, client, current, display, history } = model;
  const active = agent.status === 'active' || agent.status === 'streaming';
  const failed = agent.status === 'error';

  return (
    <article className={cn('agent-office__lane', active && 'is-active', failed && 'is-failed')}>
      <div className="agent-office__identity">
        <div className="agent-office__identity-line">
          <span
            className={cn('agent-office__status-dot', active && 'is-active', failed && 'is-failed')}
          />
          <strong title={agent.name}>{agent.name}</strong>
        </div>
        <span className="agent-office__role">
          {agent.serverId === 'leader'
            ? t('activity:agentOffice.leadAgent')
            : t('activity:agentOffice.agent')}
        </span>
        <div className="agent-office__agent-meta">
          <span>{client.branch ? `⎇ ${client.branch}` : client.type.toUpperCase()}</span>
          <span>{t('activity:agentOffice.callsCount', { count: agent.toolCalls })}</span>
        </div>
      </div>

      <div className="agent-office__scene">
        <div className="agent-office__window" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="agent-office__plant" aria-hidden="true">
          <span />
          <i />
          <b />
        </div>
        <div className="agent-office__desk-zone" aria-hidden="true">
          <AgentAvatar active={active} failed={failed} />
          <span className="agent-office__monitor">
            {display ? <ToolGlyph kind={display.kind} active={current !== undefined} /> : <Code2 />}
          </span>
          <span className="agent-office__desk" />
          <span className="agent-office__mug" />
        </div>

        <div className={cn('agent-office__conveyor', current && 'is-moving')}>
          <div className="agent-office__belt" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="agent-office__current-action">
            {display ? (
              <ToolParcel
                call={display}
                onSelect={() => onSelect({ call: display, agentName: agent.name })}
              />
            ) : (
              <EmptyParcel active={active} />
            )}
          </div>
        </div>
      </div>

      <div className="agent-office__history">
        <div className="agent-office__history-heading">
          <span>{t('activity:agentOffice.recent')}</span>
          {display && <span>{relativeTime(display.completedAt ?? display.startedAt, now)}</span>}
        </div>
        <div className="agent-office__history-list">
          {history.length > 0 ? (
            history.map((call) => (
              <ToolParcel
                key={call.id}
                call={call}
                compact
                onSelect={() => onSelect({ call, agentName: agent.name })}
              />
            ))
          ) : (
            <span className="agent-office__history-empty">{t('activity:agentOffice.noCalls')}</span>
          )}
        </div>
      </div>
    </article>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="agent-office__detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ActionDetail({ selected, onClose }: { selected: SelectedAction; onClose: () => void }) {
  const { t } = useAppTranslation();
  const { call, agentName } = selected;
  const ToolIcon = TOOL_ICONS[call.kind];
  const input = stringify(call.input);
  const output = stringify(call.output);

  return (
    <aside className="agent-office__detail" aria-label={`${call.toolName} details`}>
      <div className="agent-office__detail-header">
        <div className={cn('agent-office__detail-icon', `is-${call.kind}`)}>
          <ToolIcon aria-hidden="true" />
        </div>
        <div>
          <span>{t('activity:agentOffice.toolCall')}</span>
          <h2>{call.toolName}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close details">
          <X />
        </button>
      </div>

      <div className="agent-office__detail-status">
        <span
          className={cn(
            'agent-office__status-dot',
            call.status === 'running' && 'is-active',
            call.status === 'failed' && 'is-failed',
          )}
        />
        <strong>{call.summary}</strong>
        <span>{call.status}</span>
      </div>

      <section className="agent-office__detail-section">
        <h3>{t('activity:agentOffice.execution')}</h3>
        <DetailRow label={t('activity:agentOffice.agent')} value={agentName} />
        <DetailRow
          label={t('activity:agentOffice.started')}
          value={new Date(call.startedAt).toLocaleTimeString()}
        />
        <DetailRow
          label={t('activity:agentOffice.duration')}
          value={formatDuration(call.durationMs)}
        />
        {call.sessionId && (
          <DetailRow
            label={t('activity:agentOffice.session')}
            value={shortPath(call.sessionId, 28)}
          />
        )}
      </section>

      {(call.target || call.fileTargets.length > 0) && (
        <section className="agent-office__detail-section">
          <h3>{t('activity:agentOffice.target')}</h3>
          {call.target && <code className="agent-office__target-code">{call.target}</code>}
          {call.fileTargets.map((target, index) => (
            <div className="agent-office__file-target" key={`${target.filePath}:${index}`}>
              <File aria-hidden="true" />
              <span>{target.filePath}</span>
              {(target.line || target.endLine) && (
                <strong>
                  L{target.line ?? 1}
                  {target.endLine ? `–${target.endLine}` : ''}
                </strong>
              )}
            </div>
          ))}
        </section>
      )}

      {(call.outputLines !== undefined ||
        call.outputBytes !== undefined ||
        call.outputTokens !== undefined) && (
        <section className="agent-office__detail-section">
          <h3>{t('activity:agentOffice.resultSize')}</h3>
          <div className="agent-office__metric-grid">
            {call.outputLines !== undefined && (
              <div>
                <strong>{call.outputLines.toLocaleString()}</strong>
                <span>{t('activity:agentOffice.lines')}</span>
              </div>
            )}
            {call.outputBytes !== undefined && (
              <div>
                <strong>{call.outputBytes.toLocaleString()}</strong>
                <span>{t('activity:agentOffice.bytes')}</span>
              </div>
            )}
            {call.outputTokens !== undefined && (
              <div>
                <strong>≈{call.outputTokens.toLocaleString()}</strong>
                <span>{t('activity:agentOffice.tokens')}</span>
              </div>
            )}
          </div>
        </section>
      )}

      {input && (
        <section className="agent-office__detail-section">
          <h3>{t('activity:agentOffice.input')}</h3>
          <pre>
            <code>{input}</code>
          </pre>
        </section>
      )}

      {output && (
        <section className="agent-office__detail-section">
          <h3>{t('activity:agentOffice.outputPreview')}</h3>
          <pre>
            <code>{output}</code>
          </pre>
        </section>
      )}
    </aside>
  );
}

export function AgentOfficeView({ onOpenTopology }: AgentOfficeViewProps) {
  const { t } = useAppTranslation();
  const liveSessions = useMonitorStore((state) => state.liveSessions);
  const aggregate = useMonitorStore((state) => state.aggregate);
  const fleetAgents = useFleetStore((state) => state.agents);
  const vizEvents = useVizStore((state) => state.events);
  const projectNameFromSession = useSessionStore((state) => state.projectName);
  const [selected, setSelected] = useState<SelectedAction | null>(null);

  const clients = useMemo(
    () => resolveClients(liveSessions, fleetAgents),
    [liveSessions, fleetAgents],
  );

  const models = useMemo<OfficeAgentModel[]>(
    () =>
      clients.flatMap((client) =>
        client.agents.map((agent) => {
          const richCalls = buildAgentToolCalls(vizEvents, agent.serverId, client.sessionId);
          const logs = fleetAgents.get(agent.serverId)?.toolLog ?? [];
          const calls = mergeFallbackCalls(richCalls, fallbackLogCalls(agent, client, logs));
          const isActive = agent.status === 'active' || agent.status === 'streaming';
          let current = calls.find((call) => call.status === 'running');
          if (!current && isActive && agent.currentTask) {
            current = synthesizeCurrentTool(agent.serverId, agent.currentTask, client.sessionId);
          }
          const display = current ?? calls[0];
          const history = calls.filter((call) => call.id !== display?.id).slice(0, 3);
          return {
            key: agent.officeId,
            client,
            agent,
            calls,
            current,
            display,
            history,
          };
        }),
      ),
    [clients, fleetAgents, vizEvents],
  );

  const activeCount = models.filter(
    ({ agent }) => agent.status === 'active' || agent.status === 'streaming',
  ).length;
  const projectName =
    projectNameFromSession ||
    liveSessions.find((candidate) => candidate.projectName)?.projectName ||
    t('activity:office.fleetHq');
  const now = Date.now();

  return (
    <div className="agent-office">
      <header className="agent-office__header">
        <div className="agent-office__title">
          <span className="agent-office__brand-mark">
            <Building2 aria-hidden="true" />
          </span>
          <div>
            <span>{t('activity:agentOffice.liveProjectOffice')}</span>
            <h1>{projectName}</h1>
          </div>
        </div>

        <div className="agent-office__live-pill">
          <span /> LIVE
        </div>

        <div className="agent-office__summary">
          <div>
            <Bot />
            <strong>{models.length}</strong>
            <span>{t('activity:agentOffice.agents')}</span>
          </div>
          <div>
            <Zap />
            <strong>{activeCount}</strong>
            <span>{t('activity:agentOffice.working')}</span>
          </div>
          <div>
            <Activity />
            <strong>{aggregate.toolCalls.toLocaleString()}</strong>
            <span>{t('activity:agentOffice.toolCalls')}</span>
          </div>
        </div>

        <fieldset className="agent-office__view-switch">
          <legend className="sr-only">Office view</legend>
          <button type="button" aria-pressed="true">
            <PanelsTopLeft /> {t('activity:agentOffice.office')}
          </button>
          <button type="button" onClick={onOpenTopology}>
            <Network /> {t('activity:agentOffice.topology')}
          </button>
        </fieldset>
      </header>

      <div className="agent-office__column-headings" aria-hidden="true">
        <span>{t('activity:agentOffice.team')}</span>
        <span>{t('activity:agentOffice.liveDesk')}</span>
        <span>{t('activity:agentOffice.lastActions')}</span>
      </div>

      <main className="agent-office__floor">
        {models.length > 0 ? (
          models.map((model) => (
            <AgentLane key={model.key} model={model} now={now} onSelect={setSelected} />
          ))
        ) : (
          <div className="agent-office__empty-state">
            <span>
              <Wifi aria-hidden="true" />
            </span>
            <h2>{t('activity:agentOffice.readyTitle')}</h2>
            <p>{t('activity:agentOffice.readyBody')}</p>
          </div>
        )}
      </main>

      <footer className="agent-office__footer">
        <span>
          <span className="agent-office__status-dot is-active" />{' '}
          {t('activity:agentOffice.liveEvent')}
        </span>
        <span>
          <HardDrive />{' '}
          {t('activity:agentOffice.connectedSessions', { count: liveSessions.length })}
        </span>
        <span>
          <Clock3 /> {t('activity:agentOffice.detailHint')}
        </span>
      </footer>

      {selected && (
        <>
          <button
            type="button"
            className="agent-office__detail-backdrop"
            onClick={() => setSelected(null)}
            aria-label="Close tool details"
          />
          <ActionDetail selected={selected} onClose={() => setSelected(null)} />
        </>
      )}
    </div>
  );
}
