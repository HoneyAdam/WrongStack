/**
 * FlowSidebar — Redesigned 2nd-level panel with collapsible sections.
 *
 * Key improvements:
 * - Collapsible accordion sections for better information density
 * - Quick actions bar always visible at top
 * - Session context prominently displayed
 * - Real-time stats with live updates
 * - Better agent cards with expanded info
 * - Tab-based navigation within sections
 */

import { useWebSocket } from '@/hooks/useWebSocket';
import { cn } from '@/lib/utils';
import {
  type Activity,
  useConfigStore,
  useFileStore,
  useFleetStore,
  useHistoryStore,
  useSessionStore,
  useUIStore,
} from '@/stores';
import type { SubagentView } from '@/stores';
import {
  ChevronDown,
  ChevronRight,
  Bot,
  Clock,
  FolderOpen,
  Gauge,
  Layers,
  Mail,
  MessageSquare,
  Play,
  Settings,
  Square,
  Wrench,
  X,
  Activity as ActivityIcon,
  Cpu,
  Database,
  Zap,
  Target,
  CheckCircle2,
  AlertCircle,
  Loader2,
  GitBranch,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, buttonVariants } from '../ui/button';
import { AgentDetail } from '../FleetPanel';
import { ContextSidebar } from '../ContextSidebar';
import { FileExplorer } from '../FileExplorer';
import { MailboxPanel } from '../MailboxPanel';
import { ProjectsPanel } from '../ProjectsPanel';
import { ConfigSection } from '../Sidebar/ConfigSection.js';
import { SessionActions } from '../Sidebar/SessionActions.js';
import { SessionList } from '../Sidebar/SessionList.js';
import { AgentFlowCanvasWithProvider } from '../AgentFlowGraph/AgentFlowCanvas.js';

// ── Types ─────────────────────────────────────────────────────────────────

type SectionId = 'session' | 'agents' | 'context' | 'history' | 'files' | 'mailbox' | 'stats' | 'flow';

interface Section {
  id: SectionId;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

const ACTIVITY_TO_SECTION: Record<Activity, SectionId> = {
  chat: 'session',
  agents: 'agents',
  context: 'context',
  history: 'history',
  files: 'files',
  projects: 'session',
  mailbox: 'mailbox',
  sessions: 'session',
};

// ── Status helpers ────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<SubagentView['status'], { color: string; bg: string; label: string; icon: React.ReactNode }> = {
  running: { color: 'text-emerald-400', bg: 'bg-emerald-400/10 border-emerald-400/30', label: 'Running', icon: <Play className="h-3 w-3" /> },
  completed: { color: 'text-blue-400', bg: 'bg-blue-400/10 border-blue-400/30', label: 'Done', icon: <CheckCircle2 className="h-3 w-3" /> },
  failed: { color: 'text-red-400', bg: 'bg-red-400/10 border-red-400/30', label: 'Failed', icon: <AlertCircle className="h-3 w-3" /> },
  timeout: { color: 'text-amber-400', bg: 'bg-amber-400/10 border-amber-400/30', label: 'Timeout', icon: <Clock className="h-3 w-3" /> },
  stopped: { color: 'text-gray-400', bg: 'bg-gray-400/10 border-gray-400/30', label: 'Stopped', icon: <Square className="h-3 w-3" /> },
};

