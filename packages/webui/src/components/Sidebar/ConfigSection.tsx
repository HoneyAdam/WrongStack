import { cn } from '@/lib/utils';
import { useChatStore, useConfigStore, useSessionStore, useUIStore } from '@/stores';
import {
  CheckCircle2,
  Circle,
  CircleDot,
  Database,
  ListTodo,
  Pin,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Button } from '../ui/button';
import { ContextFillBar } from '../ContextBar';
import { fmtTok } from '../ChatView/utils';
import { getWSClient } from '@/lib/ws-client';

interface ConfigSectionProps {
  formatDuration: (start: number | null) => string;
}

export function ConfigSection({ formatDuration }: ConfigSectionProps) {
  const { wsConnected, wsUrl, provider, model } = useConfigStore();
  const { totalTokens, cost, session, todos, lastInputTokens, maxContext } = useSessionStore();
  const { messages } = useChatStore();
  const pinnedIds = useUIStore((s) => s.pinnedIds);
  const unpinAll = useUIStore((s) => s.unpinAll);
  const setCurrentView = useUIStore((s) => s.setCurrentView);

  const ctxPct =
    maxContext > 0 && lastInputTokens > 0
      ? Math.min(100, Math.round((lastInputTokens / maxContext) * 100))
      : 0;

  const pinnedRows = pinnedIds
    .map((id) => messages.find((m) => m.id === id))
    .filter((m): m is NonNullable<typeof m> => !!m && m.content.length > 0);

  return (
    <>
      {/* Connection status */}
      <div className="px-4 py-3 border-b">
        <div className={cn('flex items-center gap-2 px-3 py-2 rounded-lg text-sm', wsConnected ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400')}>
          {wsConnected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
          <span className="font-medium">{wsConnected ? 'Connected' : 'Disconnected'}</span>
        </div>
        <div className="text-xs text-muted-foreground mt-2 px-1 font-mono">{wsUrl}</div>
      </div>

      {/* Context window — live fill bar + quick compact/clear */}
      {maxContext > 0 && (
        <div className="px-4 py-3 border-b space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Context
            </span>
            <span className="text-[10px] text-muted-foreground tabular-nums font-mono">
              {fmtTok(lastInputTokens)}/{fmtTok(maxContext)}
            </span>
          </div>
          <ContextFillBar
            pct={ctxPct}
            tokens={lastInputTokens}
            maxTokens={maxContext}
            showTokens={false}
          />
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => getWSClient(wsUrl)?.send?.({ type: 'context.compact', payload: { aggressive: false } })}
              className="flex-1 text-[10px] px-2 py-1 rounded-md border border-border hover:bg-accent transition-colors"
              title="Compact context"
            >
              Compact
            </button>
            <button
              type="button"
              onClick={() => getWSClient(wsUrl)?.send?.({ type: 'context.clear' })}
              className="flex-1 text-[10px] px-2 py-1 rounded-md border border-border hover:bg-destructive/10 hover:text-destructive transition-colors"
              title="Clear context"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Active model */}
      <button type="button" onClick={() => setCurrentView('settings')} className="px-4 py-3 border-b text-left hover:bg-muted/40 transition-colors">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Active model</div>
        <div className="font-mono text-xs truncate">
          <span className="text-muted-foreground">{provider || '—'}</span>
          <span className="text-muted-foreground/40 mx-1">/</span>
          <span className="font-medium">{model || '—'}</span>
        </div>
      </button>

      {/* Session Stats */}
      <div className="px-4 py-3 border-b space-y-3">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          Session
        </h3>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex flex-col p-2 rounded-lg bg-muted/50">
            <span className="text-muted-foreground">Messages</span>
            <span className="text-lg font-semibold">{messages.length}</span>
          </div>
          <div className="flex flex-col p-2 rounded-lg bg-muted/50">
            <span className="text-muted-foreground">Duration</span>
            <span className="text-lg font-semibold">{formatDuration(session?.startedAt ?? null)}</span>
          </div>
          <div className="flex flex-col p-2 rounded-lg bg-muted/50">
            <span className="text-muted-foreground">Input</span>
            <span className="text-lg font-semibold">{totalTokens.input.toLocaleString()}</span>
          </div>
          <div className="flex flex-col p-2 rounded-lg bg-muted/50">
            <span className="text-muted-foreground">Output</span>
            <span className="text-lg font-semibold">{totalTokens.output.toLocaleString()}</span>
          </div>
        </div>
        {cost > 0 && (
          <div className="flex justify-between items-center p-2 rounded-lg bg-green-500/10">
            <span className="text-sm text-muted-foreground">Cost</span>
            <span className="text-lg font-semibold text-green-600 dark:text-green-400">${cost.toFixed(4)}</span>
          </div>
        )}
      </div>

      {/* Live TODO list */}
      {todos.length > 0 && (() => {
        const done = todos.filter((t) => t.status === 'completed').length;
        const running = todos.filter((t) => t.status === 'in_progress').length;
        const pct = todos.length > 0 ? Math.round((done / todos.length) * 100) : 0;
        const allDone = done === todos.length;
        return (
          <div className="px-4 py-3 border-b space-y-2.5">
            <h3 className="text-sm font-medium flex items-center justify-between">
              <span className="flex items-center gap-2"><ListTodo className="h-4 w-4 text-muted-foreground" />Plan</span>
              <span className="tabular text-[10px] text-muted-foreground">{done}/{todos.length}</span>
            </h3>
            <div className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-muted', running > 0 && 'bar-sweep')} title={`${pct}% complete`}>
              <div className={cn('h-full rounded-full transition-all duration-500', allDone ? 'bg-[hsl(var(--success))]' : 'bg-primary')} style={{ width: `${Math.max(pct, running > 0 ? 4 : 0)}%` }} />
            </div>
            <ul className="space-y-0.5 max-h-56 overflow-y-auto pr-1 -mx-1">
              {todos.map((t) => {
                const Icon = t.status === 'completed' ? CheckCircle2 : t.status === 'in_progress' ? CircleDot : Circle;
                const active = t.status === 'in_progress';
                const tone = t.status === 'completed' ? 'text-[hsl(var(--success))] line-through opacity-60' : active ? 'text-foreground' : 'text-muted-foreground';
                return (
                  <li key={t.id} className={cn('flex items-start gap-2 text-xs leading-snug rounded-md px-1.5 py-1 transition-colors', active && 'bg-primary/10 ring-1 ring-inset ring-primary/20', tone)}>
                    <Icon className={cn('h-3.5 w-3.5 mt-0.5 shrink-0', active && 'text-primary animate-pulse')} />
                    <span className="break-words">{active && t.activeForm ? t.activeForm : t.content}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })()}

      {/* Pinned answers */}
      {pinnedRows.length > 0 && (
        <div className="px-4 py-3 border-b space-y-2">
          <h3 className="text-sm font-medium flex items-center justify-between">
            <span className="flex items-center gap-2"><Pin className="h-4 w-4 text-amber-500" />Pinned</span>
            <button type="button" onClick={unpinAll} className="text-[10px] text-muted-foreground hover:text-destructive">Clear</button>
          </h3>
          <ul className="space-y-1 max-h-48 overflow-y-auto pr-1">
            {pinnedRows.map((m) => {
              const preview = m.content.replace(/\s+/g, ' ').slice(0, 80);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => {
                      const el = document.querySelector(`[data-message-id="${m.id}"]`);
                      if (!el) return;
                      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      el.classList.add('ring-2', 'ring-amber-500/60');
                      setTimeout(() => { el.classList.remove('ring-2', 'ring-amber-500/60'); }, 1600);
                    }}
                    className="w-full text-left text-xs px-2 py-1.5 rounded bg-muted/40 hover:bg-muted/70 border border-amber-500/20 leading-snug"
                    title={m.content.slice(0, 400)}
                  >
                    {preview}{m.content.length > 80 ? '…' : ''}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
