import type {
  AssignKanbanTaskInput,
  KanbanAgentAssignment,
  KanbanAgentRunStatus,
  KanbanBoard,
  KanbanBoardSummary,
  KanbanSearchResult,
  KanbanTask,
  KanbanTaskPriority,
  KanbanTaskStatus,
  Tool,
} from '@wrongstack/core';
import {
  addCheckToTask,
  addColumn,
  addDependency,
  addLinkToTask,
  addNoteToTask,
  addTask,
  assignTask,
  copyTaskToBoard,
  createBoard,
  duplicateBoard,
  exportBoardAsMarkdown,
  generateBoardFromDescription,
  getBoard,
  getTask,
  listBoards,
  moveTask,
  parseLinesIntoTasks,
  removeBoard,
  removeColumn,
  removeTask,
  searchKanban,
  transferTaskToBoard,
  updateBoard,
  updateCheckOnTask,
  updateColumn,
  updateTask,
  updateTaskAssignment,
} from '@wrongstack/core';

type KanbanAction =
  | 'list_boards'
  | 'get_board'
  | 'create_board'
  | 'duplicate_board'
  | 'update_board'
  | 'delete_board'
  | 'generate_board'
  | 'export_markdown'
  | 'search_tasks'
  | 'add_column'
  | 'update_column'
  | 'delete_column'
  | 'add_task'
  | 'copy_task'
  | 'transfer_task'
  | 'get_task'
  | 'update_task'
  | 'move_task'
  | 'delete_task'
  | 'assign_task'
  | 'mark_assignment'
  | 'add_dependency'
  | 'add_check'
  | 'update_check'
  | 'add_note'
  | 'add_link';

interface KanbanToolInput extends Omit<AssignKanbanTaskInput, 'status'> {
  action: KanbanAction;
  boardId?: string | undefined;
  taskId?: string | undefined;
  columnId?: string | undefined;
  targetBoardId?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  tags?: string[] | undefined;
  labels?: string[] | undefined;
  priority?: KanbanTaskPriority | undefined;
  status?: KanbanTaskStatus | undefined;
  order?: number | undefined;
  targetColumnId?: string | undefined;
  moveTasksToColumnId?: string | undefined;
  query?: string | undefined;
  dependencyTaskId?: string | undefined;
  checkId?: string | undefined;
  checkDescription?: string | undefined;
  checkStatus?: 'pending' | 'passed' | 'failed' | 'skipped' | undefined;
  note?: string | undefined;
  author?: string | undefined;
  url?: string | undefined;
  linkTitle?: string | undefined;
  linkType?: 'issue' | 'pr' | 'doc' | 'commit' | 'design' | 'file' | 'url' | 'other' | undefined;
  context?: string | undefined;
  columns?: string[] | undefined;
  generatedBy?: string | undefined;
  includeTasks?: boolean | undefined;
  includeCompletedTasks?: boolean | undefined;
  preserveAssignment?: boolean | undefined;
  preserveDependencies?: boolean | undefined;
  subagentId?: string | undefined;
  runTaskId?: string | undefined;
  lastResult?: string | undefined;
  error?: string | undefined;
  assignmentStatus?: KanbanAgentRunStatus | undefined;
}

interface KanbanToolOutput {
  ok: boolean;
  message: string;
  board?: KanbanBoard | undefined;
  boards?: KanbanBoardSummary[] | undefined;
  task?: KanbanTask | undefined;
  tasks?: KanbanSearchResult[] | undefined;
  markdown?: string | undefined;
}

