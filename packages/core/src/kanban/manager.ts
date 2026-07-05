import { randomUUID } from 'node:crypto';
import {
  createBoardObject,
  deleteBoard,
  listBoardSummaries,
  mutateBoard,
  readBoard,
  summarizeBoard,
  writeBoard,
} from './storage.js';
import {
  type AssignKanbanTaskInput,
  type CopyKanbanTaskOptions,
  type CreateKanbanBoardInput,
  type CreateKanbanColumnInput,
  type CreateKanbanTaskInput,
  DEFAULT_COLUMNS,
  type DuplicateKanbanBoardInput,
  type KanbanAgentAssignment,
  type KanbanAgentRunStatus,
  type KanbanBoard,
  type KanbanCheck,
  type KanbanCheckStatus,
  type KanbanColumn,
  type KanbanGenerationInput,
  type KanbanLink,
  type KanbanNote,
  type KanbanSearchInput,
  type KanbanSearchResult,
  type KanbanTask,
  type KanbanTaskPriority,
  type KanbanTaskStatus,
  type RemoveKanbanColumnOptions,
  type UpdateKanbanBoardInput,
  type UpdateKanbanColumnInput,
  type UpdateKanbanTaskInput,
} from './types.js';

export async function createBoard(
  projectRoot: string,
  input: CreateKanbanBoardInput,
): Promise<KanbanBoard> {
  const columns = normalizeColumns(input.columns);
  const board = createBoardObject({
    title: input.title,
    columns,
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.tags !== undefined ? { tags: input.tags } : {}),
    ...(input.generatedBy !== undefined ? { generatedBy: input.generatedBy } : {}),
  });

  if (input.tasks?.length) {
    board.tasks = input.tasks.map((task, index) =>
      createTaskObject(board, {
        ...task,
        title: task.title,
        columnId: task.columnId ?? board.columns[0]?.id ?? 'backlog',
        order: task.order ?? index,
      }),
    );
  }

  await writeBoard(projectRoot, board);
  return board;
}

export async function listBoards(projectRoot: string) {
  return listBoardSummaries(projectRoot);
}

export async function getBoard(projectRoot: string, boardId: string): Promise<KanbanBoard | null> {
  return readBoard(projectRoot, boardId);
}

export async function updateBoard(
  projectRoot: string,
  boardId: string,
  input: UpdateKanbanBoardInput,
): Promise<KanbanBoard | null> {
  const updated = await mutateBoard(projectRoot, boardId, (board) => {
    if (input.title !== undefined) board.title = input.title;
    if (input.description !== undefined) board.description = input.description;
    if (input.tags !== undefined) board.tags = input.tags;
    if (input.columns !== undefined) board.columns = normalizeColumns(input.columns);
    if (input.completedAt !== undefined) {
      if (input.completedAt === null) delete board.completedAt;
      else board.completedAt = input.completedAt;
    }
    board.updatedAt = nowIso();
    return board;
  });
  return updated?.board ?? null;
}

export async function removeBoard(projectRoot: string, boardId: string): Promise<boolean> {
  return deleteBoard(projectRoot, boardId);
}

export async function duplicateBoard(
  projectRoot: string,
  boardId: string,
  input: DuplicateKanbanBoardInput = {},
): Promise<KanbanBoard | null> {
  const source = await readBoard(projectRoot, boardId);
  if (!source) return null;
  const board = createBoardObject({
    title: input.title ?? `${source.title} Copy`,
    ...(source.description !== undefined ? { description: source.description } : {}),
    ...(source.tags !== undefined ? { tags: [...source.tags] } : {}),
    columns: source.columns.map((column) => ({ ...column })),
    generatedBy: input.generatedBy ?? `duplicate:${source.id}`,
  });

  if (input.includeTasks !== false) {
    const sourceTasks = source.tasks.filter(
      (task) => input.includeCompletedTasks !== false || task.status !== 'completed',
    );
    const idMap = new Map<string, string>();
    board.tasks = sourceTasks.map((task) => {
      const cloned = cloneTaskForBoard(board, task, {
        preserveAssignment: input.preserveAssignment === true,
        preserveDependencies: true,
      });
      idMap.set(task.id, cloned.id);
      return cloned;
    });
    for (let index = 0; index < board.tasks.length; index++) {
      const original = sourceTasks[index];
      const cloned = board.tasks[index];
      if (!original || !cloned?.dependsOn?.length) continue;
      cloned.dependsOn = (original.dependsOn ?? [])
        .map((depId) => idMap.get(depId))
        .filter((depId): depId is string => Boolean(depId));
      if (cloned.dependsOn.length === 0) delete cloned.dependsOn;
    }
  }

  await writeBoard(projectRoot, board);
  return board;
}

