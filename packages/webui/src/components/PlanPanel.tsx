import { getWSClient } from '@/lib/ws-client';
import { cn } from '@/lib/utils';
import { CheckCircle2, Circle, Clock } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

interface PlanItem {
  id: string;
  title: string;
  details?: string | undefined;
  status: 'open' | 'in_progress' | 'done';
}

const STATUS_CONFIG: Record<PlanItem['status'], { icon: React.ReactNode; label: string; color: string }> = {
  open: { icon: <Circle className="w-3.5 h-3.5" />, label: 'Open', color: 'text-muted-foreground/50' },
  in_progress: { icon: <Clock className="w-3.5 h-3.5 animate-spin" />, label: 'In Progress', color: 'text-yellow-500' },
  done: { icon: <CheckCircle2 className="w-3.5 h-3.5" />, label: 'Done', color: 'text-emerald-500' },
};

/**
 * Live plan board panel. Connects via WebSocket, requests the current
 * plan snapshot, and stays in sync via `plan.updated` events.
 *
 * Sections: In Progress → Open → Done, each collapsible.
 * Auto-hides when the plan is empty.
 */
export function PlanPanel(): React.ReactElement | null {
  const [items, setItems] = useState<PlanItem[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const ws = getWSClient();
  const offRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    ws.getPlan();
    offRef.current = ws.on('plan.updated', (msg: unknown) => {
      const payload = (msg as { payload?: { plan?: { items?: PlanItem[] } } })?.payload;
      if (payload?.plan?.items) setItems(payload.plan.items);
    });
    return () => { offRef.current?.(); };
  }, [ws]);

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const statusOrder: PlanItem['status'][] = ['in_progress', 'open', 'done'];
  const grouped = new Map<PlanItem['status'], PlanItem[]>();
  for (const it of items) {
    const list = grouped.get(it.status) ?? [];
    list.push(it);
    grouped.set(it.status, list);
  }

  const done = grouped.get('done')?.length ?? 0;
  if (items.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card/50 backdrop-blur-sm overflow-hidden">
      <div className="px-3 py-1.5 flex items-center gap-2 border-b border-border/50">
        <h2 className="text-[11px] font-semibold text-foreground uppercase tracking-wider">
          📋 Plan
        </h2>
        <span className="tabular text-[10px] text-muted-foreground ml-auto">
          {done}/{items.length}
        </span>
      </div>

      {statusOrder.map((status) => {
        const group = grouped.get(status);
        if (!group || group.length === 0) return null;
        const cfg = STATUS_CONFIG[status];
        const isCollapsed = collapsed.has(status);

        return (
          <div key={status} className="border-b border-border/30 last:border-b-0">
            <button
              type="button"
              onClick={() => toggle(status)}
              className="w-full px-3 py-1 flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <span className="tabular">{isCollapsed ? '▶' : '▼'} {group.length} {cfg.label}</span>
            </button>
            {!isCollapsed && group.map((it) => (
              <div
                key={it.id}
                className={cn(
                  'px-3 py-1.5 flex items-start gap-2 text-[13px]',
                  it.status === 'in_progress' ? 'bg-yellow-50/40 dark:bg-yellow-950/25' : '',
                )}
              >
                <span className={cn('mt-0.5 shrink-0', cfg.color)}>{cfg.icon}</span>
                <span className={cn(
                  'leading-snug flex-1 min-w-0',
                  it.status === 'done' ? 'text-muted-foreground line-through' : 'text-foreground/80',
                )}>
                  {it.title}
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
