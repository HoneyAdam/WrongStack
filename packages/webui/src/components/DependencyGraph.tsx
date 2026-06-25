import { cn } from '@/lib/utils';
import type { BoardTaskItem, BoardTaskStatus, SpecColumn } from '@/stores';
import {
  Ban,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock,
  Loader2,
  Lock,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import type React from 'react';

/** FORGE-style status presentation (Completed/Running/Queued/Blocked/Pending/Failed). */
const STATUS: Record<
  BoardTaskStatus,
  { icon: React.ReactNode; label: string; text: string; ring: string }
> = {
  completed: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: 'Completed', text: 'text-emerald-400', ring: 'border-emerald-500/40' },
  in_progress: { icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, label: 'Running', text: 'text-sky-400', ring: 'border-sky-500/50' },
  queued: { icon: <Clock className="h-3.5 w-3.5" />, label: 'Queued', text: 'text-amber-400', ring: 'border-amber-500/40' },
  blocked: { icon: <Lock className="h-3.5 w-3.5" />, label: 'Blocked', text: 'text-rose-400', ring: 'border-rose-500/30' },
  pending: { icon: <Circle className="h-3.5 w-3.5" />, label: 'Pending', text: 'text-slate-400', ring: 'border-white/10' },
  review: { icon: <RotateCcw className="h-3.5 w-3.5" />, label: 'Review', text: 'text-violet-400', ring: 'border-violet-500/40' },
  failed: { icon: <XCircle className="h-3.5 w-3.5" />, label: 'Failed', text: 'text-red-400', ring: 'border-red-500/50' },
  cancelled: { icon: <Ban className="h-3.5 w-3.5" />, label: 'Cancelled', text: 'text-slate-400', ring: 'border-slate-500/40' },
};

const LEGEND: BoardTaskStatus[] = ['completed', 'in_progress', 'queued', 'blocked', 'pending', 'failed'];

const PRIORITY: Record<BoardTaskItem['priority'], { label: string; cls: string }> = {
  critical: { label: 'Crit', cls: 'bg-red-500/15 text-red-400' },
  high: { label: 'High', cls: 'bg-red-500/15 text-red-400' },
  medium: { label: 'Med', cls: 'bg-amber-500/15 text-amber-400' },
  low: { label: 'Low', cls: 'bg-emerald-500/15 text-emerald-400' },
};

export interface DependencyGraphProps {
  columns: SpecColumn[];
  onTaskClick?: ((taskId: string) => void) | undefined;
}

/**
 * DependencyGraph — FORGE-style task board. Tasks are laid into topological
 * phase columns (Start, Phase 1, …); each card shows its short id, priority,
 * title and dependency refs (← t01). A status legend sits above the columns.
 */
export function DependencyGraph({ columns, onTaskClick }: DependencyGraphProps): React.ReactElement {
  if (columns.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-slate-400">
        No tasks in this spec yet.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-white/10 bg-[#0f1115] p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-200">Dependency Graph</h3>

      {/* Legend */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {LEGEND.map((s) => (
          <span key={s} className={cn('inline-flex items-center gap-1.5', STATUS[s].text)}>
            {STATUS[s].icon}
            <span className="text-slate-400">{STATUS[s].label}</span>
          </span>
        ))}
      </div>

      {/* Columns */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((col, ci) => (
          <div key={col.label} className="flex items-start gap-3">
            <div className="w-60 shrink-0">
              <div className="mb-2 border-b border-white/10 pb-1 text-center text-xs font-medium uppercase tracking-wider text-slate-500">
                {col.label}
              </div>
              <div className="space-y-2">
                {col.tasks.map((task) => (
                  <TaskNodeCard key={task.id} task={task} onClick={onTaskClick} />
                ))}
              </div>
            </div>
            {ci < columns.length - 1 && (
              <div className="flex h-full items-center pt-8 text-slate-600">
                <ChevronRight className="h-5 w-5" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function TaskNodeCard({
  task,
  onClick,
}: {
  task: BoardTaskItem;
  onClick?: ((taskId: string) => void) | undefined;
}): React.ReactElement {
  const s = STATUS[task.displayStatus];
  const prio = PRIORITY[task.priority];
  return (
    <button
      type="button"
      onClick={() => onClick?.(task.id)}
      className={cn(
        'w-full rounded-md border bg-[#161a22] p-2.5 text-left transition-colors hover:border-orange-500/40',
        s.ring,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', s.text)}>
          {s.icon}
          <span className="font-mono text-slate-300">{task.shortId}</span>
        </span>
        <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', prio.cls)}>{prio.label}</span>
      </div>
      <p className="mt-1.5 text-xs text-slate-200">{task.title}</p>
      {task.deps.length > 0 && (
        <p className="mt-1 font-mono text-[10px] text-slate-500">← {task.deps.join(', ')}</p>
      )}
      {task.agentName && (
        <div
          className={cn(
            'mt-1.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]',
            task.displayStatus === 'in_progress'
              ? 'bg-sky-500/15 text-sky-400'
              : 'bg-white/5 text-slate-400',
          )}
          title={task.worktreeBranch ? `worktree: ${task.worktreeBranch}` : undefined}
        >
          {task.displayStatus === 'in_progress' && <Loader2 className="h-3 w-3 animate-spin" />}
          <span>{task.agentName}</span>
        </div>
      )}
    </button>
  );
}
