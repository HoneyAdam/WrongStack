import type { KanbanBoard, KanbanColumn, KanbanTask } from '@wrongstack/kanban';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Columns3,
  Copy,
  MoveRight,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Rocket,
  Send,
  Square,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useKanbanMeta } from '@/hooks/useKanbanMeta';
import { type ModelCandidate, useProviderModels } from '@/hooks/useProviderModels';
import { cn } from '@/lib/utils';
import { getWSClient } from '@/lib/ws-client';
import { useConfigStore, useKanbanStore } from '@/stores';
import { ChipMultiSelect, type ChipOption } from './ChipMultiSelect';
import { ModelPicker } from './ModelPicker';

/** A kanban board that mirrors a live AutoPhase/SDD run, detected from its tags. */
interface RunLink {
  engine: 'sdd' | 'autophase';
  runId?: string | undefined;
}

function parseRunLink(board: { tags?: string[] | undefined } | null | undefined): RunLink | null {
  const tags = board?.tags ?? [];
  const engine = tags.includes('sdd') ? 'sdd' : tags.includes('autophase') ? 'autophase' : null;
  if (!engine) return null;
  const runId = tags.find((t) => t.startsWith('run:'))?.slice(4);
  return { engine, ...(runId ? { runId } : {}) };
}

export function KanbanView({ onClose }: { onClose?: (() => void) | undefined }) {
  const wsUrl = useConfigStore((s) => s.wsUrl);
  const { boards, activeBoardId, activeBoard, loading, error, queueHealth, setLoading, setActiveBoardId } =
    useKanbanStore();
  const [newBoardTitle, setNewBoardTitle] = useState('');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newColumnTitle, setNewColumnTitle] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);

  const ws = useMemo(() => getWSClient(wsUrl), [wsUrl]);
  const selectedTask = activeBoard?.tasks.find((task) => task.id === selectedTaskId) ?? null;

  const runningCostTotal = useMemo(() => {
    if (!activeBoard) return 0;
    return activeBoard.tasks
      .filter(
        (t) =>
          t.status === 'in_progress' || t.assignment?.status === 'running' || t.assignment?.status === 'queued',
      )
      .reduce((sum, t) => sum + (t.costCeilingUsd ?? 0), 0);
  }, [activeBoard]);

  const sendKanban = (type: `kanban.${string}`, payload: Record<string, unknown> = {}) => {
    setLoading(true);
    ws.send({ type, payload });
  };

  // Raw send for run-control messages (sdd.board.* / autophase.*) — these steer
  // the live run, which mirrors back into this board; no kanban response.
  const sendRaw = (type: string, payload: Record<string, unknown> = {}) => {
    (ws.send as (m: { type: string; payload?: unknown }) => void)({ type, payload });
  };

  const runLink = useMemo(() => parseRunLink(activeBoard), [activeBoard]);

  const refreshBoards = () => sendKanban('kanban.list');
  const refreshBoard = (boardId = activeBoardId) => {
    if (boardId) sendKanban('kanban.get', { boardId });
  };

  useEffect(() => {
    refreshBoards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeBoardId && boards[0]?.id) {
      setActiveBoardId(boards[0].id);
      sendKanban('kanban.get', { boardId: boards[0].id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boards, activeBoardId, setActiveBoardId]);

  useEffect(() => {
    if (
      activeBoard &&
      selectedTaskId &&
      !activeBoard.tasks.some((task) => task.id === selectedTaskId)
    ) {
      setSelectedTaskId(null);
    }
  }, [activeBoard, selectedTaskId]);

  useEffect(() => {
    if (activeBoardId) sendKanban('kanban.health', { boardId: activeBoardId });
  }, [activeBoardId]);

  // ── Live polling — refresh board + queue health every 3s while active ──
  // Sent raw (not via sendKanban) so the background poll doesn't flip the
  // loading spinner on every tick; agents that mutate tasks mid-run (status,
  // assignment) surface here, complementing the server's dispatch broadcasts.
  useEffect(() => {
    if (!activeBoardId) return;
    const interval = setInterval(() => {
      ws.send({ type: 'kanban.get', payload: { boardId: activeBoardId } });
      ws.send({ type: 'kanban.health', payload: { boardId: activeBoardId } });
    }, 3000);
    return () => clearInterval(interval);
  }, [activeBoardId, ws]);

  const createBoard = () => {
    const title = newBoardTitle.trim();
    if (!title) return;
    setNewBoardTitle('');
    sendKanban('kanban.create', { title });
  };

  const createTask = () => {
    if (!activeBoard) return;
    const title = newTaskTitle.trim();
    if (!title) return;
    setNewTaskTitle('');
    sendKanban('kanban.task.add', {
      boardId: activeBoard.id,
      title,
      columnId: activeBoard.columns[0]?.id ?? 'backlog',
    });
    window.setTimeout(() => refreshBoard(activeBoard.id), 150);
  };

  const createColumn = () => {
    if (!activeBoard) return;
    const title = newColumnTitle.trim();
    if (!title) return;
    setNewColumnTitle('');
    sendKanban('kanban.column.add', { boardId: activeBoard.id, title });
    window.setTimeout(() => refreshBoard(activeBoard.id), 150);
  };

  const deleteBoard = () => {
    if (!activeBoard) return;
    sendKanban('kanban.delete', { boardId: activeBoard.id });
    window.setTimeout(refreshBoards, 150);
  };

  const duplicateBoard = () => {
    if (!activeBoard) return;
    sendKanban('kanban.duplicate', {
      boardId: activeBoard.id,
      title: `${activeBoard.title} Copy`,
    });
    window.setTimeout(refreshBoards, 150);
  };

  const deleteTask = (task: KanbanTask) => {
    if (!activeBoard) return;
    sendKanban('kanban.task.remove', { boardId: activeBoard.id, taskId: task.id });
    window.setTimeout(() => refreshBoard(activeBoard.id), 150);
  };

  const moveTask = (taskId: string, columnId: string) => {
    if (!activeBoard) return;
    sendKanban('kanban.task.move', { boardId: activeBoard.id, taskId, columnId });
    window.setTimeout(() => refreshBoard(activeBoard.id), 150);
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground md:flex-row">
      <aside className="flex max-h-[45dvh] w-full shrink-0 flex-col border-b bg-card/40 md:max-h-none md:w-[280px] md:border-b-0 md:border-r">
        <div className="flex h-12 items-center gap-2 border-b px-3">
          <button
            type="button"
            title="Back"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft size={16} />
          </button>
          <Columns3 size={17} className="text-primary" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">Kanban</div>
            <div className="truncate text-[11px] text-muted-foreground">{boards.length} boards</div>
          </div>
          <button
            type="button"
            title="Refresh"
            onClick={refreshBoards}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : undefined} />
          </button>
        </div>

        <div className="flex gap-1 border-b p-2">
          <input
            value={newBoardTitle}
            onChange={(e) => setNewBoardTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') createBoard();
            }}
            placeholder="New board"
            className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
          />
          <button
            type="button"
            title="Create board"
            onClick={createBoard}
            className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {boards.map((board) => (
            <button
              key={board.id}
              type="button"
              onClick={() => {
                setActiveBoardId(board.id);
                sendKanban('kanban.get', { boardId: board.id });
              }}
              className={cn(
                'mb-1 w-full rounded-md px-2 py-2 text-left transition-colors',
                activeBoardId === board.id
                  ? 'bg-primary/10 text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <div className="truncate text-sm font-medium">{board.title}</div>
              <div className="mt-0.5 flex items-center justify-between text-[11px]">
                <span>{board.taskCount} tasks</span>
                <span>{board.completedTaskCount} done</span>
              </div>
            </button>
          ))}
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 sm:px-4">
          <div className="w-full min-w-0 sm:w-auto sm:flex-1">
            <div className="truncate text-sm font-semibold">
              {activeBoard?.title ?? 'No board selected'}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {activeBoard
                ? `${activeBoard.columns.length} columns / ${activeBoard.tasks.length} tasks`
                : 'Create or select a board'}
            </div>
          </div>
          {activeBoard && (
            <>
              <input
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createTask();
                }}
                placeholder="New task"
                className="h-8 w-[calc(100%-2.5rem)] min-w-0 flex-none rounded-md border bg-background px-2 text-sm outline-none focus:border-primary sm:w-56"
              />
              <button
                type="button"
                title="Add task"
                onClick={createTask}
                className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Plus size={16} />
              </button>
              <input
                value={newColumnTitle}
                onChange={(e) => setNewColumnTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createColumn();
                }}
                placeholder="New column"
                className="h-8 w-[calc(100%-2.5rem)] min-w-0 flex-none rounded-md border bg-background px-2 text-sm outline-none focus:border-primary sm:w-44"
              />
              <button
                type="button"
                title="Add column"
                onClick={createColumn}
                className="hidden h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted hover:text-foreground sm:flex"
              >
                <Columns3 size={16} />
              </button>
              <button
                type="button"
                title="Duplicate board"
                onClick={duplicateBoard}
                className="flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Copy size={16} />
              </button>
              <button
                type="button"
                title="Delete board"
                onClick={deleteBoard}
                className="hidden h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-destructive/10 hover:text-destructive sm:flex"
              >
                <Trash2 size={16} />
              </button>
            </>
          )}
        </header>

        {activeBoard && runLink && <RunControlBar runLink={runLink} sendRaw={sendRaw} />}
        {activeBoard && !runLink && activeBoard.tasks.length > 0 && (
          <StartAsBar boardId={activeBoard.id} sendKanban={sendKanban} />
        )}

        {error && (
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 text-sm text-destructive">
            <X size={15} />
            <span className="truncate">{error}</span>
          </div>
        )}

        <div className="kanban-scroll-area min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
          {activeBoard ? (
            <>
              {queueHealth && (
                <div className="flex shrink-0 items-center gap-4 border-b px-4 py-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Queue health</span>
                  {queueHealth.counts.ready > 0 && (
                    <span title="Claimable tasks" className="inline-flex items-center gap-1 text-success">
                      {queueHealth.counts.ready} ready
                    </span>
                  )}
                  {queueHealth.counts.running > 0 && (
                    <span title="Running assignments" className="inline-flex items-center gap-1 text-warning">
                      {queueHealth.counts.running} running
                    </span>
                  )}
                  {queueHealth.counts.review > 0 && (
                    <span title="In review" className="inline-flex items-center gap-1 text-primary">
                      {queueHealth.counts.review} review
                    </span>
                  )}
                  {queueHealth.counts.blocked > 0 && (
                    <span title="Manually blocked" className="inline-flex items-center gap-1 text-destructive">
                      {queueHealth.counts.blocked} blocked
                    </span>
                  )}
                  {queueHealth.counts.failed > 0 && (
                    <span title="Failed tasks" className="inline-flex items-center gap-1 text-destructive">
                      {queueHealth.counts.failed} failed
                    </span>
                  )}
                  {queueHealth.dependencyBlocked.count > 0 && (
                    <span title="Ready/pending tasks blocked by dependencies" className="inline-flex items-center gap-1 rounded bg-warning/10 px-1.5 py-0.5 text-warning">
                      {queueHealth.dependencyBlocked.count} blocked by deps
                    </span>
                  )}
                  {queueHealth.staleAssignments.count > 0 && (
                    <span title="Expired lease assignments" className="inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-destructive">
                      {queueHealth.staleAssignments.count} stale
                    </span>
                  )}
                  {queueHealth.heartbeatDue.count === 0 &&
                    queueHealth.staleAssignments.count === 0 &&
                    queueHealth.dependencyBlocked.count === 0 && (
                      <span className="text-success">healthy</span>
                    )}
                  {runningCostTotal > 0 && (
                    <span title="Sum of costCeilingUsd for running/queued tasks" className="inline-flex items-center gap-1 text-info">
                      ~${runningCostTotal.toFixed(2)} running cost
                    </span>
                  )}
                </div>
              )}
              <div className="flex h-full min-w-max gap-3 p-4">
              {[...activeBoard.columns]
                .sort((a, b) => a.order - b.order)
                .map((column) => (
                  <KanbanColumnView
                    key={column.id}
                    board={activeBoard}
                    column={column}
                    selectedTaskId={selectedTaskId}
                    dragTaskId={dragTaskId}
                    setDragTaskId={setDragTaskId}
                    onSelectTask={setSelectedTaskId}
                    onDeleteTask={deleteTask}
                    onMoveTask={moveTask}
                  />
                ))}
            </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No kanban board selected.
            </div>
          )}
        </div>
      </main>

      <TaskInspector
        boards={boards}
        board={activeBoard}
        task={selectedTask}
        runLink={runLink}
        onClose={() => setSelectedTaskId(null)}
        sendKanban={sendKanban}
        sendRaw={sendRaw}
        refreshBoard={refreshBoard}
      />
    </div>
  );
}