export async function addColumn(
  projectRoot: string,
  boardId: string,
  input: CreateKanbanColumnInput,
): Promise<{ board: KanbanBoard; column: KanbanColumn } | null> {
  const updated = await mutateBoard(projectRoot, boardId, (board) => {
    const column: KanbanColumn = {
      id: uniqueColumnId(board, input.id ?? (slugify(input.title) || 'column')),
      title: input.title,
      order: input.order ?? board.columns.length,
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.wipLimit !== undefined ? { wipLimit: input.wipLimit } : { wipLimit: 0 }),
    };
    board.columns.push(column);
    board.columns = normalizeColumns(board.columns);
    board.updatedAt = nowIso();
    return column;
  });
  return updated ? { board: updated.board, column: updated.result } : null;
}

export async function updateColumn(
  projectRoot: string,
  boardId: string,
  columnId: string,
  input: UpdateKanbanColumnInput,
): Promise<KanbanBoard | null> {
  const updated = await mutateBoard(projectRoot, boardId, (board) => {
    const column = board.columns.find((candidate) => candidate.id === columnId);
    if (!column) return null;
    if (input.title !== undefined) column.title = input.title;
    if (input.description !== undefined) column.description = input.description;
    if (input.color !== undefined) column.color = input.color;
    if (input.order !== undefined) column.order = input.order;
    if (input.wipLimit !== undefined) column.wipLimit = input.wipLimit;
    board.columns = normalizeColumns(board.columns);
    board.updatedAt = nowIso();
    return board;
  });
  return updated?.result ? updated.board : null;
}

export async function removeColumn(
  projectRoot: string,
  boardId: string,
  columnId: string,
  options: RemoveKanbanColumnOptions = {},
): Promise<KanbanBoard | null> {
  const updated = await mutateBoard(projectRoot, boardId, (board) => {
    const index = board.columns.findIndex((column) => column.id === columnId);
    if (index === -1) return null;
    const columnTasks = board.tasks.filter((task) => task.columnId === columnId);
    if (columnTasks.length && !options.moveTasksToColumnId) {
      throw new Error(`Column "${columnId}" has tasks. Pass moveTasksToColumnId to move them.`);
    }
    if (options.moveTasksToColumnId) {
      const targetExists = board.columns.some(
        (column) => column.id === options.moveTasksToColumnId,
      );
      if (!targetExists) throw new Error(`Target column not found: ${options.moveTasksToColumnId}`);
      for (const task of columnTasks) task.columnId = options.moveTasksToColumnId;
    }
    board.columns.splice(index, 1);
    board.columns = normalizeColumns(board.columns);
    board.updatedAt = nowIso();
    return board;
  });
  return updated?.result ? updated.board : null;
}

export async function addTask(
  projectRoot: string,
  boardId: string,
  input: CreateKanbanTaskInput,
): Promise<{ board: KanbanBoard; task: KanbanTask } | null> {
  const updated = await mutateBoard(projectRoot, boardId, (board) => {
    const task = createTaskObject(board, input);
    board.tasks.push(task);
    board.updatedAt = nowIso();
    return task;
  });
  return updated ? { board: updated.board, task: updated.result } : null;
}

export async function copyTaskToBoard(
  projectRoot: string,
  sourceBoardId: string,
  taskId: string,
  targetBoardId: string,
  options: CopyKanbanTaskOptions = {},
): Promise<{ sourceBoard: KanbanBoard; targetBoard: KanbanBoard; task: KanbanTask } | null> {
  const sourceBoard = await readBoard(projectRoot, sourceBoardId);
  if (!sourceBoard) return null;
  const sourceTask = findTask(sourceBoard, taskId);
  if (!sourceTask) return null;

  const updated = await mutateBoard(projectRoot, targetBoardId, (targetBoard) => {
    const task = cloneTaskForBoard(targetBoard, sourceTask, {
      targetColumnId: options.targetColumnId,
      targetOrder: options.targetOrder,
      preserveAssignment: options.preserveAssignment === true,
      preserveDependencies: options.preserveDependencies === true,
    });
    targetBoard.tasks.push(task);
    targetBoard.updatedAt = nowIso();
    return task;
  });

  return updated ? { sourceBoard, targetBoard: updated.board, task: updated.result } : null;
}

