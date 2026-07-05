import type { KanbanBoard, KanbanBoardSummary, KanbanColumn, KanbanTask } from '@wrongstack/core';
import { create } from 'zustand';

export interface KanbanResultPayload {
  success: boolean;
  data?: unknown;
  error?: string | undefined;
}

interface KanbanState {
  boards: KanbanBoardSummary[];
  activeBoardId: string | null;
  activeBoard: KanbanBoard | null;
  loading: boolean;
  error: string | null;
  setLoading: (loading: boolean) => void;
  setActiveBoardId: (id: string | null) => void;
  setError: (error: string | null) => void;
  handleResult: (type: string, payload: KanbanResultPayload) => void;
}

export const useKanbanStore = create<KanbanState>()((set, get) => ({
  boards: [],
  activeBoardId: null,
  activeBoard: null,
  loading: false,
  error: null,
  setLoading: (loading) => set({ loading }),
  setActiveBoardId: (id) => set({ activeBoardId: id }),
  setError: (error) => set({ error }),
  handleResult: (type, payload) => {
    if (!payload.success) {
      set({ loading: false, error: payload.error ?? 'Kanban request failed' });
      return;
    }
    const data = payload.data;
    if (type === 'kanban.list') {
      set({
        boards: Array.isArray(data) ? (data as KanbanBoardSummary[]) : [],
        loading: false,
        error: null,
      });
      return;
    }
    if (type === 'kanban.delete') {
      const activeBoardId = get().activeBoardId;
      const removed = (data as { removed?: boolean } | null)?.removed === true;
      set((state) => ({
        boards: removed ? state.boards.filter((board) => board.id !== activeBoardId) : state.boards,
        activeBoardId: removed ? null : state.activeBoardId,
        activeBoard: removed ? null : state.activeBoard,
        loading: false,
        error: null,
      }));
      return;
    }
    if (isBoard(data)) {
      const summary = summarize(data);
      set((state) => ({
        boards: upsertSummary(state.boards, summary),
        activeBoardId: data.id,
        activeBoard: data,
        loading: false,
        error: null,
      }));
      return;
    }
    if (isTask(data)) {
      set((state) => ({
        activeBoard: state.activeBoard ? upsertTask(state.activeBoard, data) : state.activeBoard,
        loading: false,
        error: null,
      }));
      return;
    }
    if (Array.isArray(data) && data.every(isColumn)) {
      set((state) => ({
        activeBoard: state.activeBoard
          ? { ...state.activeBoard, columns: data }
          : state.activeBoard,
        loading: false,
        error: null,
      }));
      return;
    }
    if (type === 'kanban.task.remove') {
      set((state) => ({
        activeBoard: state.activeBoard
          ? {
              ...state.activeBoard,
              tasks: state.activeBoard.tasks.filter(
                (task) => task.id !== ((data as { taskId?: string } | null)?.taskId ?? ''),
              ),
            }
          : state.activeBoard,
        loading: false,
        error: null,
      }));
      return;
    }
    set({ loading: false, error: null });
  },
}));

function isBoard(value: unknown): value is KanbanBoard {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    Array.isArray((value as KanbanBoard).columns) &&
    Array.isArray((value as KanbanBoard).tasks)
  );
}

function isTask(value: unknown): value is KanbanTask {
  return (
    Boolean(value) && typeof value === 'object' && typeof (value as KanbanTask).title === 'string'
  );
}

function isColumn(value: unknown): value is KanbanColumn {
  return (
    Boolean(value) && typeof value === 'object' && typeof (value as KanbanColumn).id === 'string'
  );
}

function summarize(board: KanbanBoard): KanbanBoardSummary {
  return {
    id: board.id,
    title: board.title,
    description: board.description,
    tags: board.tags,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
    columnCount: board.columns.length,
    taskCount: board.tasks.length,
    completedTaskCount: board.tasks.filter((task) => task.status === 'completed').length,
  };
}

function upsertSummary(
  boards: KanbanBoardSummary[],
  summary: KanbanBoardSummary,
): KanbanBoardSummary[] {
  const next = boards.filter((board) => board.id !== summary.id);
  return [summary, ...next].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function upsertTask(board: KanbanBoard, task: KanbanTask): KanbanBoard {
  const tasks = board.tasks.some((candidate) => candidate.id === task.id)
    ? board.tasks.map((candidate) => (candidate.id === task.id ? task : candidate))
    : [...board.tasks, task];
  return { ...board, tasks };
}