function RunControlBar({
  runLink,
  sendRaw,
}: {
  runLink: RunLink;
  sendRaw: (type: string, payload?: Record<string, unknown>) => void;
}) {
  const isSdd = runLink.engine === 'sdd';
  const pfx = isSdd ? 'sdd.board' : 'autophase';
  const btn =
    'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-muted';
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-primary/5 px-4 py-1.5">
      <span className="inline-flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">
        <Rocket size={11} /> {runLink.engine}
      </span>
      <span className="text-[11px] text-muted-foreground">Live run — steer it from here</span>
      <div className="ml-auto flex items-center gap-1">
        <button type="button" className={btn} onClick={() => sendRaw(`${pfx}.pause`)}>
          <Pause size={12} /> Pause
        </button>
        <button type="button" className={btn} onClick={() => sendRaw(`${pfx}.resume`)}>
          <Play size={12} /> Resume
        </button>
        {isSdd && (
          <button
            type="button"
            className={btn}
            onClick={() => sendRaw('sdd.board.retry_all_failed')}
          >
            <RotateCcw size={12} /> Retry failed
          </button>
        )}
        <button
          type="button"
          className={cn(btn, 'text-destructive hover:bg-destructive/10')}
          onClick={() => sendRaw(`${pfx}.stop`)}
        >
          <Square size={12} /> Stop
        </button>
      </div>
    </div>
  );
}