export async function transferTaskToBoard(
  projectRoot: string,
  sourceBoardId: string,
  taskId: string,
  targetBoardId: string,
  options: CopyKanbanTaskOptions = {},
): Promise<{ sourceBoard: KanbanBoard; targetBoard: KanbanBoard; task: KanbanTask } | null> {
  const sourceBoard = await readBoard(projectRoot, sourceBoardId);
  if (!sourceBoard) return null;
  const sourceTask = findTask(sourceBoard, taskId);
  if (!sourceTask) return null;

  if (sourceBoard.id === (await readBoard(projectRoot, targetBoardId))?.id) {
    const moved = await moveTask(
      projectRoot,
      sourceBoard.id,
      sourceTask.id,
      options.targetColumnId ?? sourceTask.columnId,
      options.targetOrder,
    );
    const task = moved ? findTask(moved, sourceTask.id) : undefined;
    return moved && task ? { sourceBoard: moved, targetBoard: moved, task } : null;
  }

  const copied = await copyTaskToBoard(projectRoot, sourceBoard.id, sourceTask.id, targetBoardId, {
    ...options,
    preserveAssignment: options.preserveAssignment ?? true,
    preserveDependencies: options.preserveDependencies ?? false,
  });
  if (!copied) return null;
  const sourceAfterRemoval = await removeTask(projectRoot, sourceBoard.id, sourceTask.id);
  return {
    sourceBoard: sourceAfterRemoval ?? sourceBoard,
    targetBoard: copied.targetBoard,
    task: copied.task,
  };
}

export async function updateTask(
  projectRoot: string,
  boardId: string,
  taskId: string,
  input: UpdateKanbanTaskInput,
): Promise<KanbanBoard | null> {
  const updated = await mutateBoard(projectRoot, boardId, (board) => {
    const task = findTask(board, taskId);
    if (!task) return null;
    applyTaskPatch(board, task, input);
    return task;
  });
  return updated?.result ? updated.board : null;
}

export async function moveTask(
  projectRoot: string,
  boardId: string,
  taskId: string,
  targetColumnId: string,
  targetOrder?: number,
): Promise<KanbanBoard | null> {
  return updateTask(projectRoot, boardId, taskId, {
    columnId: targetColumnId,
    ...(targetOrder !== undefined ? { order: targetOrder } : {}),
    status: statusForColumn(targetColumnId),
  });
}

export async function removeTask(
  projectRoot: string,
  boardId: string,
  taskId: string,
): Promise<KanbanBoard | null> {
  const updated = await mutateBoard(projectRoot, boardId, (board) => {
    const taskToRemove = findTask(board, taskId);
    if (!taskToRemove) return false;
    const index = board.tasks.findIndex((task) => task.id === taskToRemove.id);
    if (index === -1) return false;
    board.tasks.splice(index, 1);
    for (const task of board.tasks) {
      if (task.dependsOn?.includes(taskToRemove.id)) {
        task.dependsOn = task.dependsOn.filter((depId) => depId !== taskToRemove.id);
      }
    }
    board.updatedAt = nowIso();
    return true;
  });
  return updated?.result ? updated.board : null;
}

export async function getTask(
  projectRoot: string,
  boardId: string,
  taskId: string,
): Promise<KanbanTask | null> {
  const board = await readBoard(projectRoot, boardId);
  return board ? (findTask(board, taskId) ?? null) : null;
}

export async function assignTask(
  projectRoot: string,
  boardId: string,
  taskId: string,
  input: AssignKanbanTaskInput,
): Promise<KanbanBoard | null> {
  const assignment = buildAssignment(input);
  return updateTask(projectRoot, boardId, taskId, {
    assignedAgent: assignment.agentId ?? assignment.role ?? assignment.name,
    assignee: input.assignee ?? assignment.name ?? assignment.agentId,
    assignment,
  });
}

