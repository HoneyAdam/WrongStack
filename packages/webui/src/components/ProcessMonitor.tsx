import { cn } from '@/lib/utils';
import { useWebSocket } from '@/hooks/useWebSocket';
import {
  Cpu,
  Shield,
  Square,
  Terminal,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

interface TrackedProcess {
  pid: number;
  command: string;
  tool: string;
  startedAt: number;
  status: 'running' | 'exited' | 'killed';
  protected?: boolean | undefined;
}

// ── Component ──────────────────────────────────────────────────────────────

export interface ProcessMonitorProps {
  className?: string | undefined;
}

export function ProcessMonitor({ className }: ProcessMonitorProps): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const [processes, setProcesses] = useState<TrackedProcess[]>([]);
  const ws = useWebSocket();
  const offRef = useRef<(() => void) | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll the process registry via WS
  useEffect(() => {
    if (!ws.client?.isConnected) return;

    // Request initial list
    ws.client.send?.({ type: 'process.list' });

    // Listen for process events
    offRef.current = ws.client.on?.('process.list', (msg: unknown) => {
      const payload = (msg as { payload?: { processes?: TrackedProcess[] } })?.payload;
      if (payload?.processes) setProcesses(payload.processes);
    }) ?? null;

    // Poll every 5s
    pollRef.current = setInterval(() => {
      ws.client.send?.({ type: 'process.list' });
    }, 5000);

    return () => {
      offRef.current?.();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [ws.client]);

  const handleKill = useCallback(
    (pid: number) => {
      ws.client.send?.({ type: 'process.kill', payload: { pid } });
    },
    [ws.client],
  );

  const handleKillAll = useCallback(() => {
    ws.client.send?.({ type: 'process.killAll' });
  }, [ws.client]);

  const running = processes.filter((p) => p.status === 'running');

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] hover:bg-accent transition-colors group',
          running.length > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
          className,
        )}
        title={`Running processes: ${running.length}`}
      >
        <Cpu className={cn('h-3 w-3', running.length > 0 && 'animate-pulse')} />
        {running.length > 0 && <span className="font-medium tabular-nums">{running.length}</span>}
        <span className="hidden sm:inline">proc</span>
      </button>
    );
  }

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/30 backdrop-blur-sm',
        className,
      )}
    >
      <div className="w-full max-w-lg rounded-xl border bg-card shadow-2xl max-h-[70vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Running Processes</h2>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {running.length} active
            </span>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="p-1 rounded hover:bg-accent transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {processes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
              <Terminal className="h-8 w-8 opacity-20" />
              <p className="text-sm">No processes tracked</p>
              <p className="text-xs">Processes appear here when the agent runs bash/exec tools.</p>
            </div>
          ) : (
            <div className="divide-y">
              {processes.map((proc) => {
                const elapsed =
                  proc.status === 'running'
                    ? Math.floor((Date.now() - proc.startedAt) / 1000)
                    : null;
                const elapsedStr = elapsed
                  ? elapsed < 60
                    ? `${elapsed}s`
                    : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
                  : null;

                const isProtected = proc.protected === true;

                return (
                  <div
                    key={proc.pid}
                    className={cn(
                      'flex items-center justify-between px-4 py-2.5 text-xs',
                      proc.status === 'running'
                        ? 'bg-background'
                        : 'bg-muted/30 text-muted-foreground',
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span
                        className={cn(
                          'led shrink-0',
                          proc.status === 'running'
                            ? isProtected
                              ? 'text-blue-400'
                              : 'text-[hsl(var(--success))] led-pulse'
                            : 'text-muted-foreground',
                        )}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                            PID {proc.pid}
                          </span>
                          <span className="font-medium truncate">{proc.tool}</span>
                          {isProtected && (
                            <span
                              className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium"
                              title="Protected — this process survives kill/killAll"
                            >
                              <Shield className="h-2.5 w-2.5" />
                              protected
                            </span>
                          )}
                        </div>
                        <code className="text-[10px] text-muted-foreground/80 truncate block mt-0.5">
                          {proc.command}
                        </code>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      {elapsedStr && (
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {elapsedStr}
                        </span>
                      )}
                      {proc.status === 'running' && !isProtected && (
                        <button
                          type="button"
                          onClick={() => handleKill(proc.pid)}
                          className="p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-colors"
                          title={`Kill PID ${proc.pid}`}
                        >
                          <Square className="h-3.5 w-3.5 fill-current" />
                        </button>
                      )}
                      {proc.status === 'running' && isProtected && (
                        <span
                          className="text-[9px] text-muted-foreground/50 italic px-1"
                          title="Protected process — cannot be killed"
                        >
                          protected
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {running.length > 0 && (
          <div className="border-t px-4 py-2 shrink-0">
            <button
              type="button"
              onClick={handleKillAll}
              className="w-full flex items-center justify-center gap-2 py-1.5 rounded text-xs text-destructive hover:bg-destructive/10 transition-colors font-medium"
            >
              <Square className="h-3 w-3 fill-current" />
              Kill All ({running.length})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
