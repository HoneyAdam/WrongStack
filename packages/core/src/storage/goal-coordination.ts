import { updateTask } from '@wrongstack/kanban';
import type { BrainArbiter } from '../coordination/brain.js';
import type { EventBus } from '../kernel/events.js';
import {
  appendJournal,
  loadGoal,
  recordProgress,
  saveGoal,
  type GoalFile,
} from './goal-store.js';
import {
  findGoalBoardByTag,
  findGoalKanbanBoard,
  type GoalFileWithKanban,
} from './goal-kanban.js';

const DONE_MARKER = /\[done:\s*([^\]]+)\]/gi;
const DONE_PREFIX = /^\s*(?:✅|\[[x✓]\]|\(done\))\s*/i;

export interface CompletedGoalDeliverable {
  index: number;
  text: string;
}

export interface GoalCoordinationResult {
  goal: GoalFile;
  completed: CompletedGoalDeliverable[];
  kanbanUpdatedTaskIds: string[];
  reached: boolean;
}

export interface CoordinateGoalIterationOptions {
  projectRoot: string;
  goalPath: string;
  finalText: string;
  brain?: BrainArbiter | undefined;
  sessionId?: string | undefined;
  events?: EventBus | undefined;
  now?: (() => Date) | undefined;
}

/**
 * Parse optional `[DONE: index]` / `[DONE: text-prefix]` markers emitted by an
 * autonomy iteration. Numeric indices are human-facing and therefore 1-based;
 * `0` is accepted as an explicit first-item alias for backwards compatibility.
 */
export function parseCompletedGoalDeliverables(
  finalText: string,
  deliverables: readonly string[],
): CompletedGoalDeliverable[] {
  if (!finalText || deliverables.length === 0) return [];
  const seen = new Set<number>();
  const completed: CompletedGoalDeliverable[] = [];

  for (const match of finalText.matchAll(DONE_MARKER)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    const numeric = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : undefined;
    let index = numeric === undefined ? -1 : numeric === 0 ? 0 : numeric - 1;
    if (index < 0 || index >= deliverables.length) {
      const prefix = raw.toLowerCase();
      index = deliverables.findIndex((item) =>
        stripGoalDeliverableMarker(item).toLowerCase().startsWith(prefix),
      );
    }
    if (index < 0 || index >= deliverables.length || seen.has(index)) continue;
    const source = deliverables[index] ?? '';
    if (isGoalDeliverableComplete(source)) continue;
    seen.add(index);
    completed.push({ index, text: stripGoalDeliverableMarker(source) });
  }
  return completed;
}

export function isGoalDeliverableComplete(value: string): boolean {
  return DONE_PREFIX.test(value);
}

export function stripGoalDeliverableMarker(value: string): string {
  return value.replace(DONE_PREFIX, '').trim();
}

/** Mark newly completed deliverables and recompute progress from the checklist. */
export function applyGoalDeliverableCompletions(
  goal: GoalFile,
  completed: readonly CompletedGoalDeliverable[],
): GoalFile {
  if (completed.length === 0) return recomputeGoalProgress(goal);
  const completedIndices = new Set(completed.map((item) => item.index));
  let next: GoalFile = {
    ...goal,
    deliverables: (goal.deliverables ?? []).map((item, index) =>
      completedIndices.has(index) && !isGoalDeliverableComplete(item) ? `✅ ${item}` : item,
    ),
  };
  for (const item of completed) {
    next = appendJournal(next, {
      source: 'deliverable',
      task: `Deliverable completed: ${item.text}`.slice(0, 240),
      status: 'success',
      note: `[DONE: ${item.index + 1}]`,
    });
  }
  return recomputeGoalProgress(next);
}

export function recomputeGoalProgress(goal: GoalFile): GoalFile {
  const deliverables = goal.deliverables ?? [];
  if (deliverables.length === 0) return goal;
  const done = deliverables.filter(isGoalDeliverableComplete).length;
  const progress = Math.round((done / deliverables.length) * 100);
  return recordProgress(goal, progress, `${done}/${deliverables.length} deliverables complete`);
}

/**
 * Close the marker → Kanban → progress → Brain loop and persist the resulting
 * goal state. Brain is called exactly once, and only when every deliverable is
 * complete. A missing/negative Brain leaves the goal active at 100%.
 */