export async function updateTaskAssignment(
  projectRoot: string,
  boardId: string,
  taskId: string,
  patch: Partial<KanbanAgentAssignment> & { status?: KanbanAgentRunStatus | undefined },
): Promise<KanbanBoard | null> {
  const updated = await mutateBoard(projectRoot, boardId, (board) => {
    const task = findTask(board, taskId);
    if (!task) return null;
    const nextAssignment: KanbanAgentAssignment = {
      ...(task.assignment ?? { status: 'assigned' as const }),
    };
    for (const [key, value] of Object.entries(patch) as Array<
      [keyof KanbanAgentAssignment, KanbanAgentAssignment[keyof KanbanAgentAssignment]]
    >) {
      if (value !== undefined) {
        (nextAssignment as unknown as Record<string, unknown>)[key] = value;
      }
    }
    task.assignment = nextAssignment;
    if (task.assignment.agentId) task.assignedAgent = task.assignment.agentId;
    if (task.assignment.status === 'completed') {
      task.assignment.completedAt = task.assignment.completedAt ?? nowIso();
      task.status = 'completed';
      task.completedAt = task.assignment.completedAt;
    } else if (task.assignment.status === 'running') {
      task.status = 'in_progress';
      delete task.completedAt;
    } else if (task.assignment.status === 'failed') {
      task.status = 'failed';
      delete task.completedAt;
    } else if (task.assignment.status === 'cancelled') {
      task.status = 'blocked';
      delete task.completedAt;
    }
    task.updatedAt = nowIso();
    board.updatedAt = task.updatedAt;
    return task;
  });
  return updated?.result ? updated.board : null;
}

export async function addDependency(
  projectRoot: string,
  boardId: string,
  taskId: string,
  dependencyTaskId: string,
): Promise<KanbanBoard | null> {
  const updated = await mutateBoard(projectRoot, boardId, (board) => {
    const task = findTask(board, taskId);
    const dependency = findTask(board, dependencyTaskId);
    if (!task || !dependency) return null;
    if (task.id === dependency.id) throw new Error('A kanban task cannot depend on itself.');
    if (hasDependencyPath(board, dependency.id, task.id)) {
      throw new Error(`Adding dependency ${dependency.id} would create a dependency cycle.`);
    }
    task.dependsOn = [...new Set([...(task.dependsOn ?? []), dependency.id])];
    task.updatedAt = nowIso();
    board.updatedAt = task.updatedAt;
    return task;
  });
  return updated?.result ? updated.board : null;
}

export async function addCheckToTask(
  projectRoot: string,
  boardId: string,
  taskId: string,
  check: Omit<KanbanCheck, 'id' | 'status'> & { status?: KanbanCheckStatus | undefined },
): Promise<KanbanBoard | null> {
  const updated = await mutateBoard(projectRoot, boardId, (board) => {
    const task = findTask(board, taskId);
    if (!task) return null;
    const newCheck: KanbanCheck = {
      id: randomUUID(),
      description: check.description,
      type: check.type,
      status: check.status ?? 'pending',
      ...(check.checkedBy !== undefined ? { checkedBy: check.checkedBy } : {}),
      ...(check.checkedAt !== undefined ? { checkedAt: check.checkedAt } : {}),
      ...(check.notes !== undefined ? { notes: check.notes } : {}),
    };
    task.successCriteria = [...(task.successCriteria ?? []), newCheck];
    task.updatedAt = nowIso();
    board.updatedAt = task.updatedAt;
    return newCheck;
  });
  return updated?.result ? updated.board : null;
}

export async function updateCheckOnTask(
  projectRoot: string,
  boardId: string,
  taskId: string,
  checkId: string,
  patch: Partial<Omit<KanbanCheck, 'id'>>,
): Promise<KanbanBoard | null> {
  const updated = await mutateBoard(projectRoot, boardId, (board) => {
    const task = findTask(board, taskId);
    const check = task?.successCriteria?.find((candidate) => candidate.id === checkId);
    if (!task || !check) return null;
    Object.assign(check, patch);
    if (patch.status && patch.status !== 'pending' && !check.checkedAt) {
      check.checkedAt = nowIso();
    }
    task.updatedAt = nowIso();
    board.updatedAt = task.updatedAt;
    return check;
  });
  return updated?.result ? updated.board : null;
}

