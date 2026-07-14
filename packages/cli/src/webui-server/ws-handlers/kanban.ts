/**
 * WebSocket handler for kanban board operations.
 *
 * Message types:
 *   kanban.list         → list all boards
 *   kanban.get          → get a board by ID (full detail)
 *   kanban.create       → create a new board
 *   kanban.update       → update board metadata
 *   kanban.delete       → delete a board
 *   kanban.task.add     → add a task
 *   kanban.task.update  → update a task
 *   kanban.task.move    → move a task to a different column
 *   kanban.task.remove  → delete a task
 *   kanban.task.get     → get a single task
 *   kanban.column.add   → add a column
 *   kanban.column.remove→ remove a column
 *   kanban.generate     → auto-generate a board
 */

import {
  deserializeTaskGraph,
  type SerializableTaskGraph,
  serializeTaskGraph,
} from '@wrongstack/core';
import {
  addColumn,
  addGoalMetricToTask,
  addTask,
  assignTask,
  claimReadyTask,
  copyTaskToBoard,
  createBoard,
  duplicateBoard,
  exportBoardToTaskGraph,
  generateBoardFromDescription,
  getBoard,
  getKanbanOrchestrationSnapshot,
  getTask,
  getTaskChain,
  type KanbanColumn,
  type KanbanTask,
  type KanbanTaskPriority,
  type KanbanTaskStatus,
  listReadyTasks,
  listBoards,
  mergeTasks,
  moveTask,
  parseLinesIntoTasks,
  removeBoard,
  removeColumn,
  removeTask,
  releaseTaskClaim,
  setTaskChain,
  splitTask,
  syncBoardFromTaskGraph,
  transferTaskToBoard,
  updateBoard as updateBoardManager,
  updateGoalMetricOnTask,
  updateTask,
  updateTaskAssignment,
} from '@wrongstack/kanban';
import type { WebSocket } from 'ws';
import type { WsCommon } from './index.js';

export interface KanbanContext extends WsCommon {
  projectRoot: string;
  dispatchTask?: (
    description: string,
    opts?: {
      provider?: string | undefined;
      model?: string | undefined;
      fallbackModels?: string[] | undefined;
      tools?: string[] | undefined;
      name?: string | undefined;
      allowedCapabilities?: readonly string[] | undefined;
      onDone?:
        | ((result: {
            status: 'completed' | 'failed';
            result?: string | undefined;
            error?: string | undefined;
          }) => void | Promise<void>)
        | undefined;
    },
  ) => Promise<string>;
}

function send(ctx: KanbanContext, ws: WebSocket, type: string, payload: unknown): void {
  ctx.send(ws, { type, payload });
}

function ok(ctx: KanbanContext, ws: WebSocket, type: string, data?: unknown): void {
  send(ctx, ws, type, { success: true, data: data ?? null });
}

function fail(ctx: KanbanContext, ws: WebSocket, type: string, message: string): void {
  send(ctx, ws, type, { success: false, error: message });
}

// ── Route handler ───────────────────────────────────────────────────────

