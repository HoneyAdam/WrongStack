import type { KanbanBoard } from '../types.js';
import { findTask } from './task-lookup.js';

/**
 * Dependency readiness is a leaf-domain rule shared by mutations and queries.
 * Accepts either a full task id or a unique prefix (delegated to `findTask`).
 */
export function areDependenciesMet(board: KanbanBoard, taskId: string): boolean {
  const task = findTask(board, taskId);
  if (!task?.dependsOn?.length) return true;
  return task.dependsOn.every((dependencyId) => {
    const depTask = findTask(board, dependencyId);
    return depTask?.status === 'completed';
  });
}