export async function addNoteToTask(
  projectRoot: string,
  boardId: string,
  taskId: string,
  note: { author: string; content: string },
): Promise<KanbanBoard | null> {
  const updated = await mutateBoard(projectRoot, boardId, (board) => {
    const task = findTask(board, taskId);
    if (!task) return null;
    const newNote: KanbanNote = {
      id: randomUUID(),
      author: note.author,
      content: note.content,
      createdAt: nowIso(),
    };
    task.notes = [...(task.notes ?? []), newNote];
    task.updatedAt = nowIso();
    board.updatedAt = task.updatedAt;
    return newNote;
  });
  return updated?.result ? updated.board : null;
}

export async function addLinkToTask(
  projectRoot: string,
  boardId: string,
  taskId: string,
  link: KanbanLink,
): Promise<KanbanBoard | null> {
  const updated = await mutateBoard(projectRoot, boardId, (board) => {
    const task = findTask(board, taskId);
    if (!task) return null;
    task.links = [...(task.links ?? []), link];
    task.updatedAt = nowIso();
    board.updatedAt = task.updatedAt;
    return link;
  });
  return updated?.result ? updated.board : null;
}

export function generateBoardFromDescription(input: KanbanGenerationInput): CreateKanbanBoardInput {
  const title =
    input.title ??
    `Kanban: ${input.description.slice(0, 60)}${input.description.length > 60 ? '...' : ''}`;
  const columnTitles = input.columns?.length
    ? input.columns
    : DEFAULT_COLUMNS.slice(0, input.columnCount ?? 4).map((column) => column.title);
  return {
    title,
    description: input.context
      ? `${input.description}\n\nContext: ${input.context}`
      : input.description,
    columns: columnTitles.map((columnTitle, index) => ({
      id: slugify(columnTitle) || `column-${index + 1}`,
      title: columnTitle,
      order: index,
      wipLimit: 0,
    })),
    tasks: [],
  };
}

