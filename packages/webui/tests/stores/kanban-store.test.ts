import type { KanbanBoard, KanbanTask } from '@wrongstack/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { useKanbanStore } from '../../src/stores/kanban-store.js';

const now = '2026-07-06T00:00:00.000Z';

function task(id: string, title: string, columnId = 'backlog'): KanbanTask {
  return {
    id,
    title,
    columnId,
    order: 0,
    priority: 'medium',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
}

function board(id: string, tasks: KanbanTask[] = []): KanbanBoard {
  return {
    id,
    title: `Board ${id}`,
    columns: [{ id: 'backlog', title: 'Backlog', order: 0 }],
    tasks,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

describe('kanban-store', () => {
  beforeEach(() => {
    useKanbanStore.setState({
      boards: [],
      activeBoardId: null,
      activeBoard: null,
      loading: false,
      error: null,
    });
  });

  it('updates active board summaries when task results arrive', () => {
    const active = board('b1');
    useKanbanStore.setState({
      boards: [
        {
          id: active.id,
          title: active.title,
          createdAt: active.createdAt,
          updatedAt: active.updatedAt,
          columnCount: 1,
          taskCount: 0,
          completedTaskCount: 0,
        },
      ],
      activeBoardId: active.id,
      activeBoard: active,
    });

    useKanbanStore.getState().handleResult('kanban.task.add', {
      success: true,
      data: task('t1', 'New task'),
    });

    const state = useKanbanStore.getState();
    expect(state.activeBoard?.tasks.map((item) => item.title)).toEqual(['New task']);
    expect(state.boards[0]?.taskCount).toBe(1);
  });

  it('removes the requested board instead of whichever board is currently active', () => {
    const first = board('b1');
    const second = board('b2');
    useKanbanStore.getState().handleResult('kanban.list', {
      success: true,
      data: [first, second].map((item) => ({
        id: item.id,
        title: item.title,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        columnCount: 1,
        taskCount: item.tasks.length,
        completedTaskCount: 0,
      })),
    });
    useKanbanStore.setState({ activeBoardId: second.id, activeBoard: second });

    useKanbanStore.getState().handleResult('kanban.delete', {
      success: true,
      data: { removed: true, boardId: first.id },
    });

    const state = useKanbanStore.getState();
    expect(state.boards.map((item) => item.id)).toEqual([second.id]);
    expect(state.activeBoardId).toBe(second.id);
    expect(state.activeBoard?.id).toBe(second.id);
  });

  it('applies task removal payloads with full board data', () => {
    const active = board('b1', [task('t1', 'Remove me')]);
    const afterRemoval = board('b1', []);
    useKanbanStore.setState({
      boards: [
        {
          id: active.id,
          title: active.title,
          createdAt: active.createdAt,
          updatedAt: active.updatedAt,
          columnCount: 1,
          taskCount: 1,
          completedTaskCount: 0,
        },
      ],
      activeBoardId: active.id,
      activeBoard: active,
    });

    useKanbanStore.getState().handleResult('kanban.task.remove', {
      success: true,
      data: { removed: true, boardId: active.id, taskId: 't1', board: afterRemoval },
    });

    const state = useKanbanStore.getState();
    expect(state.activeBoard?.tasks).toEqual([]);
    expect(state.boards[0]?.taskCount).toBe(0);
  });

  it('ignores task envelopes for a different active board', () => {
    const active = board('b1');
    useKanbanStore.setState({ activeBoardId: active.id, activeBoard: active });

    useKanbanStore.getState().handleResult('kanban.task.update', {
      success: true,
      data: { boardId: 'b2', task: task('t2', 'Other board task') },
    });

    expect(useKanbanStore.getState().activeBoard?.tasks).toEqual([]);
  });

  it('updates board envelope summaries without switching the active board', () => {
    const active = board('b1');
    const other = board('b2', [task('t2', 'Other board task')]);
    useKanbanStore.setState({
      boards: [
        {
          id: active.id,
          title: active.title,
          createdAt: active.createdAt,
          updatedAt: active.updatedAt,
          columnCount: 1,
          taskCount: 0,
          completedTaskCount: 0,
        },
      ],
      activeBoardId: active.id,
      activeBoard: active,
    });

    useKanbanStore.getState().handleResult('kanban.task.merge', {
      success: true,
      data: { board: other, task: other.tasks[0] },
    });

    const state = useKanbanStore.getState();
    expect(state.activeBoard?.id).toBe(active.id);
    expect(state.boards.find((item) => item.id === other.id)?.taskCount).toBe(1);
  });
});