export const kanbanTool: Tool<KanbanToolInput, KanbanToolOutput> = {
  name: 'kanban',
  category: 'Project',
  description:
    'Manage project-scoped multi-kanban boards stored under .wrongstack/kanbans. Supports board/task/column CRUD, search, assignment metadata, provider/model/fallback routing hints, success checks, notes, links, and run status updates.',
  usageHint:
    'Use this for durable project kanban state. Assign tasks with provider/model/fallback hints before spawning agents; after a subagent starts or finishes, call mark_assignment to record subagentId/runTaskId/status/result.',
  permission: 'confirm',
  mutating: true,
  capabilities: ['fs.write'],
  icon: 'task',
  timeoutMs: 5_000,
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'list_boards',
          'get_board',
          'create_board',
          'duplicate_board',
          'update_board',
          'delete_board',
          'generate_board',
          'export_markdown',
          'search_tasks',
          'add_column',
          'update_column',
          'delete_column',
          'add_task',
          'copy_task',
          'transfer_task',
          'get_task',
          'update_task',
          'move_task',
          'delete_task',
          'assign_task',
          'mark_assignment',
          'add_dependency',
          'add_check',
          'update_check',
          'add_note',
          'add_link',
        ],
      },
      boardId: { type: 'string' },
      taskId: { type: 'string' },
      columnId: { type: 'string' },
      targetBoardId: { type: 'string' },
      targetColumnId: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      labels: { type: 'array', items: { type: 'string' } },
      priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
      status: {
        type: 'string',
        enum: [
          'pending',
          'ready',
          'in_progress',
          'blocked',
          'review',
          'completed',
          'failed',
          'archived',
        ],
      },
      order: { type: 'number' },
      query: { type: 'string' },
      agentId: { type: 'string' },
      name: { type: 'string' },
      role: { type: 'string' },
      provider: { type: 'string' },
      model: { type: 'string' },
      fallbackProfile: { type: 'string' },
      fallbackModels: { type: 'array', items: { type: 'string' } },
      tools: { type: 'array', items: { type: 'string' } },
      allowedCapabilities: { type: 'array', items: { type: 'string' } },
      subagentId: { type: 'string' },
      runTaskId: { type: 'string' },
      lastResult: { type: 'string' },
      error: { type: 'string' },
      assignmentStatus: {
        type: 'string',
        enum: ['assigned', 'queued', 'running', 'completed', 'failed', 'cancelled'],
      },
      dependencyTaskId: { type: 'string' },
      checkId: { type: 'string' },
      checkDescription: { type: 'string' },
      checkStatus: { type: 'string', enum: ['pending', 'passed', 'failed', 'skipped'] },
      note: { type: 'string' },
      author: { type: 'string' },
      url: { type: 'string' },
      linkTitle: { type: 'string' },
      linkType: {
        type: 'string',
        enum: ['issue', 'pr', 'doc', 'commit', 'design', 'file', 'url', 'other'],
      },
      context: { type: 'string' },
      columns: { type: 'array', items: { type: 'string' } },
      generatedBy: { type: 'string' },
      includeTasks: { type: 'boolean' },
      includeCompletedTasks: { type: 'boolean' },
      preserveAssignment: { type: 'boolean' },
      preserveDependencies: { type: 'boolean' },
      moveTasksToColumnId: { type: 'string' },
    },
    required: ['action'],
  },
  async execute(input, ctx) {
    const projectRoot = ctx.projectRoot;
    if (!projectRoot) return fail('No project root is available.');

    switch (input.action) {
      case 'list_boards': {
        const boards = await listBoards(projectRoot);
        return { ok: true, message: `${boards.length} board(s).`, boards };
      }
      case 'get_board': {
        const board = await requireBoard(projectRoot, input.boardId);
        return board ? okBoard(board) : fail('Board not found.');
      }
      case 'create_board': {
        if (!input.title) return fail('create_board requires title.');
        const board = await createBoard(projectRoot, {
          title: input.title,
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
          ...(input.generatedBy !== undefined ? { generatedBy: input.generatedBy } : {}),
        });
        return { ok: true, message: `Board created: ${board.title}`, board };
      }
      case 'update_board': {
        if (!input.boardId) return fail('update_board requires boardId.');
        const board = await updateBoard(projectRoot, input.boardId, {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
        });
        return board ? okBoard(board, 'Board updated.') : fail('Board not found.');
      }
      case 'duplicate_board': {
        if (!input.boardId) return fail('duplicate_board requires boardId.');
        const board = await duplicateBoard(projectRoot, input.boardId, {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.generatedBy !== undefined ? { generatedBy: input.generatedBy } : {}),
          ...(input.includeTasks !== undefined ? { includeTasks: input.includeTasks } : {}),
          ...(input.includeCompletedTasks !== undefined
            ? { includeCompletedTasks: input.includeCompletedTasks }
            : {}),
          ...(input.preserveAssignment !== undefined
            ? { preserveAssignment: input.preserveAssignment }
            : {}),
        });
        return board ? okBoard(board, 'Board duplicated.') : fail('Board not found.');
      }
      case 'delete_board': {
        if (!input.boardId) return fail('delete_board requires boardId.');
        const removed = await removeBoard(projectRoot, input.boardId);
        return { ok: removed, message: removed ? 'Board deleted.' : 'Board not found.' };
      }
      case 'generate_board': {
        if (!input.description) return fail('generate_board requires description.');
        const boardInput = generateBoardFromDescription({
          description: input.description,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.context !== undefined ? { context: input.context } : {}),
          ...(input.columns !== undefined ? { columns: input.columns } : {}),
        });
        const board = await createBoard(projectRoot, boardInput);
        for (const taskInput of parseLinesIntoTasks(
          input.description,
          board.columns[0]?.id ?? 'backlog',
        )) {
          await addTask(projectRoot, board.id, taskInput);
        }
        return okBoard((await getBoard(projectRoot, board.id)) ?? board, 'Board generated.');
      }
      case 'export_markdown': {
        const board = await requireBoard(projectRoot, input.boardId);
        if (!board) return fail('Board not found.');
        return {
          ok: true,
          message: 'Board exported.',
          board,
          markdown: exportBoardAsMarkdown(board),
        };
      }
      case 'search_tasks': {
        const tasks = await searchKanban(projectRoot, {
          query: input.query,
          boardId: input.boardId,
          assignedAgent: input.agentId,
          status: input.status,
          priority: input.priority,
          label: input.labels?.[0],
        });
        return { ok: true, message: `${tasks.length} task(s) matched.`, tasks };
      }
      case 'add_column': {
        if (!input.boardId || !input.title) return fail('add_column requires boardId and title.');
        const result = await addColumn(projectRoot, input.boardId, {
          title: input.title,
          ...(input.description !== undefined ? { description: input.description } : {}),
        });
        return result ? okBoard(result.board, 'Column added.') : fail('Board not found.');
      }
      case 'update_column': {
        if (!input.boardId || !input.columnId)
          return fail('update_column requires boardId and columnId.');
        const board = await updateColumn(projectRoot, input.boardId, input.columnId, {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.order !== undefined ? { order: input.order } : {}),
        });
        return board ? okBoard(board, 'Column updated.') : fail('Column not found.');
      }
      case 'delete_column': {
        if (!input.boardId || !input.columnId)
          return fail('delete_column requires boardId and columnId.');
        const board = await removeColumn(projectRoot, input.boardId, input.columnId, {
          moveTasksToColumnId: input.moveTasksToColumnId,
        });
        return board ? okBoard(board, 'Column deleted.') : fail('Column not found.');
      }
      case 'add_task': {
        if (!input.boardId || !input.title) return fail('add_task requires boardId and title.');
        const result = await addTask(projectRoot, input.boardId, taskInput(input));
        return result ? okTask(result.board, result.task, 'Task added.') : fail('Board not found.');
      }
      case 'copy_task': {
        if (!input.boardId || !input.taskId || !input.targetBoardId) {
          return fail('copy_task requires boardId, taskId, and targetBoardId.');
        }
        const result = await copyTaskToBoard(
          projectRoot,
          input.boardId,
          input.taskId,
          input.targetBoardId,
          {
            ...(input.targetColumnId !== undefined ? { targetColumnId: input.targetColumnId } : {}),
            ...(input.order !== undefined ? { targetOrder: input.order } : {}),
            ...(input.preserveAssignment !== undefined
              ? { preserveAssignment: input.preserveAssignment }
              : {}),
            ...(input.preserveDependencies !== undefined
              ? { preserveDependencies: input.preserveDependencies }
              : {}),
          },
        );
        return result
          ? okTask(result.targetBoard, result.task, 'Task copied to target board.')
          : fail('Board or task not found.');
      }
      case 'transfer_task': {
        if (!input.boardId || !input.taskId || !input.targetBoardId) {
          return fail('transfer_task requires boardId, taskId, and targetBoardId.');
        }
        const result = await transferTaskToBoard(
          projectRoot,
          input.boardId,
          input.taskId,
          input.targetBoardId,
          {
            ...(input.targetColumnId !== undefined ? { targetColumnId: input.targetColumnId } : {}),
            ...(input.order !== undefined ? { targetOrder: input.order } : {}),
            ...(input.preserveAssignment !== undefined
              ? { preserveAssignment: input.preserveAssignment }
              : {}),
            ...(input.preserveDependencies !== undefined
              ? { preserveDependencies: input.preserveDependencies }
              : {}),
          },
        );
        return result
          ? okTask(result.targetBoard, result.task, 'Task transferred to target board.')
          : fail('Board or task not found.');
      }
      case 'get_task': {
        if (!input.boardId || !input.taskId) return fail('get_task requires boardId and taskId.');
        const task = await getTask(projectRoot, input.boardId, input.taskId);
        return task ? { ok: true, message: 'Task loaded.', task } : fail('Task not found.');
      }
      case 'update_task': {
        if (!input.boardId || !input.taskId)
          return fail('update_task requires boardId and taskId.');
        const board = await updateTask(projectRoot, input.boardId, input.taskId, taskPatch(input));
        return board ? okBoard(board, 'Task updated.') : fail('Task not found.');
      }
      case 'move_task': {
        if (!input.boardId || !input.taskId || !input.targetColumnId) {
          return fail('move_task requires boardId, taskId, and targetColumnId.');
        }
        const board = await moveTask(
          projectRoot,
          input.boardId,
          input.taskId,
          input.targetColumnId,
          input.order,
        );
        return board ? okBoard(board, 'Task moved.') : fail('Move failed.');
      }
      case 'delete_task': {
        if (!input.boardId || !input.taskId)
          return fail('delete_task requires boardId and taskId.');
        const board = await removeTask(projectRoot, input.boardId, input.taskId);
        return board ? okBoard(board, 'Task deleted.') : fail('Task not found.');
      }
      case 'assign_task': {
        if (!input.boardId || !input.taskId)
          return fail('assign_task requires boardId and taskId.');
        const board = await assignTask(
          projectRoot,
          input.boardId,
          input.taskId,
          assignmentInput(input),
        );
        return board ? okBoard(board, 'Task assigned.') : fail('Task not found.');
      }
      case 'mark_assignment': {
        if (!input.boardId || !input.taskId)
          return fail('mark_assignment requires boardId and taskId.');
        const assignmentStatus =
          input.assignmentStatus ??
          (input.status === 'completed' ? 'completed' : input.error ? 'failed' : undefined);
        const board = await updateTaskAssignment(projectRoot, input.boardId, input.taskId, {
          ...(assignmentStatus !== undefined ? { status: assignmentStatus } : {}),
          ...(input.subagentId !== undefined ? { subagentId: input.subagentId } : {}),
          ...(input.runTaskId !== undefined ? { runTaskId: input.runTaskId } : {}),
          ...(input.lastResult !== undefined ? { lastResult: input.lastResult } : {}),
          ...(input.error !== undefined ? { error: input.error } : {}),
          ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
        });
        return board ? okBoard(board, 'Assignment updated.') : fail('Task not found.');
      }
      case 'add_dependency': {
        if (!input.boardId || !input.taskId || !input.dependencyTaskId) {
          return fail('add_dependency requires boardId, taskId, and dependencyTaskId.');
        }
        const board = await addDependency(
          projectRoot,
          input.boardId,
          input.taskId,
          input.dependencyTaskId,
        );
        return board ? okBoard(board, 'Dependency added.') : fail('Task not found.');
      }
      case 'add_check': {
        if (!input.boardId || !input.taskId || !input.checkDescription) {
          return fail('add_check requires boardId, taskId, and checkDescription.');
        }
        const board = await addCheckToTask(projectRoot, input.boardId, input.taskId, {
          description: input.checkDescription,
          type: 'manual',
          status: input.checkStatus,
        });
        return board ? okBoard(board, 'Check added.') : fail('Task not found.');
      }
      case 'update_check': {
        if (!input.boardId || !input.taskId || !input.checkId) {
          return fail('update_check requires boardId, taskId, and checkId.');
        }
        const board = await updateCheckOnTask(
          projectRoot,
          input.boardId,
          input.taskId,
          input.checkId,
          {
            ...(input.checkDescription !== undefined
              ? { description: input.checkDescription }
              : {}),
            ...(input.checkStatus !== undefined ? { status: input.checkStatus } : {}),
          },
        );
        return board ? okBoard(board, 'Check updated.') : fail('Check not found.');
      }
      case 'add_note': {
        if (!input.boardId || !input.taskId || !input.note)
          return fail('add_note requires boardId, taskId, and note.');
        const board = await addNoteToTask(projectRoot, input.boardId, input.taskId, {
          author: input.author ?? 'agent',
          content: input.note,
        });
        return board ? okBoard(board, 'Note added.') : fail('Task not found.');
      }
      case 'add_link': {
        if (!input.boardId || !input.taskId || !input.url)
          return fail('add_link requires boardId, taskId, and url.');
        const board = await addLinkToTask(projectRoot, input.boardId, input.taskId, {
          url: input.url,
          type: input.linkType ?? 'url',
          ...(input.linkTitle !== undefined ? { title: input.linkTitle } : {}),
        });
        return board ? okBoard(board, 'Link added.') : fail('Task not found.');
      }
      default:
        return fail(`Unknown kanban action: ${(input as { action: string }).action}`);
    }
  },
};

