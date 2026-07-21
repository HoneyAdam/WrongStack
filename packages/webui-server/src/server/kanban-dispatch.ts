import type { Context } from '@wrongstack/core';
import {
  assignTask,
  getBoard,
  type KanbanBoard,
  type KanbanEventContext,
  type KanbanTask,
  listBoards,
  reconcileKanbanBoard,
  updateTaskAssignment,
} from '@wrongstack/kanban';
import type { WebSocket } from 'ws';
import type { WSServerMessage } from './types.js';
import { send } from './ws-utils.js';

export interface KanbanDispatchResult {
  status: 'completed' | 'failed';
  result?: string | undefined;
  error?: string | undefined;
}

export type KanbanTaskDispatcher = (
  description: string,
  opts?: {
    provider?: string | undefined;
    model?: string | undefined;
    fallbackModels?: string[] | undefined;
    fallbackProfile?: string | undefined;
    skills?: string[] | undefined;
    tools?: string[] | undefined;
    name?: string | undefined;
    allowedCapabilities?: readonly string[] | undefined;
    context?:
      | {
          kanban?: { boardId?: string; taskId?: string; projectRoot?: string };
        }
      | undefined;
    onDone?: ((result: KanbanDispatchResult) => void | Promise<void>) | undefined;
  },
) => Promise<string>;

export interface KanbanDispatchContext {
  projectRoot: string;
  context?: Context | undefined;
  broadcast?: ((message: WSServerMessage) => void) | undefined;
  dispatchTask?: KanbanTaskDispatcher | undefined;
}

export interface ResolvedDispatchRoute {
  provider?: string | undefined;
  model?: string | undefined;
  fallbackProfile?: string | undefined;
  fallbackModels?: string[] | undefined;
}

export function parseResolvedDispatchRoute(summary: string): ResolvedDispatchRoute {
  const tags = summary.match(/Spawned subagent\s+\S+\s+\((.*?)\)\s+for task/i)?.[1];
  if (!tags) return {};
  const parts = tags.split(/\s+\/\s+/).map((part) => part.trim());
  const positional = parts.filter((part) => !part.includes('=') && !part.startsWith('"'));
  const fallbackProfile = parts.find((part) => part.startsWith('profile='))?.slice(8);
  const fallback = parts.find((part) => part.startsWith('fallback='))?.slice(9);
  return {
    ...(positional[0] ? { provider: positional[0] } : {}),
    ...(positional[1] ? { model: positional[1] } : {}),
    ...(fallbackProfile ? { fallbackProfile } : {}),
    ...(fallback ? { fallbackModels: fallback.split(',').filter(Boolean) } : {}),
  };
}

function reply(ws: WebSocket, type: string, success: boolean, value: unknown): void {
  send(ws, {
    type,
    payload: success ? { success: true, data: value } : { success: false, error: String(value) },
  });
}

function activityContext(ctx: KanbanDispatchContext, note?: string): KanbanEventContext {
  const sessionId = ctx.context?.session?.id;
  return {
    ...(sessionId ? { sessionId } : {}),
    ...(note?.trim() ? { note: note.trim() } : {}),
  };
}

