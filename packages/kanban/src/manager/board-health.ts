import { listBoardSummaries } from '../storage.js';
import type { KanbanBoard } from '../types.js';
import { getBoard } from './boards.js';

/** Read-only board collection kept outside the mutation helper layer. */
export async function collectBoardsForHealth(
  projectRoot: string,
  boardId: string | undefined,
): Promise<KanbanBoard[]> {
  if (boardId !== undefined) {
    const board = await getBoard(projectRoot, boardId);
    return board ? [board] : [];
  }
  const summaries = await listBoardSummaries(projectRoot);
  const boards: KanbanBoard[] = [];
  for (const summary of summaries) {
    const board = await getBoard(projectRoot, summary.id);
    if (board) boards.push(board);
  }
  return boards;
}