function fail(message: string): KanbanToolOutput {
  return { ok: false, message };
}

function okBoard(board: KanbanBoard, message = 'Board loaded.'): KanbanToolOutput {
  return { ok: true, message, board };
}

function okTask(board: KanbanBoard, task: KanbanTask, message: string): KanbanToolOutput {
  return { ok: true, message, board, task };
}

async function requireBoard(
  projectRoot: string,
  boardId: string | undefined,
): Promise<KanbanBoard | null> {
  return boardId ? getBoard(projectRoot, boardId) : null;
}

function taskInput(input: KanbanToolInput) {
  return {
    title: input.title ?? '',
    columnId: input.columnId,
    description: input.description,
    priority: input.priority,
    status: input.status,
    labels: input.labels,
    assignedAgent: input.agentId,
    ...(input.agentId || input.provider || input.model
      ? { assignment: assignmentForTaskCreate(input) }
      : {}),
  };
}

function taskPatch(input: KanbanToolInput) {
  return {
    title: input.title,
    description: input.description,
    columnId: input.columnId,
    order: input.order,
    priority: input.priority,
    status: input.status,
    labels: input.labels,
    assignedAgent: input.agentId,
  };
}

function assignmentInput(input: KanbanToolInput): AssignKanbanTaskInput {
  return {
    agentId: input.agentId,
    name: input.name,
    role: input.role,
    provider: input.provider,
    model: input.model,
    fallbackProfile: input.fallbackProfile,
    fallbackModels: input.fallbackModels,
    tools: input.tools,
    allowedCapabilities: input.allowedCapabilities,
    assignee: input.assignee,
  };
}

function assignmentForTaskCreate(input: KanbanToolInput): KanbanAgentAssignment {
  return {
    status: input.assignmentStatus ?? 'assigned',
    ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.role !== undefined ? { role: input.role } : {}),
    ...(input.provider !== undefined ? { provider: input.provider } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.fallbackProfile !== undefined ? { fallbackProfile: input.fallbackProfile } : {}),
    ...(input.fallbackModels !== undefined ? { fallbackModels: input.fallbackModels } : {}),
    ...(input.tools !== undefined ? { tools: input.tools } : {}),
    ...(input.allowedCapabilities !== undefined
      ? { allowedCapabilities: input.allowedCapabilities }
      : {}),
  };
}
