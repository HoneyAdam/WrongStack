import {
  addColumn,
  addTask,
  assignTask,
  copyTaskToBoard,
  createBoard,
  duplicateBoard,
  generateBoardFromDescription,
  getBoard,
  getTask,
  type KanbanColumn,
  type KanbanTask,
  type KanbanTaskPriority,
  type KanbanTaskStatus,
  listBoards,
  moveTask,
  parseLinesIntoTasks,
  removeBoard,
  removeColumn,
  removeTask,
  transferTaskToBoard,
  updateBoard,
  updateTask,
} from '@wrongstack/core';
import type { WebSocket } from 'ws';
import type { WSClientMessage } from './types.js';
import { send } from './ws-utils.js';

export interface KanbanRouteContext {
  projectRoot: string;
}

function ok(ws: WebSocket, type: string, data?: unknown): void {
  send(ws, { type, payload: { success: true, data: data ?? null } });
}

function fail(ws: WebSocket, type: string, message: string): void {
  send(ws, { type, payload: { success: false, error: message } });
}

export async function handleKanbanRoute(
  ws: WebSocket,
  msg: WSClientMessage,
  ctx: KanbanRouteContext,
): Promise<boolean> {
  if (!msg.type.startsWith('kanban.')) return false;
  const payload = msg.payload as Record<string, unknown> | undefined;
  const type = msg.type;

  try {
    switch (type) {
      case 'kanban.list':
        ok(ws, type, await listBoards(ctx.projectRoot));
        return true;
      case 'kanban.get': {
        const boardId = payload?.boardId as string | undefined;
        if (!boardId) {
          fail(ws, type, 'boardId required');
          return true;
        }
        const board = await getBoard(ctx.projectRoot, boardId);
        board ? ok(ws, type, board) : fail(ws, type, `Board not found: ${boardId}`);
        return true;
      }
      case 'kanban.create': {
        const title = payload?.title as string | undefined;
        if (!title) {
          fail(ws, type, 'title required');
          return true;
        }
        ok(
          ws,
          type,
          await createBoard(ctx.projectRoot, {
            title,
            ...(payload?.description ? { description: payload.description as string } : {}),
            ...(payload?.tags ? { tags: payload.tags as string[] } : {}),
            ...(payload?.columns ? { columns: payload.columns as KanbanColumn[] } : {}),
          }),
        );
        return true;
      }
      case 'kanban.update': {
        const boardId = payload?.boardId as string | undefined;
        if (!boardId) {
          fail(ws, type, 'boardId required');
          return true;
        }
        const board = await updateBoard(ctx.projectRoot, boardId, {
          ...(payload?.title ? { title: payload.title as string } : {}),
          ...(payload?.description ? { description: payload.description as string } : {}),
          ...(payload?.tags ? { tags: payload.tags as string[] } : {}),
          ...(payload?.columns ? { columns: payload.columns as KanbanColumn[] } : {}),
        });
        board ? ok(ws, type, board) : fail(ws, type, `Board not found: ${boardId}`);
        return true;
      }
      case 'kanban.duplicate': {
        const boardId = payload?.boardId as string | undefined;
        if (!boardId) {
          fail(ws, type, 'boardId required');
          return true;
        }
        const board = await duplicateBoard(ctx.projectRoot, boardId, {
          ...(payload?.title ? { title: payload.title as string } : {}),
          ...(typeof payload?.includeTasks === 'boolean'
            ? { includeTasks: payload.includeTasks }
            : {}),
          ...(typeof payload?.includeCompletedTasks === 'boolean'
            ? { includeCompletedTasks: payload.includeCompletedTasks }
            : {}),
          ...(typeof payload?.preserveAssignment === 'boolean'
            ? { preserveAssignment: payload.preserveAssignment }
            : {}),
        });
        board ? ok(ws, type, board) : fail(ws, type, `Board not found: ${boardId}`);
        return true;
      }
      case 'kanban.delete': {
        const boardId = payload?.boardId as string | undefined;
        if (!boardId) {
          fail(ws, type, 'boardId required');
          return true;
        }
        ok(ws, type, { removed: await removeBoard(ctx.projectRoot, boardId) });
        return true;
      }
      case 'kanban.generate': {
        const description = payload?.description as string | undefined;
        if (!description) {
          fail(ws, type, 'description required');
          return true;
        }
        const board = await createBoard(
          ctx.projectRoot,
          generateBoardFromDescription({
            description,
            ...(payload?.title ? { title: payload.title as string } : {}),
            ...(payload?.context ? { context: payload.context as string } : {}),
          }),
        );
        for (const taskInput of parseLinesIntoTasks(
          description,
          board.columns[0]?.id ?? 'backlog',
        )) {
          await addTask(ctx.projectRoot, board.id, taskInput);
        }
        ok(ws, type, (await getBoard(ctx.projectRoot, board.id)) ?? board);
        return true;
      }
      case 'kanban.task.add': {
        const boardId = payload?.boardId as string | undefined;
        const title = payload?.title as string | undefined;
        if (!boardId || !title) {
          fail(ws, type, 'boardId and title required');
          return true;
        }
        const result = await addTask(ctx.projectRoot, boardId, {
          title,
          columnId: (payload?.columnId as string | undefined) ?? 'backlog',
          ...(payload?.description ? { description: payload.description as string } : {}),
          ...(payload?.priority ? { priority: payload.priority as KanbanTaskPriority } : {}),
          ...(payload?.assignedAgent ? { assignedAgent: payload.assignedAgent as string } : {}),
          ...(payload?.labels ? { labels: payload.labels as string[] } : {}),
        });
        result ? ok(ws, type, result.task) : fail(ws, type, `Board not found: ${boardId}`);
        return true;
      }
      case 'kanban.task.update': {
        const boardId = payload?.boardId as string | undefined;
        const taskId = payload?.taskId as string | undefined;
        if (!boardId || !taskId) {
          fail(ws, type, 'boardId and taskId required');
          return true;
        }
        const board = await updateTask(ctx.projectRoot, boardId, taskId, {
          ...(payload?.title ? { title: payload.title as string } : {}),
          ...(payload?.description ? { description: payload.description as string } : {}),
          ...(payload?.columnId ? { columnId: payload.columnId as string } : {}),
          ...(payload?.priority ? { priority: payload.priority as KanbanTaskPriority } : {}),
          ...(payload?.status ? { status: payload.status as KanbanTaskStatus } : {}),
          ...(payload?.assignedAgent ? { assignedAgent: payload.assignedAgent as string } : {}),
          ...(payload?.labels ? { labels: payload.labels as string[] } : {}),
        });
        board
          ? ok(ws, type, findTask(board.tasks, taskId))
          : fail(ws, type, 'Board or task not found');
        return true;
      }
      case 'kanban.task.move': {
        const boardId = payload?.boardId as string | undefined;
        const taskId = payload?.taskId as string | undefined;
        const columnId = payload?.columnId as string | undefined;
        if (!boardId || !taskId || !columnId) {
          fail(ws, type, 'boardId, taskId, columnId required');
          return true;
        }
        const board = await moveTask(
          ctx.projectRoot,
          boardId,
          taskId,
          columnId,
          payload?.order as number | undefined,
        );
        board ? ok(ws, type, findTask(board.tasks, taskId)) : fail(ws, type, 'Move failed');
        return true;
      }
      case 'kanban.task.copy':
      case 'kanban.task.transfer': {
        const boardId = payload?.boardId as string | undefined;
        const taskId = payload?.taskId as string | undefined;
        const targetBoardId = payload?.targetBoardId as string | undefined;
        if (!boardId || !taskId || !targetBoardId) {
          fail(ws, type, 'boardId, taskId, targetBoardId required');
          return true;
        }
        const result =
          type === 'kanban.task.copy'
            ? await copyTaskToBoard(ctx.projectRoot, boardId, taskId, targetBoardId, {
                ...(payload?.targetColumnId
                  ? { targetColumnId: payload.targetColumnId as string }
                  : {}),
                ...(typeof payload?.preserveAssignment === 'boolean'
                  ? { preserveAssignment: payload.preserveAssignment }
                  : {}),
                ...(typeof payload?.preserveDependencies === 'boolean'
                  ? { preserveDependencies: payload.preserveDependencies }
                  : {}),
              })
            : await transferTaskToBoard(ctx.projectRoot, boardId, taskId, targetBoardId, {
                ...(payload?.targetColumnId
                  ? { targetColumnId: payload.targetColumnId as string }
                  : {}),
                ...(typeof payload?.preserveAssignment === 'boolean'
                  ? { preserveAssignment: payload.preserveAssignment }
                  : {}),
                ...(typeof payload?.preserveDependencies === 'boolean'
                  ? { preserveDependencies: payload.preserveDependencies }
                  : {}),
              });
        result ? ok(ws, type, result.targetBoard) : fail(ws, type, 'Board or task not found');
        return true;
      }
      case 'kanban.task.assign': {
        const boardId = payload?.boardId as string | undefined;
        const taskId = payload?.taskId as string | undefined;
        if (!boardId || !taskId) {
          fail(ws, type, 'boardId and taskId required');
          return true;
        }
        const board = await assignTask(ctx.projectRoot, boardId, taskId, {
          ...(payload?.agentId ? { agentId: payload.agentId as string } : {}),
          ...(payload?.name ? { name: payload.name as string } : {}),
          ...(payload?.role ? { role: payload.role as string } : {}),
          ...(payload?.provider ? { provider: payload.provider as string } : {}),
          ...(payload?.model ? { model: payload.model as string } : {}),
          ...(payload?.fallbackProfile
            ? { fallbackProfile: payload.fallbackProfile as string }
            : {}),
          ...(payload?.fallbackModels
            ? { fallbackModels: payload.fallbackModels as string[] }
            : {}),
          ...(payload?.tools ? { tools: payload.tools as string[] } : {}),
          ...(payload?.allowedCapabilities
            ? { allowedCapabilities: payload.allowedCapabilities as string[] }
            : {}),
        });
        board
          ? ok(ws, type, findTask(board.tasks, taskId))
          : fail(ws, type, 'Board or task not found');
        return true;
      }
      case 'kanban.task.dispatch':
        fail(
          ws,
          type,
          'Kanban agent dispatch is only available from the CLI-hosted WebUI runtime.',
        );
        return true;
      case 'kanban.task.remove': {
        const boardId = payload?.boardId as string | undefined;
        const taskId = payload?.taskId as string | undefined;
        if (!boardId || !taskId) {
          fail(ws, type, 'boardId and taskId required');
          return true;
        }
        const board = await removeTask(ctx.projectRoot, boardId, taskId);
        board ? ok(ws, type, { removed: true }) : fail(ws, type, 'Board or task not found');
        return true;
      }
      case 'kanban.task.get': {
        const boardId = payload?.boardId as string | undefined;
        const taskId = payload?.taskId as string | undefined;
        if (!boardId || !taskId) {
          fail(ws, type, 'boardId and taskId required');
          return true;
        }
        const task = await getTask(ctx.projectRoot, boardId, taskId);
        task ? ok(ws, type, task) : fail(ws, type, 'Task not found');
        return true;
      }
      case 'kanban.column.add': {
        const boardId = payload?.boardId as string | undefined;
        const title = payload?.title as string | undefined;
        if (!boardId || !title) {
          fail(ws, type, 'boardId and title required');
          return true;
        }
        const result = await addColumn(ctx.projectRoot, boardId, { title });
        result ? ok(ws, type, result.board.columns) : fail(ws, type, `Board not found: ${boardId}`);
        return true;
      }
      case 'kanban.column.remove': {
        const boardId = payload?.boardId as string | undefined;
        const columnId = payload?.columnId as string | undefined;
        if (!boardId || !columnId) {
          fail(ws, type, 'boardId and columnId required');
          return true;
        }
        const board = await removeColumn(ctx.projectRoot, boardId, columnId, {
          moveTasksToColumnId: payload?.moveTasksToColumnId as string | undefined,
        });
        board ? ok(ws, type, { removed: true }) : fail(ws, type, `Column not found: ${columnId}`);
        return true;
      }
      default:
        fail(ws, type, `Unknown kanban message type: ${type}`);
        return true;
    }
  } catch (err) {
    fail(ws, type, err instanceof Error ? err.message : String(err));
    return true;
  }
}

function findTask(tasks: KanbanTask[], taskId: string): KanbanTask | undefined {
  return tasks.find((task) => task.id === taskId || task.id.startsWith(taskId));
}