export async function handleKanbanTaskDispatch(
  ws: WebSocket,
  payload: Record<string, unknown> | undefined,
  ctx: KanbanDispatchContext,
): Promise<void> {
  const boardId = payload?.boardId as string | undefined;
  const taskId = payload?.taskId as string | undefined;
  if (!boardId || !taskId) {
    reply(ws, 'kanban.task.dispatch', false, 'boardId and taskId required');
    return;
  }
  if (!ctx.dispatchTask) {
    reply(
      ws,
      'kanban.task.dispatch',
      false,
      'Kanban agent dispatch is not available in this runtime',
    );
    return;
  }
  const board = await getBoard(ctx.projectRoot, boardId);
  const task = board ? findTask(board.tasks, taskId) : undefined;
  if (!board || !task) {
    reply(ws, 'kanban.task.dispatch', false, 'Board or task not found');
    return;
  }

  const modelRouting =
    (payload?.modelRouting as 'session' | 'fixed' | 'fallback_profile' | undefined) ??
    task.assignment?.modelRouting ??
    (payload?.provider || payload?.model || task.assignment?.provider || task.assignment?.model
      ? 'fixed'
      : 'session');
  const useSessionModel = modelRouting === 'session';
  const assignment = {
    agentId:
      (payload?.agentId as string | undefined) ?? task.assignment?.agentId ?? task.assignedAgent,
    name: (payload?.name as string | undefined) ?? task.assignment?.name ?? task.assignedAgent,
    role: (payload?.role as string | undefined) ?? task.assignment?.role,
    modelRouting,
    provider: useSessionModel
      ? ctx.context?.provider.id
      : ((payload?.provider as string | undefined) ?? task.assignment?.provider),
    model: useSessionModel
      ? ctx.context?.model
      : ((payload?.model as string | undefined) ?? task.assignment?.model),
    fallbackProfile:
      modelRouting === 'fallback_profile'
        ? ((payload?.fallbackProfile as string | undefined) ?? task.assignment?.fallbackProfile)
        : undefined,
    fallbackModels:
      (payload?.fallbackModels as string[] | undefined) ?? task.assignment?.fallbackModels,
    skills: (payload?.skills as string[] | undefined) ?? task.assignment?.skills,
    tools: (payload?.tools as string[] | undefined) ?? task.assignment?.tools,
    allowedCapabilities:
      (payload?.allowedCapabilities as string[] | undefined) ??
      task.assignment?.allowedCapabilities,
    maxAttempts: (payload?.maxAttempts as number | undefined) ?? task.assignment?.maxAttempts,
    costCeilingUsd:
      (payload?.costCeilingUsd as number | undefined) ??
      task.assignment?.costCeilingUsd ??
      task.costCeilingUsd,
    retryPolicy:
      (payload?.retryPolicy as KanbanTask['retryPolicy'] | undefined) ??
      task.assignment?.retryPolicy ??
      task.retryPolicy,
    attempt: (task.assignment?.attempt ?? 0) + 1,
    status: 'queued' as const,
    dispatchedAt: new Date().toISOString(),
  };
  await assignTask(
    ctx.projectRoot,
    boardId,
    task.id,
    assignment,
    activityContext(ctx, payload?.activityNote as string | undefined),
  );

  try {
    const summary = await ctx.dispatchTask(buildKanbanAgentPrompt(board, task, assignment), {
      ...(assignment.provider ? { provider: assignment.provider } : {}),
      ...(assignment.model ? { model: assignment.model } : {}),
      ...(assignment.fallbackModels ? { fallbackModels: assignment.fallbackModels } : {}),
      ...(assignment.fallbackProfile ? { fallbackProfile: assignment.fallbackProfile } : {}),
      ...(assignment.skills ? { skills: assignment.skills } : {}),
      ...(assignment.tools ? { tools: assignment.tools } : {}),
      ...(assignment.name ? { name: assignment.name } : {}),
      ...(assignment.allowedCapabilities
        ? { allowedCapabilities: assignment.allowedCapabilities }
        : {}),
      context: { kanban: { boardId, taskId: task.id, projectRoot: ctx.projectRoot } },
      onDone: async (result) => {
        await updateTaskAssignment(
          ctx.projectRoot,
          boardId,
          task.id,
          {
            ...assignment,
            status: result.status,
            ...(result.result !== undefined ? { lastResult: result.result } : {}),
            ...(result.error !== undefined ? { error: result.error } : {}),
          },
          activityContext(ctx),
        );
        const reconciled = await reconcileKanbanBoard(ctx.projectRoot, boardId);
        const completed = reconciled?.board ?? (await getBoard(ctx.projectRoot, boardId));
        const completedTask =
          completed?.tasks.find((candidate) => candidate.id === task.id) ?? task;
        ctx.broadcast?.({
          type: 'kanban.task.update',
          payload: { success: true, data: { boardId: board.id, task: completedTask } },
        });
        if (completed) {
          ctx.broadcast?.({
            type: 'kanban.get',
            payload: { success: true, data: { board: completed } },
          });
        }
        ctx.broadcast?.({
          type: 'kanban.list',
          payload: { success: true, data: await listBoards(ctx.projectRoot) },
        });
      },
    });
    const subagentId = summary.match(/Spawned subagent\s+([^\s]+)/)?.[1];
    const runTaskId = summary.match(/\bfor task\s+([^\s.]+)/i)?.[1];
    const resolvedRoute = parseResolvedDispatchRoute(summary);
    const updated = await updateTaskAssignment(
      ctx.projectRoot,
      boardId,
      task.id,
      {
        ...assignment,
        ...resolvedRoute,
        status: 'running',
        ...(subagentId ? { subagentId } : {}),
        ...(runTaskId ? { runTaskId } : {}),
        lastResult: summary,
      },
      activityContext(ctx),
    );
    const runningTask = updated?.tasks.find((candidate) => candidate.id === task.id) ?? task;
    ctx.broadcast?.({
      type: 'kanban.task.update',
      payload: { success: true, data: { boardId: board.id, task: runningTask } },
    });
    if (updated) {
      ctx.broadcast?.({ type: 'kanban.get', payload: { success: true, data: { board: updated } } });
    }
    reply(ws, 'kanban.task.dispatch', true, { boardId: board.id, task: runningTask, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateTaskAssignment(
      ctx.projectRoot,
      boardId,
      task.id,
      { ...assignment, status: 'failed', error: message },
      activityContext(ctx),
    );
    reply(ws, 'kanban.task.dispatch', false, message);
  }
}

function buildKanbanAgentPrompt(
  board: Pick<KanbanBoard, 'id' | 'title' | 'tasks'>,
  task: KanbanTask,
  assignment: KanbanTask['assignment'],
): string {
  const dependencies = (task.dependsOn ?? [])
    .map((dependencyId) => board.tasks.find((candidate) => candidate.id === dependencyId))
    .filter((dependency): dependency is KanbanTask => Boolean(dependency))
    .map((dependency) => `- ${dependency.title} [${dependency.status}] (${dependency.id})`);
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
    assignment?.modelRouting ? `modelRouting: ${assignment.modelRouting}` : '',
    assignment?.provider ? `provider: ${assignment.provider}` : '',
    assignment?.model ? `model: ${assignment.model}` : '',
    assignment?.fallbackProfile ? `fallbackProfile: ${assignment.fallbackProfile}` : '',
    assignment?.fallbackModels?.length
      ? `fallbackModels: ${assignment.fallbackModels.join(', ')}`
      : '',
    assignment?.skills?.length ? `skills: ${assignment.skills.join(', ')}` : '',
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
