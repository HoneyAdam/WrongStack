import { useCallback, useEffect, useState } from 'react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useAutoPhaseStore, useWorktreeStore } from '@/stores';
import { cn } from '@/lib/utils';
import { BoardView } from './BoardView';
import { WorktreeGraph } from './WorktreeGraph';
import { WorktreeLanes } from './WorktreeLanes';
import { Layers, Play, Rocket, X, Zap } from 'lucide-react';
import { Button } from './ui/button';

/**
 * AutoPhaseView — Full-screen phase view.
 *
 * Start screen (no phases) → goal form. Once phases exist, the interactive
 * kanban BoardView fills the area (phase columns / status swimlanes, drag-drop,
 * manual assignment, live worker per task). Worktree visualization docks at the
 * bottom while worktrees are active.
 *
 * Uses the shared useAutoPhaseStore (synced via autophase.state WS events) so
 * board data stays consistent with the chat-area PhasePanel.
 */
export function AutoPhaseView({ onClose }: { onClose: () => void }): React.ReactElement {
  const { client } = useWebSocket();
  const phases = useAutoPhaseStore((s) => s.phases);
  const overallPercent = useAutoPhaseStore((s) => s.overallPercent);
  const autonomous = useAutoPhaseStore((s) => s.autonomous);
  const title = useAutoPhaseStore((s) => s.title);
  const status = useAutoPhaseStore((s) => s.status);
  const lastError = useAutoPhaseStore((s) => s.lastError);
  const graphs = useAutoPhaseStore((s) => s.graphs);

  // Pull the list of persisted boards for this project on mount.
  useEffect(() => {
    client?.send?.({ type: 'autophase.list' });
  }, [client]);

  const worktrees = useWorktreeStore((s) => s.worktrees);
  const baseBranch = useWorktreeStore((s) => s.baseBranch);

  const [goal, setGoal] = useState('');
  const [starting, setStarting] = useState(false);
  const [showGraph, setShowGraph] = useState(false);

  const hasPhases = phases.length > 0;

  const handleStart = useCallback(async () => {
    const g = goal.trim();
    if (!g || starting) return;
    setStarting(true);
    await new Promise((r) => setTimeout(r, 100));
    client?.send?.({ type: 'autophase.start', payload: { title: g, autonomous: true } });
    setStarting(false);
  }, [goal, starting, client]);

  const handleToggleAutonomous = useCallback(() => {
    client?.send?.({ type: 'autophase.toggleAutonomous', payload: {} });
  }, [client]);

  const handleSelectBoard = useCallback(
    (graphId: string) => {
      if (graphId) client?.send?.({ type: 'autophase.load', payload: { graphId } });
    },
    [client],
  );

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b bg-card shrink-0">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-lg font-semibold">{hasPhases ? title || 'AutoPhase' : 'AutoPhase'}</h1>
            {hasPhases && (
              <p className="text-xs text-muted-foreground">
                {phases.length} phase{phases.length === 1 ? '' : 's'} · {overallPercent}% complete
              </p>
            )}
          </div>
          {hasPhases && (
            <span
              className={cn(
                'rounded border px-2 py-0.5 text-[11px] font-medium capitalize',
                status === 'failed'
                  ? 'border-destructive/40 bg-destructive/10 text-destructive'
                  : status === 'paused' || status === 'stopped'
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : status === 'completed'
                      ? 'border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300'
                      : 'border-primary/30 bg-primary/10 text-primary',
              )}
              title={lastError ?? undefined}
            >
              {status}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Board selector — every AutoPhase run is a persisted board (JSON on
              disk); switch between all boards saved for this project. */}
          {graphs.length > 0 && (
            <select
              value={hasPhases ? (graphs.find((g) => g.title === title)?.id ?? '') : ''}
              onChange={(e) => handleSelectBoard(e.target.value)}
              title="Switch board"
              className="rounded border border-border bg-card px-2 py-1 text-xs text-foreground"
            >
              <option value="" disabled>
                {graphs.length} board{graphs.length === 1 ? '' : 's'}…
              </option>
              {graphs.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title} · {g.status}
                </option>
              ))}
            </select>
          )}
          {hasPhases && (
            <button
              type="button"
              onClick={handleToggleAutonomous}
              title="Toggle autonomous mode"
              className={cn(
                'inline-flex items-center gap-1 rounded border px-2 py-1 text-xs transition-colors',
                autonomous
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              <Zap className="h-3.5 w-3.5" /> {autonomous ? 'Autonomous' : 'Manual'}
            </button>
          )}
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {!hasPhases ? (
        /* ── Start screen ── */
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-lg w-full space-y-6">
            <div className="text-center space-y-2">
              <Rocket className="h-10 w-10 mx-auto text-primary/60" />
              <h2 className="text-xl font-semibold">Start a Phase Plan</h2>
              <p className="text-sm text-muted-foreground">
                Describe what you want to build. WrongStack will plan phases and tasks, then execute
                them — watch and steer the run on the board.
              </p>
            </div>

            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Build a REST API for user management with Express and SQLite..."
              rows={5}
              className="w-full rounded-lg border border-border bg-card px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground/50"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleStart();
                }
              }}
            />

            <div className="flex items-center gap-3">
              <Button onClick={handleStart} disabled={!goal.trim() || starting} className="flex-1 gap-2">
                <Play className="h-4 w-4" />
                {starting ? 'Starting…' : 'Start AutoPhase'}
              </Button>
            </div>

            <p className="text-xs text-muted-foreground text-center">
              Ctrl+Enter to start · phases run in isolated worktrees with agents picking up tasks
            </p>
          </div>
        </div>
      ) : (
        /* ── Interactive kanban board ── */
        <div className="flex min-h-0 flex-1">
          <BoardView />
        </div>
      )}

      {/* Worktree visualization */}
      {worktrees.length > 0 && (
        <div className="border-t bg-card/50 shrink-0">
          <div className="flex items-center justify-end gap-2 px-4 pt-2 text-xs">
            <button
              type="button"
              onClick={() => setShowGraph(false)}
              className={cn(
                'rounded px-2 py-0.5 border transition-colors',
                !showGraph
                  ? 'bg-primary/10 border-primary/30 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              Lanes
            </button>
            <button
              type="button"
              onClick={() => setShowGraph(true)}
              className={cn(
                'rounded px-2 py-0.5 border transition-colors',
                showGraph
                  ? 'bg-primary/10 border-primary/30 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              Graph
            </button>
          </div>
          <div className="px-4 pb-3">
            {showGraph ? (
              <WorktreeGraph worktrees={worktrees} baseBranch={baseBranch} />
            ) : (
              <WorktreeLanes worktrees={worktrees} baseBranch={baseBranch} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