export async function coordinateGoalIteration(
  options: CoordinateGoalIterationOptions,
): Promise<GoalCoordinationResult | null> {
  const current = await loadGoal(options.goalPath, options.events);
  if (!current) return null;

  const completed = parseCompletedGoalDeliverables(
    options.finalText,
    current.deliverables ?? [],
  );
  let goal = applyGoalDeliverableCompletions(current, completed);
  await saveGoal(options.goalPath, goal, options.events);

  const kanbanUpdatedTaskIds = await refreshGoalKanban(
    options.projectRoot,
    goal,
    completed,
  );
  goal = await recomputeGoalProgressFromKanban(options.projectRoot, goal);

  let reached = false;
  const allComplete =
    (goal.deliverables?.length ?? 0) > 0 &&
    goal.deliverables?.every(isGoalDeliverableComplete) === true;
  if (allComplete && options.brain) {
    const decision = await options.brain.decide({
      id: `goal-reached-${goal.iterations}`,
      sessionId: options.sessionId,
      source: 'system',
      question: 'Have all goal deliverables been reached and verified?',
      context: [
        `Goal: ${goal.refinedGoal ?? goal.goal}`,
        `Progress: ${goal.progress ?? 0}%`,
        'Completed deliverables:',
        ...(goal.deliverables ?? []).map((item, index) =>
          `${index + 1}. ${stripGoalDeliverableMarker(item)}`,
        ),
      ].join('\n'),
      risk: 'high',
      fallback: 'continue',
      options: [
        {
          id: 'goal_reached',
          label: 'Goal reached',
          consequence: 'Persist the completed goal and stop the eternal loop.',
        },
        {
          id: 'keep_working',
          label: 'Keep working',
          consequence: 'Leave the goal active for another iteration.',
        },
      ],
    });
    reached = decision.type === 'answer' && decision.optionId === 'goal_reached';
  }

  if (reached) {
    const reachedAt = (options.now?.() ?? new Date()).toISOString();
    goal = appendJournal(
      {
        ...goal,
        goalState: 'completed',
        engineState: 'stopped',
        progress: 100,
        progressNote: 'goal reached',
        reachedAt,
        reachedNote: 'goal reached',
      },
      {
        source: 'deliverable',
        task: 'GOAL REACHED',
        status: 'success',
        note: 'goal reached',
      },
    );
  }
  await saveGoal(options.goalPath, goal, options.events);
  return { goal, completed, kanbanUpdatedTaskIds, reached };
}

async function resolveGoalBoard(projectRoot: string, goal: GoalFile) {
  const boardId = (goal as GoalFileWithKanban).kanbanBoardId;
  if (boardId) {
    const board = await findGoalKanbanBoard(projectRoot, boardId);
    if (board) return board;
  }
  return findGoalBoardByTag(projectRoot, goal);
}

async function refreshGoalKanban(
  projectRoot: string,
  goal: GoalFile,
  completed: readonly CompletedGoalDeliverable[],
): Promise<string[]> {
  if (completed.length === 0) return [];
  const board = await resolveGoalBoard(projectRoot, goal);
  if (!board) return [];
  const doneColumn = board.columns.find((column) => column.title.toLowerCase() === 'done');
  if (!doneColumn) return [];
  const completedTitles = new Set(completed.map((item) => normalizeTitle(item.text)));
  const updated: string[] = [];
  for (const task of board.tasks) {
    if (!completedTitles.has(normalizeTitle(task.title))) continue;
    const result = await updateTask(
      projectRoot,
      board.id,
      task.id,
      { columnId: doneColumn.id, status: 'completed' },
      {
        actor: 'goal-coordinator',
        note: 'deliverable-completed: Updated from [DONE:] marker.',
      },
    );
    if (result) updated.push(task.id);
  }
  return updated;
}

async function recomputeGoalProgressFromKanban(
  projectRoot: string,
  goal: GoalFile,
): Promise<GoalFile> {
  const board = await resolveGoalBoard(projectRoot, goal);
  if (!board || !goal.deliverables?.length) return recomputeGoalProgress(goal);
  const completedTitles = new Set(
    board.tasks
      .filter((task) => task.status === 'completed')
      .map((task) => normalizeTitle(task.title)),
  );
  const deliverables = goal.deliverables.map((item) => {
    if (isGoalDeliverableComplete(item)) return item;
    return completedTitles.has(normalizeTitle(item)) ? `✅ ${item}` : item;
  });
  return recomputeGoalProgress({ ...goal, deliverables });
}

function normalizeTitle(value: string): string {
  return stripGoalDeliverableMarker(value).replace(/\s+/g, ' ').trim().toLowerCase();
}
