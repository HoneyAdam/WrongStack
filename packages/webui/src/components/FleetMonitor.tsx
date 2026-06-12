/**
 * FleetMonitor — full TUI-equivalent fleet dashboard overlay.
 *
 * Displays:
 * - Fleet header with concurrency gauge
 * - Fleet-wide token aggregation + cost totals
 * - Collab session detail banner (when applicable)
 * - Per-agent table with sparklines, budget warnings, failure reasons
 * - Event timeline (last 20 events)
 * - Keyboard navigation hints
 *
 * Keyboard: ↑↓ navigate agents, Enter select, Esc close.
 */

import { Bot, Crown, Zap, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConcurrencyGauge, EventTimeline } from '@/components/ui';
import { SparklineChart } from '@/components/ui/sparkline';
import { cn } from '@/lib/utils';
import type { SubagentView } from '@/stores';
import { useFleetStore } from '@/stores';

export interface FleetMonitorProps {
  onClose: () => void;
  /** Optional: open agent detail for a specific agent */
  onSelectAgent?: (agent: SubagentView) => void;
}

function fmtCost(v: number): string {
  if (v <= 0) return '$0';
  if (v >= 0.01) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(5)}`.replace(/0+$/, '').replace(/\.$/, '');
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const STATUS_META: Record<SubagentView['status'], { led: string; label: string; pulse: boolean }> = {
  running: { led: 'bg-[hsl(var(--success))]', label: 'running', pulse: true },
  completed: { led: 'bg-[hsl(var(--success))]', label: 'done', pulse: false },
  failed: { led: 'bg-destructive', label: 'failed', pulse: false },
  timeout: { led: 'bg-[hsl(var(--warning))]', label: 'timeout', pulse: false },
  stopped: { led: 'bg-muted-foreground', label: 'stopped', pulse: false },
};

function AgentRow({
  agent,
  isSelected,
  isLeader,
  onClick,
}: {
  agent: SubagentView;
  isSelected: boolean;
  isLeader: boolean;
  onClick: () => void;
}) {
  const meta = STATUS_META[agent.status];
  const active = agent.status === 'running';

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left grid grid-cols-[140px_60px_1fr_60px_60px_60px_60px_50px_50px] items-center gap-x-2 px-3 py-1.5 rounded-md text-xs transition-colors',
        isSelected ? 'bg-primary/15 ring-1 ring-primary/40' : 'hover:bg-accent/50',
        active && !isSelected && 'bg-muted/30',
      )}
    >
      {/* Name + leader badge */}
      <div className="flex items-center gap-1 min-w-0">
        <span className={cn('led shrink-0', meta.led, meta.pulse && 'led-pulse')} />
        <span className="truncate font-medium">{agent.name}</span>
        {isLeader && (
          <Crown className="h-3 w-3 shrink-0 text-amber-500" aria-label="leader" />
        )}
      </div>

      {/* Status */}
      <span className={cn('text-[10px] tabular-nums', active ? 'text-[hsl(var(--success))]' : 'text-muted-foreground')}>
        {meta.label}
      </span>

      {/* Sparkline */}
      <div className="flex items-center gap-1 min-w-0">
        <SparklineChart bins={agent.sparklineBins} className="font-mono text-[9px]" />
        {agent.budgetWarning && (
          <span title={`⚡ hitting ${agent.budgetWarning.kind} limit (${agent.budgetWarning.used}/${agent.budgetWarning.limit})`}>
            <Zap className="h-3 w-3 shrink-0 text-amber-500" aria-label="budget warning" />
          </span>
        )}
      </div>

      {/* Iterations */}
      <span className="tabular-nums text-muted-foreground text-[10px]">
        {agent.iteration}it
      </span>

      {/* Tool calls */}
      <span className="tabular-nums text-muted-foreground text-[10px]">
        {agent.toolCalls}tc
      </span>

      {/* Cost */}
      <span className="tabular-nums font-mono text-[10px]">
        {fmtCost(agent.costUsd)}
      </span>

      {/* Context */}
      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              agent.ctxPct >= 85
                ? 'bg-destructive'
                : agent.ctxPct >= 70
                  ? 'bg-amber-500'
                  : 'bg-[hsl(var(--success))]',
            )}
            // Cap visual width at 200% so over-capacity bars still show meaningfully
            style={{ width: `${Math.min(200, agent.ctxPct)}%` }}
          />
        </div>
        <span className="text-[9px] tabular-nums text-muted-foreground font-mono leading-none">
          {agent.maxContext > 0 ? `${agent.ctxPct}%` : '—'}
        </span>
      </div>

      {/* Extensions */}
      <span className="tabular-nums text-[10px] text-muted-foreground">
        {agent.extensions > 0 ? `⚡×${agent.extensions}` : '—'}
      </span>

      {/* Failure reason */}
      <span className="text-[9px] text-destructive truncate" title={agent.failureReason}>
        {agent.failureReason ?? ''}
      </span>
    </button>
  );
}

export function FleetMonitor({ onClose, onSelectAgent }: FleetMonitorProps) {
  const fleetAgents = useFleetStore((s) => s.agents);
  const leaderId = useFleetStore((s) => s.leaderId);
  const fleetTokensIn = useFleetStore((s) => s.fleetTokensIn);
  const fleetTokensOut = useFleetStore((s) => s.fleetTokensOut);
  const fleetConcurrency = useFleetStore((s) => s.fleetConcurrency);
  const fleetConcurrencyMax = useFleetStore((s) => s.fleetConcurrencyMax);
  const eventTimeline = useFleetStore((s) => s.eventTimeline);

  const [selectedIdx, setSelectedIdx] = useState(0);

  const fleetList = useMemo(() => {
    const arr = Array.from(fleetAgents.values());
    arr.sort((x, y) => {
      // Leader first
      if (x.id === leaderId) return -1;
      if (y.id === leaderId) return 1;
      // Running before done
      const xa = x.status === 'running' ? 0 : 1;
      const ya = y.status === 'running' ? 0 : 1;
      if (xa !== ya) return xa - ya;
      return x.startedAt - y.startedAt;
    });
    return arr;
  }, [fleetAgents, leaderId]);

  const totalCost = useMemo(
    () => Array.from(fleetAgents.values()).reduce((sum, a) => sum + a.costUsd, 0),
    [fleetAgents],
  );

  const runningCount = fleetList.filter((a) => a.status === 'running').length;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, fleetList.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter' && fleetList[selectedIdx]) {
        onSelectAgent?.(fleetList[selectedIdx]);
      }
    },
    [fleetList, selectedIdx, onClose, onSelectAgent],
  );

  useEffect(() => {
    const handleGlobal = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleGlobal);
    return () => window.removeEventListener('keydown', handleGlobal);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-md"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-card/80 backdrop-blur shrink-0">
        <div className="flex items-center gap-3">
          <Bot className="h-5 w-5 text-primary" />
          <h2 className="text-sm font-semibold">Fleet Monitor</h2>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              {runningCount > 0 ? `${runningCount} running · ` : ''}
              {fleetList.length} total
            </span>
            <ConcurrencyGauge
              current={fleetConcurrency}
              max={fleetConcurrencyMax}
              showLabel
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground tabular-nums font-mono">
            ↓{fmtTok(fleetTokensIn)} ↑{fmtTok(fleetTokensOut)} · {fmtCost(totalCost)}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums font-mono">
            {leaderId
              ? `👑 ${fleetAgents.get(leaderId)?.name ?? leaderId}`
              : 'no leader'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted transition-colors"
            aria-label="Close fleet monitor"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Agent table */}
      <div className="flex-1 overflow-y-auto p-4">
        {fleetList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Bot className="h-12 w-12 mb-3 opacity-20" />
            <p className="text-sm font-medium">No agents active</p>
            <p className="text-xs mt-1">Agents appear here when the fleet is active.</p>
          </div>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            {/* Column headers */}
            <div className="grid grid-cols-[140px_60px_1fr_60px_60px_60px_60px_50px_50px] gap-x-2 px-3 py-1.5 bg-muted/50 border-b text-[9px] uppercase tracking-wider text-muted-foreground font-medium">
              <span>Name</span>
              <span>Status</span>
              <span>Activity</span>
              <span>Iters</span>
              <span>Tools</span>
              <span>Cost</span>
              <span>CTX</span>
              <span>Ext</span>
              <span>Reason</span>
            </div>

            {/* Rows */}
            {fleetList.map((agent, i) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                isSelected={i === selectedIdx}
                isLeader={agent.id === leaderId}
                onClick={() => {
                  setSelectedIdx(i);
                  onSelectAgent?.(agent);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer: event timeline */}
      <div className="border-t bg-card/80 backdrop-blur shrink-0">
        <div className="px-4 py-2 border-b">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            Event Timeline
          </span>
        </div>
        <div className="px-4 py-2 max-h-40 overflow-y-auto">
          <EventTimeline events={eventTimeline} max={20} />
        </div>
        <div className="px-4 py-1.5 border-t text-[10px] text-muted-foreground flex items-center gap-4">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
}