function StartAsBar({
  boardId,
  sendKanban,
}: {
  boardId: string;
  sendKanban: (type: `kanban.${string}`, payload?: Record<string, unknown>) => void;
}) {
  const btn =
    'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/10';
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-1.5">
      <Rocket size={13} className="text-primary" />
      <span className="text-[11px] text-muted-foreground">Run this board as a live agent job:</span>
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          className={btn}
          onClick={() => sendKanban('kanban.run.start', { boardId, engine: 'autophase' })}
        >
          Start as AutoPhase
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => sendKanban('kanban.run.start', { boardId, engine: 'sdd' })}
        >
          Start as SDD
        </button>
      </div>
    </div>
  );
}

/** Run-native per-task controls shown in the inspector for run-linked boards. */
function RunTaskControls({
  runLink,
  runTaskId,
  modelCandidates,
  sendRaw,
}: {
  runLink: RunLink;
  runTaskId: string;
  modelCandidates: ModelCandidate[];
  sendRaw: (type: string, payload?: Record<string, unknown>) => void;
}) {
  const isSdd = runLink.engine === 'sdd';
  const [reassigning, setReassigning] = useState(false);
  const [reassignName, setReassignName] = useState('');
  const btn =
    'inline-flex flex-1 items-center justify-center gap-1 rounded-md border py-1.5 text-xs font-medium hover:bg-muted';
  const submitReassign = () => {
    const n = reassignName.trim();
    if (!n) return;
    sendRaw(isSdd ? 'sdd.board.reassign' : 'autophase.assignTask', {
      taskId: runTaskId,
      agentName: n,
    });
    setReassigning(false);
    setReassignName('');
  };
  return (
    <div className="mt-4 rounded-md border bg-primary/5 p-2.5">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-primary">
        Run controls
      </div>
      {isSdd && (
        <div className="mb-2">
          <div className="mb-1 text-[10px] uppercase text-muted-foreground">Worker model</div>
          <ModelPicker
            candidates={modelCandidates}
            placeholder="Set model for this task…"
            onPick={(model, provider) =>
              sendRaw('sdd.board.set_task_model', { taskId: runTaskId, model, provider })
            }
          />
        </div>
      )}
      {reassigning ? (
        <div className="flex items-center gap-1.5">
          <input
            value={reassignName}
            onChange={(e) => setReassignName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitReassign();
              if (e.key === 'Escape') setReassigning(false);
            }}
            placeholder="New worker name"
            className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={submitReassign}
            className="rounded-md bg-primary/10 px-2 py-1.5 text-primary"
          >
            <Check size={14} />
          </button>
          <button
            type="button"
            onClick={() => setReassigning(false)}
            className="rounded-md bg-muted px-2 py-1.5"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={btn}
            onClick={() =>
              sendRaw(isSdd ? 'sdd.board.retry' : 'autophase.retryTask', { taskId: runTaskId })
            }
          >
            <RotateCcw size={13} /> Retry
          </button>
          <button type="button" className={btn} onClick={() => setReassigning(true)}>
            <UserPlus size={13} /> Reassign
          </button>
          {isSdd ? (
            <button
              type="button"
              className={cn(btn, 'text-destructive hover:bg-destructive/10')}
              onClick={() => sendRaw('sdd.board.cancel_task', { taskId: runTaskId })}
            >
              <Square size={13} /> Cancel
            </button>
          ) : (
            <button
              type="button"
              className={btn}
              onClick={() => sendRaw('autophase.runTask', { taskId: runTaskId })}
            >
              <Play size={13} /> Run now
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function KanbanColumnView({
  board,
  column,
  selectedTaskId,
  dragTaskId,
  setDragTaskId,
  onSelectTask,
  onDeleteTask,
  onMoveTask,
}: {
  board: KanbanBoard;
  column: KanbanColumn;
  selectedTaskId: string | null;
  dragTaskId: string | null;
  setDragTaskId: (id: string | null) => void;
  onSelectTask: (id: string) => void;
  onDeleteTask: (task: KanbanTask) => void;
  onMoveTask: (taskId: string, columnId: string) => void;
}) {
  const tasks = board.tasks
    .filter((task) => task.columnId === column.id)
    .sort((a, b) => a.order - b.order);
  const empty = tasks.length === 0;
  return (
    <section
      className={cn(
        'flex h-full shrink-0 flex-col rounded-md border bg-muted/25 transition-[width] duration-200',
        empty ? 'w-[180px]' : 'w-[310px]',
      )}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: column.color ?? 'hsl(var(--primary))' }}
        />
        <div className="min-w-0 flex-1 truncate text-sm font-semibold">{column.title}</div>
        <span className="rounded bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {tasks.length}
        </span>
      </div>
      <ul
        className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (dragTaskId) onMoveTask(dragTaskId, column.id);
          setDragTaskId(null);
        }}
      >
        {tasks.map((task) => (
          <li
            key={task.id}
            draggable
            onDragStart={() => setDragTaskId(task.id)}
            onDragEnd={() => setDragTaskId(null)}
            className={cn(
              'relative rounded-md border bg-background p-3 shadow-sm transition-colors',
              selectedTaskId === task.id ? 'border-primary' : 'hover:border-primary/50',
            )}
          >
            <button
              type="button"
              aria-label={`Select task: ${task.title}`}
              onClick={() => onSelectTask(task.id)}
              className="absolute inset-0 cursor-pointer rounded-md"
            />
            <div className="pointer-events-none relative flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-sm font-medium leading-5">{task.title}</div>
                {task.description && (
                  <div className="mt-1 line-clamp-2 text-xs leading-4 text-muted-foreground">
                    {task.description}
                  </div>
                )}
              </div>
              <button
                type="button"
                title="Delete task"
                aria-label={`Delete task: ${task.title}`}
                onClick={() => onDeleteTask(task)}
                className="pointer-events-auto relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="pointer-events-none relative mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className={priorityClass(task.priority)}>{task.priority}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                {task.status}
              </span>
              {task.assignedAgent && (
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">
                  {task.assignedAgent}
                </span>
              )}
              {task.assignment?.model && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                  {task.assignment.model}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Constants for select fields ──
// Roles and fallback profiles are fixed WrongStack semantics (not provider data),
// so they stay static. Providers and models are loaded live from the user's saved
// configuration via useProviderModels() — never hardcoded.
const KNOWN_ROLES = [
  'architect', 'developer', 'reviewer', 'tester', 'verifier',
  'security', 'documenter', 'external', 'leader', 'shadow', 'subagent',
] as const;

const KNOWN_FALLBACK_PROFILES = [
  'default', 'fast', 'cheap', 'quality', 'balanced', 'experimental',
] as const;

// Fixed capability vocabulary mirroring core's `ToolCapabilities` — a stable
// security enum (like roles), NOT provider data. Blank = the safe subagent
// default grant (WIDE_SUBAGENT_CAPABILITIES) applied server-side.
const KNOWN_CAPABILITIES: ChipOption[] = [
  { value: 'fs.read', label: 'Read files', description: 'fs.read' },
  { value: 'fs.write', label: 'Write files (in project)', description: 'fs.write' },
  { value: 'fs.write.outside-project', label: 'Write outside project', description: 'fs.write.outside-project' },
  { value: 'net.outbound', label: 'Outbound network', description: 'net.outbound' },
  { value: 'shell.exec', label: 'Run project commands', description: 'shell.exec' },
  { value: 'shell.restricted', label: 'Restricted shell', description: 'shell.restricted' },
  { value: 'shell.arbitrary', label: 'Arbitrary shell', description: 'shell.arbitrary' },
  { value: 'session.todo', label: 'Session todos', description: 'session.todo' },
  { value: 'tool.meta', label: 'Tool metadata', description: 'tool.meta' },
  { value: 'tool.mutate.any', label: 'Invoke any tool', description: 'tool.mutate.any' },
  { value: 'memory.read', label: 'Read memory', description: 'memory.read' },
  { value: 'memory.write', label: 'Write memory', description: 'memory.write' },
  { value: 'package.install', label: 'Install packages', description: 'package.install' },
  { value: 'subagent.spawn', label: 'Spawn subagents', description: 'subagent.spawn' },
  { value: 'config.mutate', label: 'Mutate config / trust', description: 'config.mutate' },
];

function TaskInspector({
  boards,
  board,
  task,
  runLink,
  onClose,
  sendKanban,
  sendRaw,
  refreshBoard,
}: {
  boards: Array<{ id: string; title: string }>;
  board: KanbanBoard | null;
  task: KanbanTask | null;
  runLink: RunLink | null;
  onClose: () => void;
  sendKanban: (type: `kanban.${string}`, payload?: Record<string, unknown>) => void;
  sendRaw: (type: string, payload?: Record<string, unknown>) => void;
  refreshBoard: (boardId?: string | null) => void;
}) {
  const [agentId, setAgentId] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [fallbackProfile, setFallbackProfile] = useState('');
  const [fallbackModels, setFallbackModels] = useState<string[]>([]);
  const [tools, setTools] = useState<string[]>([]);
  const [allowedCapabilities, setAllowedCapabilities] = useState<string[]>([]);
  const [targetBoardId, setTargetBoardId] = useState('');
  // Real provider/model catalogue — the user's saved providers and their live
  // model lists. Only fetches while a task is selected (the panel is open).
  const modelCandidates = useProviderModels(Boolean(task));
  // Real registered tools + the live session provider/model (the dispatch
  // fallback so nothing has to be typed by hand).
  const meta = useKanbanMeta(Boolean(task));
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Explicit pick wins; otherwise fall back to the current session's provider/model.
  const effectiveProvider = provider || meta.sessionProvider;
  const effectiveModel = model || meta.sessionModel;

  useEffect(() => {
    setAgentId(task?.assignment?.agentId ?? task?.assignedAgent ?? '');
    setName(task?.assignment?.name ?? '');
    setRole(task?.assignment?.role ?? '');
    setProvider(task?.assignment?.provider ?? '');
    setModel(task?.assignment?.model ?? '');
    setFallbackProfile(task?.assignment?.fallbackProfile ?? '');
    setFallbackModels(task?.assignment?.fallbackModels ?? []);
    setTools(task?.assignment?.tools ?? []);
    setAllowedCapabilities(task?.assignment?.allowedCapabilities ?? []);
    setTargetBoardId(boards.find((candidate) => candidate.id !== board?.id)?.id ?? '');
  }, [board?.id, boards, task]);

  const payload = () => ({
    boardId: board?.id,
    taskId: task?.id,
    ...(agentId.trim() ? { agentId: agentId.trim() } : {}),
    ...(name.trim() ? { name: name.trim() } : {}),
    ...(role.trim() ? { role: role.trim() } : {}),
    ...(effectiveProvider.trim() ? { provider: effectiveProvider.trim() } : {}),
    ...(effectiveModel.trim() ? { model: effectiveModel.trim() } : {}),
    ...(fallbackProfile.trim() ? { fallbackProfile: fallbackProfile.trim() } : {}),
    ...(fallbackModels.length > 0 ? { fallbackModels } : {}),
    ...(tools.length > 0 ? { tools } : {}),
    ...(allowedCapabilities.length > 0 ? { allowedCapabilities } : {}),
  });

  const assign = () => {
    if (!board || !task) return;
    sendKanban('kanban.task.assign', payload());
    window.setTimeout(() => refreshBoard(board.id), 150);
  };

  const dispatch = () => {
    if (!board || !task) return;
    sendKanban('kanban.task.dispatch', payload());
    window.setTimeout(() => refreshBoard(board.id), 200);
  };

  const copyTask = () => {
    if (!board || !task || !targetBoardId) return;
    sendKanban('kanban.task.copy', { boardId: board.id, taskId: task.id, targetBoardId });
  };

  const transferTask = () => {
    if (!board || !task || !targetBoardId) return;
    sendKanban('kanban.task.transfer', { boardId: board.id, taskId: task.id, targetBoardId });
  };

  return (
    <aside
      className={cn(
        'w-full shrink-0 flex-col border-t bg-card/40 md:w-[340px] md:border-l md:border-t-0',
        task ? 'flex max-h-[42dvh] md:max-h-none' : 'hidden md:flex',
      )}
    >
      <div className="flex h-12 items-center gap-2 border-b px-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{task ? 'Task' : 'Selection'}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {task?.id.slice(0, 8) ?? 'No task selected'}
          </div>
        </div>
        <button
          type="button"
          title="Close"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X size={16} />
        </button>
      </div>
      {task ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="text-sm font-semibold leading-5">{task.title}</div>
          {task.description && (
            <div className="mt-2 text-xs leading-5 text-muted-foreground">{task.description}</div>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <Metric label="Status" value={task.status} />
            <Metric label="Priority" value={task.priority} />
            <Metric label="Run" value={task.assignment?.status ?? 'unassigned'} />
            <Metric label="Column" value={columnTitle(board, task.columnId)} />
          </div>

          {task.assignment && <AgentRunPanel assignment={task.assignment} />}

          {runLink && task.origin?.taskId && (
            <RunTaskControls
              runLink={runLink}
              runTaskId={task.origin.taskId}
              modelCandidates={modelCandidates}
              sendRaw={sendRaw}
            />
          )}

          {!runLink && (
            <>
          <div className="mt-4 space-y-3">
            {/* Model — real provider/model; blank uses the live session model. */}
            <div>
              <div className="mb-1 flex items-center gap-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">Model</span>
                {!model && meta.sessionModel && (
                  <span className="truncate text-[10px] text-muted-foreground">
                    · session: {meta.sessionProvider ? `${meta.sessionProvider}/` : ''}
                    {meta.sessionModel}
                  </span>
                )}
              </div>
              <ModelPicker
                value={model || undefined}
                provider={provider || undefined}
                candidates={modelCandidates}
                placeholder={
                  meta.sessionModel
                    ? `Session: ${meta.sessionProvider ? `${meta.sessionProvider}/` : ''}${meta.sessionModel}`
                    : modelCandidates.length === 0
                      ? 'Loading providers…'
                      : 'Select provider / model…'
                }
                resetLabel="Use session model"
                onPick={(m, p) => {
                  setModel(m);
                  setProvider(p);
                }}
                onReset={
                  model || provider
                    ? () => {
                        setModel('');
                        setProvider('');
                      }
                    : undefined
                }
              />
            </div>

            {/* Fallback models — real multi-pick from the same live catalogue. */}
            <div>
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                Fallback models
              </span>
              <ChipMultiSelect
                options={modelCandidates.map((c) => ({
                  value: c.model,
                  label: c.label,
                  description: c.description,
                  tag: c.provider,
                }))}
                selected={fallbackModels}
                onChange={setFallbackModels}
                placeholder="Add fallback model…"
                emptyLabel="No models — add a provider in Settings"
              />
            </div>

            <SelectField
              label="Role"
              value={role}
              options={KNOWN_ROLES}
              placeholder="Select a role…"
              onChange={setRole}
            />
            <SelectField
              label="Fallback profile"
              value={fallbackProfile}
              options={KNOWN_FALLBACK_PROFILES}
              placeholder="None"
              onChange={setFallbackProfile}
            />

            {/* Tools — real registered tools from the running agent. */}
            <div>
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                Tools <span className="text-muted-foreground/70">· blank = full default toolset</span>
              </span>
              <ChipMultiSelect
                options={meta.tools.map((tool) => ({
                  value: tool.name,
                  label: tool.name,
                  description: tool.description,
                }))}
                selected={tools}
                onChange={setTools}
                placeholder="Restrict to specific tools…"
                emptyLabel="Tool list unavailable on this server"
              />
            </div>

            {/* Advanced — optional name override + capability grants. */}
            <div className="rounded-md border bg-background/60">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex w-full items-center justify-between px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
              >
                Advanced
                <ChevronDown
                  size={13}
                  className={cn('transition-transform', showAdvanced && 'rotate-180')}
                />
              </button>
              {showAdvanced && (
                <div className="space-y-3 border-t p-2">
                  <Field label="Agent name (optional)" value={name} onChange={setName} />
                  <div>
                    <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                      Capabilities{' '}
                      <span className="text-muted-foreground/70">· blank = safe defaults</span>
                    </span>
                    <ChipMultiSelect
                      options={KNOWN_CAPABILITIES}
                      selected={allowedCapabilities}
                      onChange={setAllowedCapabilities}
                      placeholder="Grant a capability…"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={assign}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border text-sm hover:bg-muted"
            >
              <UserPlus size={15} />
              Assign
            </button>
            <button
              type="button"
              onClick={dispatch}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary text-sm text-primary-foreground hover:bg-primary/90"
            >
              <Send size={15} />
              Dispatch
            </button>
          </div>
            </>
          )}

          {boards.length > 1 && !runLink ? (
            <div className="mt-4 space-y-2 rounded-md border bg-background p-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                  Target board
                </span>
                <select
                  value={targetBoardId}
                  onChange={(event) => setTargetBoardId(event.target.value)}
                  className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus:border-primary"
                >
                  {boards
                    .filter((candidate) => candidate.id !== board?.id)
                    .map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.title}
                      </option>
                    ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={copyTask}
                  disabled={!targetBoardId}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md border text-sm hover:bg-muted disabled:opacity-50"
                >
                  <Copy size={15} />
                  Copy
                </button>
                <button
                  type="button"
                  onClick={transferTask}
                  disabled={!targetBoardId}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md border text-sm hover:bg-muted disabled:opacity-50"
                >
                  <MoveRight size={15} />
                  Transfer
                </button>
              </div>
            </div>
          ) : null}

          {task.successCriteria?.length ? (
            <div className="mt-5">
              <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                Checks
              </div>
              <div className="space-y-1.5">
                {task.successCriteria.map((check) => (
                  <div
                    key={check.id}
                    className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-xs"
                  >
                    <Check
                      size={13}
                      className={
                        check.status === 'passed' ? 'text-success' : 'text-muted-foreground'
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">{check.description}</span>
                    <span className="text-muted-foreground">{check.status}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
          Select a task to edit assignment and dispatch settings.
        </div>
      )}
    </aside>
  );
}

function columnTitle(board: KanbanBoard | null, columnId: string): string {
  return board?.columns.find((c) => c.id === columnId)?.title ?? columnId;
}

// Colored badge classes per real KanbanAgentRunStatus.
const RUN_STATUS_STYLE: Record<string, string> = {
  assigned: 'bg-info/10 text-info',
  queued: 'bg-info/10 text-info',
  running: 'bg-warning/10 text-warning',
  completed: 'bg-success/10 text-success',
  failed: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
};

function fmtElapsed(fromIso?: string, toIso?: string): string | null {
  if (!fromIso) return null;
  const from = Date.parse(fromIso);
  if (Number.isNaN(from)) return null;
  const to = toIso ? Date.parse(toIso) : Date.now();
  if (Number.isNaN(to)) return null;
  const secs = Math.max(0, Math.round((to - from) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

/**
 * AgentRunPanel — the *real* runtime of the agent working this task, straight
 * from `task.assignment`. Not a hardcoded placeholder: run status, the actual
 * spawned subagent id, dispatch/finish timing, retry attempts, cost ceiling,
 * the last result and any error.
 */
function AgentRunPanel({ assignment }: { assignment: NonNullable<KanbanTask['assignment']> }) {
  const running = assignment.status === 'running';
  const elapsed = fmtElapsed(assignment.dispatchedAt, assignment.completedAt);
  const rows: Array<{ label: string; value: React.ReactNode }> = [];
  if (assignment.name || assignment.agentId) {
    rows.push({ label: 'Agent', value: assignment.name ?? assignment.agentId });
  }
  if (assignment.role) rows.push({ label: 'Role', value: assignment.role });
  if (assignment.provider || assignment.model) {
    rows.push({
      label: 'Model',
      value: (
        <span className="font-mono text-[11px]">
          {assignment.provider ? `${assignment.provider}/` : ''}
          {assignment.model ?? '—'}
        </span>
      ),
    });
  }
  if (assignment.subagentId) {
    rows.push({
      label: 'Subagent',
      value: <span className="font-mono text-[11px]">{assignment.subagentId}</span>,
    });
  }
  if (elapsed) {
    rows.push({ label: assignment.completedAt ? 'Duration' : 'Elapsed', value: elapsed });
  }
  if (typeof assignment.attempt === 'number') {
    rows.push({
      label: 'Attempt',
      value: `${assignment.attempt}${assignment.maxAttempts ? ` / ${assignment.maxAttempts}` : ''}`,
    });
  }
  if (assignment.costCeilingUsd) {
    rows.push({ label: 'Cost ceiling', value: `$${assignment.costCeilingUsd.toFixed(2)}` });
  }

  return (
    <div className="mt-4 rounded-md border bg-background p-2.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Live run
        </span>
        <span
          className={cn(
            'ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium capitalize',
            RUN_STATUS_STYLE[assignment.status] ?? 'bg-muted text-muted-foreground',
          )}
        >
          {running && (
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden />
          )}
          {assignment.status}
        </span>
      </div>
      {rows.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {rows.map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 truncate text-right text-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {assignment.lastResult && (
        <div className="mt-2">
          <div className="mb-1 text-[10px] uppercase text-muted-foreground">Last result</div>
          <div className="max-h-24 overflow-y-auto whitespace-pre-wrap rounded bg-muted px-2 py-1 text-[11px] leading-relaxed text-foreground">
            {assignment.lastResult}
          </div>
        </div>
      )}
      {assignment.error && (
        <div className="mt-2 rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
          {assignment.error}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background px-2 py-1.5">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-xs font-medium">{value}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus:border-primary"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus:border-primary"
      >
        {placeholder && (
          <option value="">{placeholder}</option>
        )}
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </label>
  );
}

function priorityClass(priority: KanbanTask['priority']): string {
  const base = 'rounded px-1.5 py-0.5';
  if (priority === 'critical') return `${base} bg-destructive/10 text-destructive`;
  if (priority === 'high') return `${base} bg-warning/10 text-warning`;
  if (priority === 'low') return `${base} bg-muted text-muted-foreground`;
  return `${base} bg-info/10 text-info`;
}
