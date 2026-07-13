import { readBoard, summarizeBoard } from '../storage.js';
import {
  type CreateKanbanBoardInput,
  type CreateKanbanTaskInput,
  DEFAULT_COLUMNS,
  type KanbanBoard,
  type KanbanGenerationInput,
  type KanbanSearchInput,
  type KanbanSearchResult,
  type KanbanTaskPriority,
} from '../types.js';
import { listBoards } from './boards.js';
import { matchesKanbanSearch, slugify } from './_internal.js';

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
  const boardIds = input.boardId
    ? [input.boardId]
    : (await listBoards(projectRoot)).map((b) => b.id);
  const results: KanbanSearchResult[] = [];
  for (const boardId of boardIds) {
    const board = await readBoard(projectRoot, boardId);
    if (!board) continue;
    for (const task of board.tasks) {
      if (!matchesKanbanSearch(board, task, input)) continue;
      results.push({ board: summarizeBoard(board), task });
    }
  }
  return results;
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