function fmtCost(v: number): string {
  if (v <= 0) return '$0.000';
  if (v >= 0.01) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(4)}`;
}

function fmtDuration(ms: number | null): string {
  if (!ms) return '--';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

// ── Collapsible Section ───────────────────────────────────────────────────

function Section({
  id,
  label,
  icon,
  badge,
  isOpen,
  onToggle,
  children,
}: {
  id: SectionId;
  label: string;
  icon: React.ReactNode;
  badge?: number;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border/50 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors',
          'hover:bg-muted/50',
          isOpen && 'bg-muted/30',
        )}
      >
        <span className={cn('transition-colors', isOpen ? 'text-primary' : 'text-muted-foreground')}>
          {icon}
        </span>
        <span className={cn('flex-1 text-xs font-semibold', isOpen ? 'text-foreground' : 'text-muted-foreground')}>
          {label}
        </span>
        {badge !== undefined && badge > 0 && (
          <span className="min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-primary/20 text-primary text-[10px] font-bold">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
        <span className={cn('transition-transform', isOpen ? 'rotate-90' : '')}>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
        </span>
      </button>
      <div className={cn('overflow-hidden transition-all', isOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0')}>
        <div className="px-3 py-2">{children}</div>
      </div>
    </div>
  );
}

// ── Agent Card ─────────────────────────────────────────────────────────────

function AgentCard({ agent }: { agent: SubagentView }) {
  const config = STATUS_CONFIG[agent.status];
  const [expanded, setExpanded] = useState(false);
  const isActive = agent.status === 'running';

  return (
    <div
      className={cn(
        'rounded-lg border p-2.5 transition-all',
        config.bg,
        isActive && 'shadow-[0_0_12px_currentColor]/10',
      )}
    >
      <button
        type="button"
        className="w-full flex items-center gap-2"
        onClick={() => setExpanded(!expanded)}
      >
        <span className={cn('flex items-center gap-1', config.color)}>
          {config.icon}
        </span>
        <span className="flex-1 truncate text-[11px] font-semibold text-foreground text-left">
          {agent.name}
        </span>
        <span className={cn('text-[10px] font-mono tabular', config.color)}>
          {agent.iteration}it
        </span>
      </button>

      {expanded && (
        <div className="mt-2 pt-2 border-t border-border/30 space-y-1.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">Model</span>
            <span className="font-mono text-foreground/80">{agent.model || 'pending...'}</span>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">Cost</span>
            <span className="font-mono text-emerald-400">{fmtCost(agent.costUsd)}</span>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">Tools</span>
            <span className="font-mono text-foreground/80">{agent.toolCalls}</span>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">Context</span>
            <div className="flex items-center gap-1.5">
              <div className="w-16 h-1.5 rounded-full bg-black/30 overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all', agent.ctxPct > 80 ? 'bg-red-500' : agent.ctxPct > 60 ? 'bg-amber-500' : 'bg-blue-500')}
                  style={{ width: `${Math.min(100, agent.ctxPct)}%` }}
                />
              </div>
              <span className="font-mono text-foreground/60">{agent.ctxPct}%</span>
            </div>
          </div>
          {(agent.currentTool || agent.lastTool) && (
            <div className="flex items-center gap-1.5 text-[10px]">
              <Wrench className={cn('h-3 w-3 shrink-0', isActive ? 'text-amber-400 animate-pulse' : 'text-muted-foreground')} />
              <span className="font-mono text-foreground/70 truncate">
                {agent.currentTool || agent.lastTool}
              </span>
            </div>
          )}
          {agent.partialText && (
            <div className="mt-1.5 p-1.5 rounded bg-black/20 text-[9px] font-mono text-foreground/50 line-clamp-2">
              {agent.partialText.slice(-150)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Live Stats ────────────────────────────────────────────────────────────

function LiveStats() {
  const session = useSessionStore((s) => s.session);
  const totalTokens = useSessionStore((s) => s.totalTokens);
  const cost = useSessionStore((s) => s.cost);
  const iteration = useSessionStore((s) => s.iteration);
  const startTime = useSessionStore((s) => s.startTime);
  const ctxTokens = useSessionStore((s) => s.lastInputTokens);
  const maxContext = useSessionStore((s) => s.maxContext);
  const fleetAgents = useFleetStore((s) => s.agents);

  const runningAgents = useMemo(
    () => Array.from(fleetAgents.values()).filter((a) => a.status === 'running').length,
    [fleetAgents],
  );

  const elapsed = startTime ? Date.now() - startTime : 0;

  return (
    <div className="grid grid-cols-2 gap-1.5">
      <StatBox
        icon={<Cpu className="h-3.5 w-3.5" />}
        label="Tokens"
        value={totalTokens.input + totalTokens.output}
        sub={`${totalTokens.input} in / ${totalTokens.output} out`}
      />
      <StatBox
        icon={<Zap className="h-3.5 w-3.5" />}
        label="Cost"
        value={fmtCost(cost)}
        sub=""
      />
      <StatBox
        icon={<ActivityIcon className="h-3.5 w-3.5" />}
        label="Context"
        value={ctxTokens}
        sub={maxContext ? `${Math.round((ctxTokens / maxContext) * 100)}%` : ''}
      />
      <StatBox
        icon={<Bot className="h-3.5 w-3.5" />}
        label="Agents"
        value={fleetAgents.size}
        sub={runningAgents > 0 ? `${runningAgents} running` : ''}
      />
      <StatBox
        icon={<Layers className="h-3.5 w-3.5" />}
        label="Iteration"
        value={iteration ? iteration.index : '--'}
        sub={iteration?.max ? `/ ${iteration.max}` : ''}
      />
      <StatBox
        icon={<Clock className="h-3.5 w-3.5" />}
        label="Elapsed"
        value={fmtDuration(elapsed)}
        sub=""
      />
    </div>
  );
}

function StatBox({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string | number; sub: string }) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/30 border border-border/30">
      <span className="text-muted-foreground">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1">
          <span className="text-[11px] font-bold font-mono text-foreground tabular">{value}</span>
          <span className="text-[9px] text-muted-foreground truncate">{label}</span>
        </div>
        {sub && <div className="text-[9px] text-muted-foreground/70 truncate">{sub}</div>}
      </div>
    </div>
  );
}

// ── Quick Actions ─────────────────────────────────────────────────────────

function QuickActions() {
  const { client } = useWebSocket();
  const wsConnected = useConfigStore((s) => s.wsConnected);
  const session = useSessionStore((s) => s.session);

  if (!wsConnected) {
    return (
      <div className="px-3 py-2 text-[10px] text-muted-foreground text-center">
        Not connected
      </div>
    );
  }

  return (
    <div className="px-3 py-2 flex items-center gap-1.5">
      {session ? (
        <>
          <Button
            variant="outline"
            size="sm"
            className="h-7 flex-1 gap-1 text-[10px]"
            onClick={() => client?.send({ type: 'abort', payload: {} })}
          >
            <Square className="h-3 w-3" />
            Abort
          </Button>
        </>
      ) : (
        <Button
          variant="default"
          size="sm"
          className="h-7 flex-1 gap-1 text-[10px]"
          onClick={() => client?.newSession?.()}
        >
          <Play className="h-3 w-3" />
          New Session
        </Button>
      )}
    </div>
  );
}

// ── Main Sidebar ──────────────────────────────────────────────────────────

export function FlowSidebar() {
  const activeActivity = useUIStore((s) => s.activeActivity);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const { wsConnected } = useConfigStore();
  const { entries: historyEntries, loading: historyLoading } = useHistoryStore();
  const { listSessions, resumeSession, deleteSession, client } = useWebSocket();
  const session = useSessionStore((s) => s.session);

  // Fleet
  const fleetAgents = useFleetStore((s) => s.agents);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const fleetList = useMemo(() => {
    const arr = Array.from(fleetAgents.values());
    arr.sort((x, y) => {
      if (x.status === 'running' && y.status !== 'running') return -1;
      if (x.status !== 'running' && y.status === 'running') return 1;
      return x.startedAt - y.startedAt;
    });
    return arr;
  }, [fleetAgents]);
  const selectedAgent = selectedAgentId ? fleetList.find((a) => a.id === selectedAgentId) ?? null : null;

  // Active section based on activity
  const defaultSection = ACTIVITY_TO_SECTION[activeActivity] || 'session';
  const [openSections, setOpenSections] = useState<Set<SectionId>>(
    new Set([defaultSection]),
  );

  const toggleSection = (id: SectionId) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // History
  const [historyQuery, setHistoryQuery] = useState('');

  // Load history when section opens
  useEffect(() => {
    if (openSections.has('history') && wsConnected) {
      listSessions(50);
    }
  }, [openSections.has('history'), wsConnected, listSessions]);

  // Load file tree when section opens
  useEffect(() => {
    if (!openSections.has('files') || !wsConnected) return;
    useFileStore.getState().setTreeLoading(true);
    const cwd = useSessionStore.getState().cwd;
    client?.send({ type: 'files.tree', payload: cwd ? { path: cwd } : {} });
  }, [openSections.has('files'), wsConnected, client]);

  // Drag handle
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const onMove = (ev: MouseEvent) => setSidebarWidth(Math.max(280, Math.min(600, startWidth + (ev.clientX - startX))));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <aside
      style={{ width: `${sidebarWidth}px` }}
      className="relative border-r bg-card flex flex-col shrink-0 overflow-hidden"
    >
      {/* Drag handle */}
      <div
        onMouseDown={startDrag}
        onDoubleClick={() => setSidebarWidth(320)}
        className="group/handle absolute top-0 right-0 h-full w-2 cursor-col-resize z-10 flex items-center justify-center"
      >
        <div className="h-full w-px bg-border group-hover/handle:bg-primary/60 transition-all" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b shrink-0 bg-card/80">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-foreground">Session</span>
          {session && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-emerald-500/20 text-emerald-400">
              Active
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => setSidebarOpen(false)}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Quick Actions */}
      <QuickActions />

      {/* Collapsible Sections */}
      <div className="flex-1 overflow-y-auto">
        {/* Session Info */}
        <Section
          id="session"
          label="Session"
          icon={<MessageSquare className="h-4 w-4" />}
          isOpen={openSections.has('session')}
          onToggle={() => toggleSection('session')}
        >
          {session ? (
            <div className="space-y-2">
              <div className="text-[11px] space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Provider</span>
                  <span className="font-mono">{session.provider}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Model</span>
                  <span className="font-mono text-[10px]">{session.model}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Session ID</span>
                  <span className="font-mono text-[10px]">{session.id.slice(0, 8)}</span>
                </div>
              </div>
              <ConfigSection formatDuration={(s) => fmtDuration(s)} />
              <SessionActions wsConnected={wsConnected} />
            </div>
          ) : (
            <div className="text-center py-4 text-[11px] text-muted-foreground">
              No active session
            </div>
          )}
        </Section>

        {/* Live Stats */}
        <Section
          id="stats"
          label="Live Stats"
          icon={<ActivityIcon className="h-4 w-4" />}
          isOpen={openSections.has('stats')}
          onToggle={() => toggleSection('stats')}
        >
          <LiveStats />
        </Section>

        {/* Flow Graph */}
        <Section
          id="flow"
          label="Flow Graph"
          icon={<GitBranch className="h-4 w-4" />}
          isOpen={openSections.has('flow')}
          onToggle={() => toggleSection('flow')}
        >
          <div className="rounded-lg border border-border overflow-hidden" style={{ height: '320px' }}>
            <AgentFlowCanvasWithProvider />
          </div>
        </Section>

        {/* Agents */}
        <Section
          id="agents"
          label="Fleet Agents"
          icon={<Bot className="h-4 w-4" />}
          badge={fleetList.length}
          isOpen={openSections.has('agents')}
          onToggle={() => toggleSection('agents')}
        >
          {fleetList.length === 0 ? (
            <div className="text-center py-4 text-[11px] text-muted-foreground">
              No agents running
            </div>
          ) : (
            <div className="space-y-1.5">
              {fleetList.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </div>
          )}
        </Section>

        {/* Context */}
        <Section
          id="context"
          label="Context"
          icon={<Gauge className="h-4 w-4" />}
          isOpen={openSections.has('context')}
          onToggle={() => toggleSection('context')}
        >
          <ContextSidebar />
        </Section>

        {/* History */}
        <Section
          id="history"
          label="History"
          icon={<Clock className="h-4 w-4" />}
          badge={historyEntries.length || undefined}
          isOpen={openSections.has('history')}
          onToggle={() => toggleSection('history')}
        >
          <div className="space-y-2">
            <input
              type="text"
              placeholder="Search sessions..."
              value={historyQuery}
              onChange={(e) => setHistoryQuery(e.target.value)}
              className="w-full h-7 px-2 rounded border border-border bg-background text-[11px] placeholder:text-muted-foreground/50"
            />
            <SessionList
              historyQuery={historyQuery}
              setHistoryQuery={setHistoryQuery}
              historyEntries={historyEntries}
              historyLoading={historyLoading}
              historyError={null}
              wsConnected={wsConnected}
              listSessions={listSessions}
              resumeSession={resumeSession}
              deleteSession={deleteSession}
            />
          </div>
        </Section>

        {/* Files */}
        <Section
          id="files"
          label="Files"
          icon={<FolderOpen className="h-4 w-4" />}
          isOpen={openSections.has('files')}
          onToggle={() => toggleSection('files')}
        >
          <FileExplorer />
        </Section>

        {/* Mailbox */}
        <Section
          id="mailbox"
          label="Mailbox"
          icon={<Mail className="h-4 w-4" />}
          isOpen={openSections.has('mailbox')}
          onToggle={() => toggleSection('mailbox')}
        >
          <MailboxPanel />
        </Section>
      </div>

      {/* Agent Detail Overlay */}
      {selectedAgent && (
        <AgentDetail agent={selectedAgent} onClose={() => setSelectedAgentId(null)} />
      )}
    </aside>
  );
}
