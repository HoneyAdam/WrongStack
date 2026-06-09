import { getWSClient } from '@/lib/ws-client';
import { cn } from '@/lib/utils';
import { useConfigStore, useSessionStore } from '@/stores';
import { Eraser, Shrink } from 'lucide-react';
import { ContextBar } from './ContextBar';
import { fmtTok } from './ChatView/utils';

/**
 * Compact context summary for the sidebar.
 * The full ContextPanel lives in the main content area —
 * this is a lightweight companion that gives at-a-glance
 * context status and quick actions without duplication.
 */
export function ContextSidebar({
  className,
}: {
  className?: string | undefined;
}): React.ReactElement {
  const { lastInputTokens, maxContext } = useSessionStore();
  const wsUrl = useConfigStore((s) => s.wsUrl);

  const ctxPct =
    maxContext > 0
      ? Math.min(100, Math.round((lastInputTokens / maxContext) * 100))
      : 0;

  const handleClear = () => {
    getWSClient(wsUrl)?.send?.({ type: 'context.clear' });
  };

  const handleCompact = () => {
    getWSClient(wsUrl)?.send?.({ type: 'context.compact', payload: { aggressive: false } });
  };

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* ── Window usage ── */}
      <div className="rounded-lg border bg-card p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Window
          </span>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {fmtTok(lastInputTokens)} / {fmtTok(maxContext)}
          </span>
        </div>

        <ContextBar
          pct={ctxPct}
          tokens={lastInputTokens}
          maxTokens={maxContext}
          segments={12}
          showTokens={false}
        />

        {/* Fill bar */}
        <div className="flex items-center gap-2">
          <span className="flex-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <span
              className={cn(
                'h-full rounded-full transition-all duration-500',
                ctxPct >= 75
                  ? 'bg-destructive'
                  : ctxPct >= 60
                    ? 'bg-[hsl(var(--warning))]'
                    : 'bg-[hsl(var(--success))]',
              )}
              style={{ width: `${Math.max(2, ctxPct)}%` }}
            />
          </span>
          <span
            className={cn(
              'text-[11px] font-mono tabular-nums font-medium',
              ctxPct >= 75
                ? 'text-destructive'
                : ctxPct >= 60
                  ? 'text-[hsl(var(--warning))]'
                  : 'text-[hsl(var(--success))]',
            )}
          >
            {ctxPct}%
          </span>
        </div>
      </div>

      {/* ── Quick actions ── */}
      <div className="space-y-1">
        <button
          type="button"
          onClick={handleCompact}
          className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-[11px] hover:bg-accent transition-colors group"
        >
          <Shrink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
          <span className="flex-1 text-left">Compact</span>
          <span className="text-[10px] text-muted-foreground font-mono">/c</span>
        </button>

        <button
          type="button"
          onClick={handleClear}
          className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-[11px] hover:bg-accent transition-colors group"
        >
          <Eraser className="h-3.5 w-3.5 text-muted-foreground group-hover:text-destructive transition-colors" />
          <span className="flex-1 text-left">Clear</span>
          <span className="text-[10px] text-muted-foreground font-mono">Ctrl+L</span>
        </button>
      </div>

    </div>
  );
}