export function parseLinesIntoTasks(
  description: string,
  targetColumnId = 'backlog',
): CreateKanbanTaskInput[] {
  return description
    .split('\n')
    .map((line) => line.replace(/^\s*[-*#]\s*/, '').trim())
    .filter(Boolean)
    .map((title) => ({
      title,
      columnId: targetColumnId,
      priority: 'medium' as KanbanTaskPriority,
    }));
}

export async function searchKanban(
  projectRoot: string,
  input: KanbanSearchInput = {},
): Promise<KanbanSearchResult[]> {
  const query = input.query?.trim().toLowerCase();
  const boardIds = input.boardId
    ? [input.boardId]
    : (await listBoards(projectRoot)).map((b) => b.id);
  const results: KanbanSearchResult[] = [];
  for (const boardId of boardIds) {
    const board = await readBoard(projectRoot, boardId);
    if (!board) continue;
    for (const task of board.tasks) {
      if (input.assignedAgent && task.assignedAgent !== input.assignedAgent) continue;
      if (input.status && task.status !== input.status) continue;
      if (input.priority && task.priority !== input.priority) continue;
      if (input.label && !task.labels?.includes(input.label)) continue;
      if (
        query &&
        ![task.title, task.description, task.assignedAgent, task.assignee, ...(task.labels ?? [])]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query))
      ) {
        continue;
      }
      results.push({ board: summarizeBoard(board), task });
    }
  }
  return results;
}

export function areDependenciesMet(board: KanbanBoard, taskId: string): boolean {
  const task = findTask(board, taskId);
  if (!task?.dependsOn?.length) return true;
  return task.dependsOn.every((depId) => {
    const depTask = board.tasks.find((candidate) => candidate.id === depId);
    return depTask?.status === 'completed';
  });
}

export function findBlockedTasks(board: KanbanBoard, taskId: string): KanbanTask[] {
  const sourceTask = findTask(board, taskId);
  if (!sourceTask) return [];
  return board.tasks.filter(
    (task) => task.dependsOn?.includes(sourceTask.id) && task.status !== 'completed',
  );
}

export function exportBoardAsMarkdown(board: KanbanBoard): string {
  const lines: string[] = [`# ${board.title}`];
  if (board.description) lines.push('', board.description);
  if (board.tags?.length) lines.push('', `Tags: ${board.tags.map((tag) => `#${tag}`).join(' ')}`);
  for (const column of [...board.columns].sort((a, b) => a.order - b.order)) {
    lines.push('', `## ${column.title}`, '');
    const tasks = board.tasks
      .filter((task) => task.columnId === column.id)
      .sort((a, b) => a.order - b.order);
    if (!tasks.length) {
      lines.push('_Empty_');
      continue;
    }
    for (const task of tasks) {
      const checked = task.status === 'completed' ? 'x' : ' ';
      const assignee = task.assignedAgent ? ` @${task.assignedAgent}` : '';
      const priority = task.priority !== 'medium' ? ` !${task.priority}` : '';
      lines.push(`- [${checked}] ${task.title}${assignee}${priority}`);
      if (task.description) lines.push(`  ${task.description}`);
      if (task.assignment?.provider || task.assignment?.model || task.assignment?.fallbackProfile) {
        lines.push(
          `  agent: ${[
            task.assignment.provider,
            task.assignment.model,
            task.assignment.fallbackProfile ? `fallback=${task.assignment.fallbackProfile}` : '',
          ]
            .filter(Boolean)
            .join(' / ')}`,
        );
      }
      for (const check of task.successCriteria ?? []) {
        lines.push(`  - [${check.status === 'passed' ? 'x' : ' '}] ${check.description}`);
      }
    }
  }
  lines.push('', `---`, `Exported from WrongStack Kanban: ${board.id}`);
  return lines.join('\n');
}

function normalizeColumns(columns: KanbanColumn[] | undefined): KanbanColumn[] {
  const source = columns?.length ? columns : DEFAULT_COLUMNS;
  return source
    .map((column, index) => ({ ...column, order: column.order ?? index }))
    .sort((a, b) => a.order - b.order)
    .map((column, index) => ({ ...column, order: index }));
}

function createTaskObject(board: KanbanBoard, input: CreateKanbanTaskInput): KanbanTask {
  const now = nowIso();
  const columnId = existingColumnId(board, input.columnId) ?? board.columns[0]?.id ?? 'backlog';
  const order =
    input.order ??
    board.tasks
      .filter((task) => task.columnId === columnId)
      .reduce((max, task) => Math.max(max, task.order), -1) + 1;
  return {
    id: randomUUID(),
    title: input.title,
    columnId,
    order,
    priority: input.priority ?? 'medium',
    status: input.status ?? statusForColumn(columnId),
    createdAt: now,
    updatedAt: now,
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.assignedAgent !== undefined ? { assignedAgent: input.assignedAgent } : {}),
    ...(input.assignee !== undefined ? { assignee: input.assignee } : {}),
    ...(input.assignment !== undefined ? { assignment: input.assignment } : {}),
    ...(input.dependsOn !== undefined ? { dependsOn: input.dependsOn } : {}),
    ...(input.labels !== undefined ? { labels: input.labels } : {}),
    ...(input.estimatedHours !== undefined ? { estimatedHours: input.estimatedHours } : {}),
    ...(input.successCriteria !== undefined ? { successCriteria: input.successCriteria } : {}),
    ...(input.links !== undefined ? { links: input.links } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  };
}

function cloneTaskForBoard(
  board: KanbanBoard,
  source: KanbanTask,
  options: CopyKanbanTaskOptions,
): KanbanTask {
  const now = nowIso();
  const columnId =
    existingColumnId(board, options.targetColumnId ?? source.columnId) ??
    board.columns[0]?.id ??
    'backlog';
  const order =
    options.targetOrder ??
    board.tasks
      .filter((task) => task.columnId === columnId)
      .reduce((max, task) => Math.max(max, task.order), -1) + 1;
  return {
    id: randomUUID(),
    title: source.title,
    columnId,
    order,
    priority: source.priority,
    status: source.status,
    createdAt: now,
    updatedAt: now,
    ...(source.description !== undefined ? { description: source.description } : {}),
    ...(source.assignedAgent !== undefined && options.preserveAssignment === true
      ? { assignedAgent: source.assignedAgent }
      : {}),
    ...(source.assignee !== undefined && options.preserveAssignment === true
      ? { assignee: source.assignee }
      : {}),
    ...(source.assignment !== undefined && options.preserveAssignment === true
      ? { assignment: { ...source.assignment } }
      : {}),
    ...(source.dependsOn !== undefined && options.preserveDependencies === true
      ? { dependsOn: [...source.dependsOn] }
      : {}),
    ...(source.labels !== undefined ? { labels: [...source.labels] } : {}),
    ...(source.estimatedHours !== undefined ? { estimatedHours: source.estimatedHours } : {}),
    ...(source.actualHours !== undefined ? { actualHours: source.actualHours } : {}),
    ...(source.successCriteria !== undefined
      ? { successCriteria: source.successCriteria.map((check) => ({ ...check, id: randomUUID() })) }
      : {}),
    ...(source.links !== undefined ? { links: source.links.map((link) => ({ ...link })) } : {}),
    ...(source.notes !== undefined
      ? { notes: source.notes.map((note) => ({ ...note, id: randomUUID(), createdAt: now })) }
      : {}),
  };
}

function applyTaskPatch(board: KanbanBoard, task: KanbanTask, input: UpdateKanbanTaskInput): void {
  const now = nowIso();
  if (input.title !== undefined) task.title = input.title;
  if (input.description !== undefined) task.description = input.description;
  if (input.columnId !== undefined) {
    const columnId = existingColumnId(board, input.columnId);
    if (!columnId) throw new Error(`Column not found: ${input.columnId}`);
    task.columnId = columnId;
    if (input.status === undefined) task.status = statusForColumn(columnId);
  }
  if (input.order !== undefined) task.order = input.order;
  if (input.priority !== undefined) task.priority = input.priority;
  if (input.status !== undefined) {
    task.status = input.status;
    if (input.status === 'completed') task.completedAt = now;
    else delete task.completedAt;
  }
  if (input.assignedAgent !== undefined) {
    if (input.assignedAgent === null) delete task.assignedAgent;
    else task.assignedAgent = input.assignedAgent;
  }
  if (input.assignee !== undefined) {
    if (input.assignee === null) delete task.assignee;
    else task.assignee = input.assignee;
  }
  if (input.assignment !== undefined) {
    if (input.assignment === null) delete task.assignment;
    else task.assignment = input.assignment;
  }
  if (input.dependsOn !== undefined) task.dependsOn = input.dependsOn;
  if (input.labels !== undefined) task.labels = input.labels;
  if (input.estimatedHours !== undefined) task.estimatedHours = input.estimatedHours;
  if (input.actualHours !== undefined) task.actualHours = input.actualHours;
  if (input.successCriteria !== undefined) task.successCriteria = input.successCriteria;
  if (input.links !== undefined) task.links = input.links;
  task.updatedAt = now;
  board.updatedAt = now;
}

function buildAssignment(input: AssignKanbanTaskInput): KanbanAgentAssignment {
  return {
    status: input.status ?? 'assigned',
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

function findTask(board: KanbanBoard, taskId: string): KanbanTask | undefined {
  const exact = board.tasks.find((task) => task.id === taskId);
  if (exact) return exact;
  const matches = board.tasks.filter((task) => task.id.startsWith(taskId));
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous kanban task id "${taskId}": ${matches
        .slice(0, 5)
        .map((task) => task.id)
        .join(', ')}`,
    );
  }
  return matches[0];
}

function hasDependencyPath(
  board: KanbanBoard,
  fromTaskId: string,
  toTaskId: string,
  seen = new Set<string>(),
): boolean {
  if (fromTaskId === toTaskId) return true;
  if (seen.has(fromTaskId)) return false;
  seen.add(fromTaskId);
  const task = board.tasks.find((candidate) => candidate.id === fromTaskId);
  if (!task?.dependsOn?.length) return false;
  return task.dependsOn.some((depId) => hasDependencyPath(board, depId, toTaskId, seen));
}

function existingColumnId(board: KanbanBoard, columnId: string | undefined): string | undefined {
  if (!columnId) return undefined;
  return board.columns.find((column) => column.id === columnId || column.id.startsWith(columnId))
    ?.id;
}

function uniqueColumnId(board: KanbanBoard, requested: string): string {
  const base = slugify(requested) || 'column';
  let candidate = base;
  let suffix = 2;
  while (board.columns.some((column) => column.id === candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function statusForColumn(columnId: string): KanbanTaskStatus {
  const normalized = columnId.toLowerCase();
  if (normalized.includes('done') || normalized.includes('complete')) return 'completed';
  if (normalized.includes('progress') || normalized.includes('doing')) return 'in_progress';
  if (normalized.includes('review')) return 'review';
  if (normalized.includes('block')) return 'blocked';
  if (normalized.includes('ready')) return 'ready';
  return 'pending';
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function nowIso(): string {
  return new Date().toISOString();
}
