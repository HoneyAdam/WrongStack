import { ArrowDownAZ, ArrowUpAZ, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import type { QueuedItem, QueueMode } from '@/stores/chat-store';

type SortDir = 'oldest' | 'newest';

const MODE_META: Record<QueueMode, { label: string; tone: string; title: string }> = {
  btw: {
    label: 'btw',
    tone: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30',
    title: 'By-the-way — sent without interrupting the running agent',
  },
  steer: {
    label: 'steer',
    tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
    title: 'Steer — interrupts the running agent and redirects it',
  },
  queue: {
    label: 'queue',
    tone: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30',
    title: 'Queued — held until the current agent run completes',
  },
};

interface QueuedMessagesProps {
  queue: readonly QueuedItem[];
  onClear: () => void;
  onRemove: (index: number) => void;
}

export function QueuedMessages({ queue, onClear, onRemove }: QueuedMessagesProps) {
  const [sortDir, setSortDir] = useState<SortDir>('oldest');

  // Sort a copy so the underlying store stays in arrival order.
  // The store order matters for the drain loop in run.result — sorting
  // here for display must never disturb the actual send order.
  const sortedQueue = useMemo(() => {
    const copy = queue.slice();
    copy.sort((a, b) => (sortDir === 'newest' ? b.addedAt - a.addedAt : a.addedAt - b.addedAt));
    return copy;
  }, [queue, sortDir]);

  if (queue.length === 0) return null;

  return (
    <div className="rounded-lg border bg-muted/30 p-2 text-xs" data-testid="inline-queue">
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium shrink-0">
          Queue ({queue.length})
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setSortDir((d) => (d === 'newest' ? 'oldest' : 'newest'))}
            className={cn(
              'inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded text-[10px]',
              'hover:bg-muted',
            )}
            title={
              sortDir === 'newest'
                ? 'Sorted newest first — click to sort oldest first'
                : 'Sorted oldest first — click to sort newest first'
            }
            data-testid="inline-queue-sort"
          >
            {sortDir === 'newest' ? (
              <ArrowDownAZ className="h-3 w-3" />
            ) : (
              <ArrowUpAZ className="h-3 w-3" />
            )}
            {sortDir === 'newest' ? 'Newest' : 'Oldest'}
          </button>
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-destructive transition-colors px-1.5 py-0.5 rounded text-[10px]"
            title="Remove every queued message"
            data-testid="inline-queue-clear-all"
          >
            <Trash2 className="h-3 w-3" />
            Clear all
          </button>
        </div>
      </div>
      <ul className="space-y-1">
        {sortedQueue.map((item) => {
          const sourceIdx = queue.indexOf(item);
          const meta = MODE_META[item.mode];
          return (
            <li
              // The addedAt+sourceIdx pair uniquely identifies the item even
              // if two items happen to share the same addedAt ms (rare but
              // possible under synthetic timers in tests).
              key={`${item.addedAt}-${sourceIdx}`}
              className="flex items-start justify-between gap-2 rounded bg-background/60 border px-2 py-1"
              data-testid="inline-queue-item"
              data-queue-mode={item.mode}
            >
              <div className="flex items-start gap-1.5 min-w-0 flex-1">
                <span
                  className={cn(
                    'shrink-0 inline-flex items-center justify-center text-[9px] font-semibold uppercase tracking-wider px-1 py-px rounded border mt-0.5',
                    meta.tone,
                  )}
                  title={meta.title}
                >
                  {meta.label}
                </span>
                <span className="truncate flex-1 min-w-0">{item.text}</span>
              </div>
              <button
                type="button"
                onClick={() => onRemove(sourceIdx)}
                className="text-muted-foreground hover:text-destructive shrink-0"
                title="Remove from queue"
                data-testid={`inline-queue-remove-${sourceIdx}`}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
