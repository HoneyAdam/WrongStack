import { cn } from '@/lib/utils';
import { CheckCircle2, Circle, Clock, Pause, Play, SkipForward, XCircle } from 'lucide-react';
import type React from 'react';

export interface PhaseItem {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'ready' | 'running' | 'paused' | 'completed' | 'failed' | 'skipped';
  priority: 'critical' | 'high' | 'medium' | 'low';
  estimateHours: number;
  actualDurationMs?: number;
  startedAt?: number;
  completedAt?: number;
  progressPercent: number;
  taskCount: number;
  completedTasks: number;
  assignedAgents: string[];
  isActive: boolean;
}

export interface PhasePanelProps {
  phases: PhaseItem[];
  /** Aktif faz ID'si */
  activePhaseId?: string;
  /** Faz seçildiğinde */
  onPhaseClick?: (phaseId: string) => void;
  /** Genel progress (0-100) */
  overallPercent: number;
  /** Otonom mod aktif mi */
  autonomous: boolean;
  /** Duraklat/Devam et */
  onToggleAutonomous?: () => void;
  className?: string;
}

const STATUS_CONFIG: Record<
  PhaseItem['status'],
  { icon: React.ReactNode; color: string; bg: string; label: string }
> = {
  pending: { icon: <Circle className="w-4 h-4" />, color: 'text-slate-400', bg: 'bg-slate-100 dark:bg-slate-800', label: 'Bekliyor' },
  ready: { icon: <Play className="w-4 h-4" />, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-950', label: 'Hazır' },
  running: { icon: <Clock className="w-4 h-4 animate-spin" />, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950', label: 'Çalışıyor' },
  paused: { icon: <Pause className="w-4 h-4" />, color: 'text-orange-500', bg: 'bg-orange-50 dark:bg-orange-950', label: 'Duraklatıldı' },
  completed: { icon: <CheckCircle2 className="w-4 h-4" />, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950', label: 'Tamamlandı' },
  failed: { icon: <XCircle className="w-4 h-4" />, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-950', label: 'Başarısız' },
  skipped: { icon: <SkipForward className="w-4 h-4" />, color: 'text-slate-400', bg: 'bg-slate-100 dark:bg-slate-800', label: 'Atlandı' },
};

const PRIORITY_DOT: Record<PhaseItem['priority'], string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-blue-500',
  low: 'bg-slate-400',
};

function formatDuration(ms?: number): string {
  if (!ms) return '';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

/**
 * PhasePanel — Solda duran faz listesi.
 *
 * Her faz bir kart olarak gösterilir. Aktif faz vurgulanır.
 * Üstte genel progress bar ve otonom mod toggle'ı vardır.
 */
export function PhasePanel({
  phases,
  activePhaseId,
  onPhaseClick,
  overallPercent,
  autonomous,
  onToggleAutonomous,
  className,
}: PhasePanelProps): React.ReactElement {
  return (
    <div className={cn('flex flex-col h-full w-72 border-r border-border bg-card', className)}>
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground">Fazlar</h2>
          <button
            type="button"
            onClick={onToggleAutonomous}
            className={cn(
              'px-2 py-1 text-xs rounded-full transition-colors',
              autonomous
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300'
                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
            )}
            title={autonomous ? 'Otonom mod aktif — duraklat' : 'Otonom mod pasif — başlat'}
          >
            {autonomous ? '● Otonom' : '○ Manuel'}
          </button>
        </div>

        {/* Overall Progress */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Genel İlerleme</span>
            <span>{overallPercent}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-500 rounded-full"
              style={{ width: `${overallPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Phase List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {phases.map((phase) => {
          const status = STATUS_CONFIG[phase.status];
          const isActive = phase.id === activePhaseId;

          return (
            <button
              type="button"
              key={phase.id}
              onClick={() => onPhaseClick?.(phase.id)}
              className={cn(
                'w-full text-left rounded-lg border p-3 transition-all hover:shadow-sm',
                isActive
                  ? 'border-amber-300 bg-amber-50/50 dark:bg-amber-950/30 ring-1 ring-amber-200'
                  : 'border-border bg-card hover:bg-accent/50',
              )}
            >
              {/* Phase Header */}
              <div className="flex items-start gap-2">
                <span className={cn('mt-0.5', status.color)}>{status.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <div className={cn('w-1.5 h-1.5 rounded-full', PRIORITY_DOT[phase.priority])} />
                    <span className="text-sm font-medium truncate">{phase.name}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{phase.description}</p>
                </div>
              </div>

              {/* Progress */}
              <div className="mt-2 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">
                    {phase.completedTasks}/{phase.taskCount} görev
                  </span>
                  <span className="text-muted-foreground">
                    {phase.progressPercent}%
                  </span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full transition-all duration-500 rounded-full',
                      phase.status === 'completed'
                        ? 'bg-emerald-500'
                        : phase.status === 'failed'
                          ? 'bg-red-500'
                          : 'bg-amber-500',
                    )}
                    style={{ width: `${phase.progressPercent}%` }}
                  />
                </div>
              </div>

              {/* Meta */}
              <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                <span>~{phase.estimateHours}h</span>
                {phase.actualDurationMs && (
                  <span>• {formatDuration(phase.actualDurationMs)}</span>
                )}
                {phase.assignedAgents.length > 0 && (
                  <span>• {phase.assignedAgents.length} agent</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
