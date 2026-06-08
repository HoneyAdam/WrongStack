import { cn } from '@/lib/utils';
import { useWebSocket } from '@/hooks/useWebSocket';
import {
  ChevronRight,
  Clock,
  GitBranch,
  History,
  Rewind,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

interface CheckpointInfo {
  index: number;
  iteration: number;
  timestamp: string;
  /** Human-readable label — first user message, tool name, etc. */
  label: string;
  /** Message count at this point. */
  messageCount: number;
  /** Token count at this point. */
  tokens: number;
}

// ── Component ──────────────────────────────────────────────────────────────

export interface CheckpointTimelineProps {
  className?: string | undefined;
}

export function CheckpointTimeline({
  className,
}: CheckpointTimelineProps): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const [checkpoints, setCheckpoints] = useState<CheckpointInfo[]>([]);
  const [rewinding, setRewinding] = useState(false);
  const ws = useWebSocket();
  const offRef = useRef<(() => void) | null>(null);

  // Fetch checkpoints when opened
  useEffect(() => {
    if (!open || !ws.client?.isConnected) return;

    ws.client.send?.({ type: 'session.checkpoints' });

    offRef.current =
      ws.client.on?.('session.checkpoints', (msg: unknown) => {
        const payload = (msg as { payload?: { checkpoints?: CheckpointInfo[] } })?.payload;
        if (payload?.checkpoints) setCheckpoints(payload.checkpoints);
      }) ?? null;

    return () => {
      offRef.current?.();
    };
  }, [open, ws.client]);

  const handleRewind = useCallback(
    async (index: number) => {
      setRewinding(true);
      ws.client.send?.({ type: 'session.rewind', payload: { checkpointIndex: index } });
      // The server will handle rewind and send a new session.start event.
      // Close after a short delay.
      setTimeout(() => {
        setOpen(false);
        setRewinding(false);
      }, 1000);
    },
    [ws.client],
  );

  // Open trigger button
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors group',
          className,
        )}
        title="Session checkpoints — rewind to a previous state"
      >
        <History className="h-3 w-3" />
        <span className="hidden sm:inline">rewind</span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/30 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border bg-card shadow-2xl max-h-[75vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Session Checkpoints</h2>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {checkpoints.length}
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

        {/* Title bar */}
        <div className="px-4 py-2 border-b bg-muted/20 text-[10px] text-muted-foreground">
          Rewind the session to any checkpoint. The conversation and file changes will be
          reverted to that point — the LLM continues fresh from there.
        </div>

        {/* Checkpoint list */}
        <div className="flex-1 overflow-y-auto">
          {checkpoints.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
              <Clock className="h-8 w-8 opacity-20" />
              <p className="text-sm">No checkpoints yet</p>
              <p className="text-xs">Checkpoints are created on each user message.</p>
            </div>
          ) : (
            <div className="py-1">
              {[...checkpoints].reverse().map((cp, i) => {
                const isLatest = i === 0;
                return (
                  <button
                    key={cp.index}
                    type="button"
                    onClick={() => handleRewind(cp.index)}
                    disabled={rewinding}
                    className={cn(
                      'w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors group',
                      isLatest
                        ? 'bg-primary/5 hover:bg-primary/10'
                        : 'hover:bg-accent/40',
                      rewinding && 'opacity-50 pointer-events-none',
                    )}
                  >
                    {/* Timeline dot */}
                    <div className="flex flex-col items-center mt-1.5">
                      <div
                        className={cn(
                          'w-2.5 h-2.5 rounded-full border-2 shrink-0',
                          isLatest
                            ? 'border-primary bg-primary/20'
                            : 'border-muted-foreground/30 bg-background',
                        )}
                      />
                      {i < checkpoints.length - 1 && (
                        <div className="w-px flex-1 min-h-[16px] bg-border/50" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground tabular-nums shrink-0">
                          #{cp.index}
                        </span>
                        <span className="text-xs font-medium truncate">{cp.label}</span>
                        {isLatest && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary shrink-0">
                            latest
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                        <span className="tabular-nums">
                          {cp.messageCount} msg{cp.messageCount === 1 ? '' : 's'}
                        </span>
                        <span>·</span>
                        <span className="tabular-nums">~{cp.tokens.toLocaleString()} tok</span>
                        <span>·</span>
                        <span className="tabular-nums">
                          iter {cp.iteration}
                        </span>
                      </div>
                    </div>

                    <span className="shrink-0 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Rewind className="h-4 w-4 text-primary" />
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-4 py-2 text-[10px] text-muted-foreground text-center shrink-0">
          Click any checkpoint to rewind ·{' '}
          <kbd className="px-1 py-0.5 rounded bg-muted font-mono text-[9px]">Esc</kbd> to close
        </div>
      </div>
    </div>
  );
}