export async function handleKanbanMessage(
  ctx: KanbanContext,
  ws: WebSocket,
  msg: { type: string; payload?: unknown },
): Promise<void> {
  const { projectRoot } = ctx;
  if (!projectRoot) {
    fail(ctx, ws, msg.type, 'No project root');
    return;
  }

  const payload = msg.payload as Record<string, unknown> | undefined;
  const type = msg.type;

  try {
    switch (type) {
      // ── Board list ──
      case 'kanban.list': {
        const boards = await listBoards(projectRoot);
        ok(ctx, ws, 'kanban.list', boards);
        return;
      }

      // ── Board get ──
      case 'kanban.get': {
        const id = payload?.boardId as string | undefined;
        if (!id) {
          fail(ctx, ws, type, 'boardId required');
          return;
        }
        const board = await getBoard(projectRoot, id);
        if (!board) {
          fail(ctx, ws, type, `Board not found: ${id}`);
          return;
        }
        ok(ctx, ws, 'kanban.get', board);
        return;
      }

      // ── Board create ──
      case 'kanban.create': {
        const title = payload?.title as string | undefined;
        if (!title) {
          fail(ctx, ws, type, 'title required');
          return;
        }
        const board = await createBoard(projectRoot, {
          title,
          ...(payload?.description ? { description: payload.description as string } : {}),
          ...(payload?.tags ? { tags: payload.tags as string[] } : {}),
          ...(payload?.columns ? { columns: payload.columns as KanbanColumn[] } : {}),
        });
        ok(ctx, ws, 'kanban.create', board);
        return;
      }

      // ── Board update ──
      case 'kanban.update': {
        const id = payload?.boardId as string | undefined;
        if (!id) {
          fail(ctx, ws, type, 'boardId required');
          return;
        }
        const board = await updateBoardManager(projectRoot, id, {
          ...(payload?.title ? { title: payload.title as string } : {}),
          ...(payload?.description ? { description: payload.description as string } : {}),
          ...(payload?.tags ? { tags: payload.tags as string[] } : {}),
          ...(payload?.columns ? { columns: payload.columns as KanbanColumn[] } : {}),
        });
        if (!board) {
          fail(ctx, ws, type, `Board not found: ${id}`);
          return;
        }
        ok(ctx, ws, 'kanban.update', board);
        return;
      }

      // ── Board duplicate ──
      case 'kanban.duplicate': {
        const id = payload?.boardId as string | undefined;
        if (!id) {
          fail(ctx, ws, type, 'boardId required');
          return;
        }
        const board = await duplicateBoard(projectRoot, id, {
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
        if (!board) {
          fail(ctx, ws, type, `Board not found: ${id}`);
          return;
        }
        ok(ctx, ws, 'kanban.duplicate', board);
        return;
      }

      // ── Board delete ──
      case 'kanban.delete': {
        const id = payload?.boardId as string | undefined;
        if (!id) {
          fail(ctx, ws, type, 'boardId required');
          return;
        }
        const board = await getBoard(projectRoot, id);
        const removed = board ? await removeBoard(projectRoot, board.id) : false;
        ok(ctx, ws, 'kanban.delete', { removed, boardId: board?.id ?? id });
        return;
      }

      // ── Board generate ──
      case 'kanban.generate': {
        const description = payload?.description as string | undefined;
        if (!description) {
          fail(ctx, ws, type, 'description required');
          return;
        }
        const genInput = generateBoardFromDescription({
          description,
          ...(payload?.title ? { title: payload.title as string } : {}),
          ...(payload?.context ? { context: payload.context as string } : {}),
        });
        const board = await createBoard(projectRoot, genInput);
        // Add initial tasks from parsed lines
        const tasks = parseLinesIntoTasks(description, board.columns[0]?.id ?? 'backlog');
        for (const taskInput of tasks) {
          await addTask(projectRoot, board.id, taskInput);
        }
        // Reload to get fresh state
        const fresh = await getBoard(projectRoot, board.id);
        ok(ctx, ws, 'kanban.generate', fresh ?? board);
        return;
      }

      // ── Ready tasks ──
      case 'kanban.task.ready': {
        const tasks = await listReadyTasks(projectRoot, {
          ...(payload?.boardId ? { boardId: payload.boardId as string } : {}),
          ...(payload?.query ? { query: payload.query as string } : {}),
          ...(payload?.assignedAgent ? { assignedAgent: payload.assignedAgent as string } : {}),
          ...(payload?.priority ? { priority: payload.priority as KanbanTaskPriority } : {}),
          ...(payload?.label ? { label: payload.label as string } : {}),
          ...(payload?.chainId ? { chainId: payload.chainId as string } : {}),
          ...(typeof payload?.limit === 'number' ? { limit: payload.limit } : {}),
        });
        ok(ctx, ws, type, tasks);
        return;
      }

      case 'kanban.snapshot': {
        const snapshot = await getKanbanOrchestrationSnapshot(projectRoot, {
          ...(payload?.boardId ? { boardId: payload.boardId as string } : {}),
          ...(payload?.query ? { query: payload.query as string } : {}),
          ...(payload?.assignedAgent ? { assignedAgent: payload.assignedAgent as string } : {}),
          ...(payload?.priority ? { priority: payload.priority as KanbanTaskPriority } : {}),
          ...(payload?.status ? { status: payload.status as KanbanTaskStatus } : {}),
          ...(payload?.label ? { label: payload.label as string } : {}),
          ...(payload?.chainId ? { chainId: payload.chainId as string } : {}),
        });
        ok(ctx, ws, type, snapshot);
        return;
      }

      case 'kanban.taskgraph.export': {
        const boardId = payload?.boardId as string | undefined;
        if (!boardId) {
          fail(ctx, ws, type, 'boardId required');
          return;
        }
        const exported = await exportBoardToTaskGraph(projectRoot, boardId, {
          ...(payload?.graphId ? { graphId: payload.graphId as string } : {}),
          ...(payload?.specId ? { specId: payload.specId as string } : {}),
          ...(payload?.title ? { title: payload.title as string } : {}),
          ...(typeof payload?.preserveOriginTaskIds === 'boolean'
            ? { preserveOriginTaskIds: payload.preserveOriginTaskIds }
            : {}),
          ...(typeof payload?.includeArchived === 'boolean'
            ? { includeArchived: payload.includeArchived }
            : {}),
        });
        if (!exported) {
          fail(ctx, ws, type, `Board not found: ${boardId}`);
          return;
        }
        ok(ctx, ws, type, {
          board: exported.board,
          taskGraph: serializeTaskGraph(exported.graph),
        });
        return;
      }

      case 'kanban.taskgraph.sync': {
        const boardId = payload?.boardId as string | undefined;
        const taskGraph = payload?.taskGraph as SerializableTaskGraph | undefined;
        if (!boardId || !taskGraph) {
          fail(ctx, ws, type, 'boardId and taskGraph required');
          return;
        }
        const result = await syncBoardFromTaskGraph(
          projectRoot,
          boardId,
          deserializeTaskGraph(taskGraph),
          {
            ...(payload?.title ? { title: payload.title as string } : {}),
            ...(payload?.description ? { description: payload.description as string } : {}),
            ...(payload?.tags ? { tags: payload.tags as string[] } : {}),
            ...(payload?.generatedBy ? { generatedBy: payload.generatedBy as string } : {}),
            ...(payload?.sourceSystem ? { sourceSystem: payload.sourceSystem as string } : {}),
            ...(payload?.phaseId ? { phaseId: payload.phaseId as string } : {}),
            ...(typeof payload?.includeCompletedTasks === 'boolean'
              ? { includeCompletedTasks: payload.includeCompletedTasks }
              : {}),
            ...(typeof payload?.archiveMissingTasks === 'boolean'
              ? { archiveMissingTasks: payload.archiveMissingTasks }
              : {}),
            ...(typeof payload?.preserveManualDependencies === 'boolean'
              ? { preserveManualDependencies: payload.preserveManualDependencies }
              : {}),
          },
        );
        result
          ? ok(ctx, ws, type, {
              board: result.board,
              taskIdMap: Object.fromEntries(result.taskIdMap),
              createdTaskIds: result.createdTaskIds,
              updatedTaskIds: result.updatedTaskIds,
              archivedTaskIds: result.archivedTaskIds,
            })
          : fail(ctx, ws, type, `Board not found: ${boardId}`);
        return;
      }

      // ── Task add ──
      case 'kanban.task.add': {
        const boardId = payload?.boardId as string | undefined;
        const title = payload?.title as string | undefined;
        if (!boardId || !title) {
          fail(ctx, ws, type, 'boardId and title required');
          return;
        }
        const result = await addTask(projectRoot, boardId, {
          title,
          columnId: (payload?.columnId as string) ?? 'backlog',
          ...(payload?.description ? { description: payload.description as string } : {}),
          ...(payload?.priority ? { priority: payload.priority as KanbanTaskPriority } : {}),
          ...(payload?.assignedAgent ? { assignedAgent: payload.assignedAgent as string } : {}),
          ...(payload?.dependsOn ? { dependsOn: payload.dependsOn as string[] } : {}),
          ...(payload?.labels ? { labels: payload.labels as string[] } : {}),
        });
        if (!result) {
          fail(ctx, ws, type, `Board not found: ${boardId}`);
          return;
        }
        ok(ctx, ws, 'kanban.task.add', result.task);
        return;
      }

      // ── Task split ──
      case 'kanban.task.split': {
        const boardId = payload?.boardId as string | undefined;
        const taskId = payload?.taskId as string | undefined;
        const childTitles = payload?.childTitles as string[] | undefined;
        if (!boardId || !taskId || !childTitles?.length) {
          fail(ctx, ws, type, 'boardId, taskId, and childTitles required');
          return;
        }
        const result = await splitTask(projectRoot, boardId, taskId, {
          titles: childTitles,
          ...(payload?.targetColumnId ? { columnId: payload.targetColumnId as string } : {}),
          ...(typeof payload?.inheritAssignment === 'boolean'
            ? { inheritAssignment: payload.inheritAssignment }
            : {}),
          ...(typeof payload?.inheritLabels === 'boolean'
            ? { inheritLabels: payload.inheritLabels }
            : {}),
          ...(typeof payload?.inheritSuccessCriteria === 'boolean'
            ? { inheritSuccessCriteria: payload.inheritSuccessCriteria }
            : {}),
          ...(typeof payload?.inheritGoalMetrics === 'boolean'
            ? { inheritGoalMetrics: payload.inheritGoalMetrics }
            : {}),
          ...(typeof payload?.inheritDependencies === 'boolean'
            ? { inheritDependencies: payload.inheritDependencies }
            : {}),
          ...(typeof payload?.chainChildren === 'boolean'
            ? { chainChildren: payload.chainChildren }
            : {}),
          ...(typeof payload?.rewireDependents === 'boolean'
            ? { rewireDependents: payload.rewireDependents }
            : {}),
        });
        if (!result) {
          fail(ctx, ws, type, 'Board or task not found');
          return;
        }
        ok(ctx, ws, type, {
          board: result.board,
          parent: result.parent,
          children: result.children,
        });
        return;
      }

      // ── Task merge ──
      case 'kanban.task.merge': {
        const boardId = payload?.boardId as string | undefined;
        const taskIds = payload?.taskIds as string[] | undefined;
        const title = payload?.title as string | undefined;
        if (!boardId || !taskIds?.length || !title) {
          fail(ctx, ws, type, 'boardId, taskIds, and title required');
          return;
        }
        const result = await mergeTasks(projectRoot, boardId, {
          taskIds,
          title,
          ...(payload?.description ? { description: payload.description as string } : {}),
          ...(payload?.targetColumnId ? { targetColumnId: payload.targetColumnId as string } : {}),
          ...(typeof payload?.preserveAssignment === 'boolean'
            ? { preserveAssignment: payload.preserveAssignment }
            : {}),
          ...(typeof payload?.closeSourceTasks === 'boolean'
            ? { closeSourceTasks: payload.closeSourceTasks }
            : {}),
        });
        if (!result) {
          fail(ctx, ws, type, 'Board or task not found');
          return;
        }
        ok(ctx, ws, type, {
          board: result.board,
          task: result.task,
          sourceTasks: result.sourceTasks,
        });
        return;
      }

      // ── Task update ──
      case 'kanban.task.update': {
        const boardId = payload?.boardId as string | undefined;
        const taskId = payload?.taskId as string | undefined;
        if (!boardId || !taskId) {
          fail(ctx, ws, type, 'boardId and taskId required');
          return;
        }
        const board = await updateTask(projectRoot, boardId, taskId, {
          ...(payload?.title ? { title: payload.title as string } : {}),
          ...(payload?.description ? { description: payload.description as string } : {}),
          ...(payload?.columnId ? { columnId: payload.columnId as string } : {}),
          ...(payload?.priority ? { priority: payload.priority as KanbanTaskPriority } : {}),
          ...(payload?.status ? { status: payload.status as KanbanTaskStatus } : {}),
          ...(payload?.assignedAgent ? { assignedAgent: payload.assignedAgent as string } : {}),
          ...(payload?.dependsOn ? { dependsOn: payload.dependsOn as string[] } : {}),
          ...(payload?.labels ? { labels: payload.labels as string[] } : {}),
        });
        if (!board) {
          fail(ctx, ws, type, 'Board or task not found');
          return;
        }
        ok(ctx, ws, 'kanban.task.update', findTask(board.tasks, taskId));
        return;
      }

      // ── Task move ──
      case 'kanban.task.move': {
        const bId = payload?.boardId as string | undefined;
        const tId = payload?.taskId as string | undefined;
        const colId = payload?.columnId as string | undefined;
        if (!bId || !tId || !colId) {
          fail(ctx, ws, type, 'boardId, taskId, columnId required');
          return;
        }
        const board = await moveTask(
          projectRoot,
          bId,
          tId,
          colId,
          payload?.order as number | undefined,
        );
        if (!board) {
          fail(ctx, ws, type, 'Move failed');
          return;
        }
        ok(ctx, ws, 'kanban.task.move', findTask(board.tasks, tId));
        return;
      }

      // ── Task copy/transfer across boards ──
      case 'kanban.task.copy':
      case 'kanban.task.transfer': {
        const bId = payload?.boardId as string | undefined;
        const tId = payload?.taskId as string | undefined;
        const targetBoardId = payload?.targetBoardId as string | undefined;
        if (!bId || !tId || !targetBoardId) {
          fail(ctx, ws, type, 'boardId, taskId, targetBoardId required');
          return;
        }
        const result =
          type === 'kanban.task.copy'
            ? await copyTaskToBoard(projectRoot, bId, tId, targetBoardId, {
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
            : await transferTaskToBoard(projectRoot, bId, tId, targetBoardId, {
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
        if (!result) {
          fail(ctx, ws, type, 'Board or task not found');
          return;
        }
        ok(ctx, ws, type, result.targetBoard);
        return;
      }

      // ── Task chain ──
      case 'kanban.task.chain': {
        const boardId = payload?.boardId as string | undefined;
        const taskIds = payload?.taskIds as string[] | undefined;
        if (!boardId || !taskIds?.length) {
          fail(ctx, ws, type, 'boardId and taskIds required');
          return;
        }
        const result = await setTaskChain(projectRoot, boardId, {
          taskIds,
          ...(payload?.chainId ? { chainId: payload.chainId as string } : {}),
          ...(typeof payload?.enforceDependencies === 'boolean'
            ? { enforceDependencies: payload.enforceDependencies }
            : {}),
        });
        if (!result) {
          fail(ctx, ws, type, 'Board or task not found');
          return;
        }
        ok(ctx, ws, type, {
          board: result.board,
          chainId: result.chainId,
          tasks: result.tasks,
        });
        return;
      }

      case 'kanban.task.chain.get': {
        const boardId = payload?.boardId as string | undefined;
        const taskOrChainId =
          (payload?.taskId as string | undefined) ?? (payload?.chainId as string | undefined);
        if (!boardId || !taskOrChainId) {
          fail(ctx, ws, type, 'boardId and taskId or chainId required');
          return;
        }
        const result = await getTaskChain(projectRoot, boardId, taskOrChainId);
        if (!result) {
          fail(ctx, ws, type, 'Chain not found');
          return;
        }
        ok(ctx, ws, type, {
          board: result.board,
          chainId: result.chainId,
          tasks: result.tasks,
        });
        return;
      }

      // ── Task claim/release ──
      case 'kanban.task.claim': {
        const result = await claimReadyTask(projectRoot, {
          ...(payload?.boardId ? { boardId: payload.boardId as string } : {}),
          ...(payload?.taskId ? { taskId: payload.taskId as string } : {}),
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
          ...(payload?.assignee ? { assignee: payload.assignee as string } : {}),
          status:
            (payload?.assignmentStatus as 'assigned' | 'queued' | 'running' | undefined) ??
            'queued',
        });
        result
          ? ok(ctx, ws, type, { board: result.board, task: result.task })
          : fail(ctx, ws, type, 'No ready kanban task matched the claim');
        return;
      }

      case 'kanban.task.release': {
        const boardId = payload?.boardId as string | undefined;
        const taskId = payload?.taskId as string | undefined;
        if (!boardId || !taskId) {
          fail(ctx, ws, type, 'boardId and taskId required');
          return;
        }
        const board = await releaseTaskClaim(projectRoot, boardId, taskId, {
          ...(payload?.status ? { status: payload.status as 'pending' | 'ready' | 'blocked' } : {}),
          ...(payload?.reason ? { reason: payload.reason as string } : {}),
          ...(typeof payload?.clearAssignee === 'boolean'
            ? { clearAssignee: payload.clearAssignee }
            : {}),
        });
        board ? ok(ctx, ws, type, board) : fail(ctx, ws, type, 'Board or task not found');
        return;
      }

      // ── Goal metrics ──
      case 'kanban.task.metric.add': {
        const boardId = payload?.boardId as string | undefined;
        const taskId = payload?.taskId as string | undefined;
        const name = payload?.name as string | undefined;
        if (!boardId || !taskId || !name) {
          fail(ctx, ws, type, 'boardId, taskId, and name required');
          return;
        }
        const board = await addGoalMetricToTask(projectRoot, boardId, taskId, {
          name,
          ...(payload?.status
            ? { status: payload.status as 'pending' | 'met' | 'missed' | 'waived' }
            : {}),
          ...(payload?.target !== undefined ? { target: payload.target as string | number } : {}),
          ...(payload?.current !== undefined
            ? { current: payload.current as string | number }
            : {}),
          ...(payload?.unit ? { unit: payload.unit as string } : {}),
          ...(payload?.notes ? { notes: payload.notes as string } : {}),
        });
        board ? ok(ctx, ws, type, board) : fail(ctx, ws, type, 'Board or task not found');
        return;
      }

      case 'kanban.task.metric.update': {
        const boardId = payload?.boardId as string | undefined;
        const taskId = payload?.taskId as string | undefined;
        const metricId = payload?.metricId as string | undefined;
        if (!boardId || !taskId || !metricId) {
          fail(ctx, ws, type, 'boardId, taskId, and metricId required');
          return;
        }
        const board = await updateGoalMetricOnTask(projectRoot, boardId, taskId, metricId, {
          ...(payload?.name ? { name: payload.name as string } : {}),
          ...(payload?.status
            ? { status: payload.status as 'pending' | 'met' | 'missed' | 'waived' }
            : {}),
          ...(payload?.target !== undefined ? { target: payload.target as string | number } : {}),
          ...(payload?.current !== undefined
            ? { current: payload.current as string | number }
            : {}),
          ...(payload?.unit ? { unit: payload.unit as string } : {}),
          ...(payload?.notes ? { notes: payload.notes as string } : {}),
        });
        board ? ok(ctx, ws, type, board) : fail(ctx, ws, type, 'Metric not found');
        return;
      }

      // ── Task assign ──
      case 'kanban.task.assign': {
        const bId = payload?.boardId as string | undefined;
        const tId = payload?.taskId as string | undefined;
        const agentId = payload?.agentId as string | undefined;
        if (!bId || !tId) {
          fail(ctx, ws, type, 'boardId and taskId required');
          return;
        }
        const board = await assignTask(projectRoot, bId, tId, {
          ...(agentId ? { agentId } : {}),
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
          ...(payload?.assignee ? { assignee: payload.assignee as string } : {}),
        });
        if (!board) {
          fail(ctx, ws, type, 'Board or task not found');
          return;
        }
        ok(ctx, ws, 'kanban.task.assign', findTask(board.tasks, tId));
        return;
      }

      case 'kanban.capabilities':
        ok(ctx, ws, type, { dispatchSupported: true });
        return;

      // ── Task dispatch ──
      case 'kanban.task.dispatch': {
        const bId = payload?.boardId as string | undefined;
        const tId = payload?.taskId as string | undefined;
        if (!bId || !tId) {
          fail(ctx, ws, type, 'boardId and taskId required');
          return;
        }
        if (!ctx.dispatchTask) {
          fail(ctx, ws, type, 'Kanban agent dispatch is not available in this runtime');
          return;
        }
        const board = await getBoard(projectRoot, bId);
        const task = board ? findTask(board.tasks, tId) : undefined;
        if (!board || !task) {
          fail(ctx, ws, type, 'Board or task not found');
          return;
        }
        const assignment = {
          agentId:
            (payload?.agentId as string | undefined) ??
            task.assignment?.agentId ??
            task.assignedAgent,
          name:
            (payload?.name as string | undefined) ?? task.assignment?.name ?? task.assignedAgent,
          role: (payload?.role as string | undefined) ?? task.assignment?.role,
          provider: (payload?.provider as string | undefined) ?? task.assignment?.provider,
          model: (payload?.model as string | undefined) ?? task.assignment?.model,
          fallbackProfile:
            (payload?.fallbackProfile as string | undefined) ?? task.assignment?.fallbackProfile,
          fallbackModels:
            (payload?.fallbackModels as string[] | undefined) ?? task.assignment?.fallbackModels,
          tools: (payload?.tools as string[] | undefined) ?? task.assignment?.tools,
          allowedCapabilities:
            (payload?.allowedCapabilities as string[] | undefined) ??
            task.assignment?.allowedCapabilities,
          status: 'queued' as const,
          dispatchedAt: new Date().toISOString(),
        };
        await assignTask(projectRoot, bId, task.id, assignment);
        try {
          const summary = await ctx.dispatchTask(buildKanbanAgentPrompt(board, task, assignment), {
            ...(assignment.provider ? { provider: assignment.provider } : {}),
            ...(assignment.model ? { model: assignment.model } : {}),
            ...(assignment.fallbackModels ? { fallbackModels: assignment.fallbackModels } : {}),
            ...(assignment.tools ? { tools: assignment.tools } : {}),
            ...(assignment.name ? { name: assignment.name } : {}),
            ...(assignment.allowedCapabilities
              ? { allowedCapabilities: assignment.allowedCapabilities }
              : {}),
            onDone: async (result) => {
              const completed = await updateTaskAssignment(projectRoot, bId, task.id, {
                ...assignment,
                status: result.status,
                ...(result.result !== undefined ? { lastResult: result.result } : {}),
                ...(result.error !== undefined ? { error: result.error } : {}),
              });
              const completedTask =
                completed?.tasks.find((candidate) => candidate.id === task.id) ?? task;
              ctx.broadcast({
                type: 'kanban.task.update',
                payload: { success: true, data: { boardId: board.id, task: completedTask } },
              });
              if (completed) {
                ctx.broadcast({
                  type: 'kanban.get',
                  payload: { success: true, data: { board: completed } },
                });
              }
              ctx.broadcast({
                type: 'kanban.list',
                payload: { success: true, data: await listBoards(projectRoot) },
              });
            },
          });
          const subagentId = summary.match(/Spawned subagent\s+([^\s]+)/)?.[1];
          const updated = await updateTaskAssignment(projectRoot, bId, task.id, {
            ...assignment,
            status: 'running',
            ...(subagentId ? { subagentId } : {}),
            lastResult: summary,
          });
          const runningTask = updated?.tasks.find((candidate) => candidate.id === task.id) ?? task;
          // Broadcast the running transition so every connected client sees the
          // agent go live immediately, not on the next poll tick.
          ctx.broadcast({
            type: 'kanban.task.update',
            payload: { success: true, data: { boardId: board.id, task: runningTask } },
          });
          if (updated) {
            ctx.broadcast({
              type: 'kanban.get',
              payload: { success: true, data: { board: updated } },
            });
          }
          ok(ctx, ws, 'kanban.task.dispatch', {
            boardId: board.id,
            task: runningTask,
            summary,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await updateTaskAssignment(projectRoot, bId, task.id, {
            ...assignment,
            status: 'failed',
            error: message,
          });
          fail(ctx, ws, type, message);
        }
        return;
      }

      // ── Task remove ──
      case 'kanban.task.remove': {
        const rmBoardId = payload?.boardId as string | undefined;
        const rmTaskId = payload?.taskId as string | undefined;
        if (!rmBoardId || !rmTaskId) {
          fail(ctx, ws, type, 'boardId and taskId required');
          return;
        }
        const task = await getTask(projectRoot, rmBoardId, rmTaskId);
        if (!task) {
          fail(ctx, ws, type, 'Board or task not found');
          return;
        }
        const board = await removeTask(projectRoot, rmBoardId, rmTaskId);
        if (!board) {
          fail(ctx, ws, type, 'Board or task not found');
          return;
        }
        ok(ctx, ws, 'kanban.task.remove', {
          removed: true,
          boardId: board.id,
          taskId: task.id,
          board,
        });
        return;
      }

      // ── Task get ──
      case 'kanban.task.get': {
        const gBoardId = payload?.boardId as string | undefined;
        const gTaskId = payload?.taskId as string | undefined;
        if (!gBoardId || !gTaskId) {
          fail(ctx, ws, type, 'boardId and taskId required');
          return;
        }
        const task = await getTask(projectRoot, gBoardId, gTaskId);
        if (!task) {
          fail(ctx, ws, type, 'Task not found');
          return;
        }
        ok(ctx, ws, 'kanban.task.get', task);
        return;
      }

      // ── Column add ──
      case 'kanban.column.add': {
        const colBoardId = payload?.boardId as string | undefined;
        const colTitle = payload?.title as string | undefined;
        if (!colBoardId || !colTitle) {
          fail(ctx, ws, type, 'boardId and title required');
          return;
        }
        const result = await addColumn(projectRoot, colBoardId, {
          title: colTitle,
          ...(payload?.description ? { description: payload.description as string } : {}),
          ...(payload?.color ? { color: payload.color as string } : {}),
          ...(typeof payload?.wipLimit === 'number' ? { wipLimit: payload.wipLimit } : {}),
        });
        if (!result) {
          fail(ctx, ws, type, `Board not found: ${colBoardId}`);
          return;
        }
        ok(ctx, ws, 'kanban.column.add', result.board.columns);
        return;
      }

      // ── Column remove ──
      case 'kanban.column.remove': {
        const rmColBoardId = payload?.boardId as string | undefined;
        const rmColId = payload?.columnId as string | undefined;
        if (!rmColBoardId || !rmColId) {
          fail(ctx, ws, type, 'boardId and columnId required');
          return;
        }
        const updated = await removeColumn(projectRoot, rmColBoardId, rmColId, {
          moveTasksToColumnId: payload?.moveTasksToColumnId as string | undefined,
        });
        if (!updated) {
          fail(ctx, ws, type, `Column not found: ${rmColId}`);
          return;
        }
        ok(ctx, ws, 'kanban.column.remove', {
          removed: true,
          boardId: updated.id,
          columnId: rmColId,
          board: updated,
        });
        return;
      }

      default:
        fail(ctx, ws, type, `Unknown kanban message type: ${type}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.log(`[Kanban WS] Error: ${message}`);
    fail(ctx, ws, type, message);
  }
}

function buildKanbanAgentPrompt(
  board: { id: string; title: string; tasks: KanbanTask[] },
  task: KanbanTask,
  assignment: KanbanTask['assignment'],
): string {
  const dependencies = (task.dependsOn ?? [])
    .map((depId) => board.tasks.find((candidate) => candidate.id === depId))
    .filter((dep): dep is KanbanTask => Boolean(dep))
    .map((dep) => `- ${dep.title} [${dep.status}] (${dep.id})`);
  const checks = task.successCriteria?.map((check) => `- ${check.description}`).join('\n');
  const metrics = task.goalMetrics
    ?.map(
      (metric) =>
        `- ${metric.name}: ${metric.current ?? 'n/a'}${metric.target !== undefined ? ` / ${metric.target}` : ''}${metric.unit ? ` ${metric.unit}` : ''} [${metric.status}]`,
    )
    .join('\n');
  const chain = task.chain
    ? [
        `chainId: ${task.chain.chainId}`,
        `order: ${task.chain.order}`,
        task.chain.previousTaskId ? `previous: ${task.chain.previousTaskId}` : '',
        task.chain.nextTaskId ? `next: ${task.chain.nextTaskId}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '';
  const routing = [
    assignment?.role ? `role: ${assignment.role}` : '',
    assignment?.provider ? `provider: ${assignment.provider}` : '',
    assignment?.model ? `model: ${assignment.model}` : '',
    assignment?.fallbackProfile ? `fallbackProfile: ${assignment.fallbackProfile}` : '',
    assignment?.fallbackModels?.length
      ? `fallbackModels: ${assignment.fallbackModels.join(', ')}`
      : '',
  ].filter(Boolean);
  return [
    'You are processing a WrongStack kanban task.',
    '',
    `Board: ${board.title} (${board.id})`,
    `Task: ${task.title} (${task.id})`,
    `Status: ${task.status}`,
    `Priority: ${task.priority}`,
    task.description ? `Description:\n${task.description}` : '',
    routing.length ? `Routing hints:\n${routing.join('\n')}` : '',
    chain ? `Task chain:\n${chain}` : '',
    dependencies.length ? `Dependencies:\n${dependencies.join('\n')}` : '',
    checks ? `Success criteria:\n${checks}` : '',
    metrics ? `Goal metrics:\n${metrics}` : '',
    task.labels?.length ? `Labels: ${task.labels.join(', ')}` : '',
    '',
    'Work the task end-to-end. Use the kanban tool, not direct file edits, to update this task.',
    `When you start or finish, call kanban with action "mark_assignment", boardId "${board.id}", taskId "${task.id}", and assignmentStatus "running", "completed", or "failed". Include lastResult or error when you finish.`,
    'When finished, report what changed, what you verified, and any remaining blockers.',
  ]
    .filter(Boolean)
    .join('\n');
}

function findTask(tasks: KanbanTask[], taskId: string): KanbanTask | undefined {
  return tasks.find((task) => task.id === taskId || task.id.startsWith(taskId));
}
