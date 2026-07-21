import {
  addPlanItem,
  emptyPlan,
  getPlanTemplate,
  loadPlan,
  loadTasks,
  mutatePlan,
  mutateTasks,
  savePlan,
  setPlanItemStatus,
  type TodoItem,
} from '@wrongstack/core';
import type { WebSocket } from 'ws';
import type { WSServerMessage } from '../types.js';
import { validatePlanTemplateUsePayload } from '../ws-payload-validation.js';

export interface WorklistContext {
  context: {
    todos: TodoItem[];
    meta: Record<string, unknown>;
    session: { id: string } | null;
  };
  send: (ws: WebSocket, msg: WSServerMessage) => void;
  broadcast: (msg: WSServerMessage) => void;
  replaceTodos?: ((todos: TodoItem[]) => void) | undefined;
}

export interface WorklistMessage {
  type: string;
  payload?: unknown;
}

function sendResult(ctx: WorklistContext, ws: WebSocket, success: boolean, message: string): void {
  ctx.send(ws, { type: 'key.operation_result', payload: { success, message } });
}

function currentSessionId(ctx: WorklistContext): string {
  return ctx.context.session?.id ?? '';
}

function sessionPayload<T extends Record<string, unknown>>(
  ctx: WorklistContext,
  payload: T,
): T & { sessionId: string } {
  const provided = payload['sessionId'];
  const sessionId =
    typeof provided === 'string' && provided.length > 0 ? provided : currentSessionId(ctx);
  return { ...payload, sessionId };
}

function planPathOf(ctx: WorklistContext): string | undefined {
  const value = ctx.context.meta['plan.path'];
  return typeof value === 'string' && value ? value : undefined;
}

function taskPathOf(ctx: WorklistContext): string | undefined {
  const value = ctx.context.meta['task.path'];
  return typeof value === 'string' && value ? value : undefined;
}

export function handleTodosGet(ctx: WorklistContext, ws: WebSocket): void {
  ctx.send(ws, {
    type: 'todos.updated',
    payload: sessionPayload(ctx, { todos: [...ctx.context.todos] }),
  });
}

export function handleTodosClear(ctx: WorklistContext, ws: WebSocket): void {
  ctx.replaceTodos?.([]);
  sendResult(ctx, ws, true, 'Todos cleared');
  ctx.broadcast({ type: 'todos.updated', payload: sessionPayload(ctx, { todos: [] }) });
}

export function handleTodosRemove(
  ctx: WorklistContext,
  ws: WebSocket,
  payload: { id?: string | undefined; index?: number | undefined } | undefined,
): void {
  if (!payload) {
    sendResult(ctx, ws, false, 'Missing id or index');
    return;
  }
  const todos = ctx.context.todos;
  let targetIndex = -1;
  if (typeof payload.id === 'string') {
    targetIndex = todos.findIndex((todo) => todo.id === payload.id);
  } else if (typeof payload.index === 'number' && payload.index > 0) {
    targetIndex = payload.index - 1;
  }
  const removed = todos[targetIndex];
  if (targetIndex < 0 || !removed) {
    sendResult(ctx, ws, false, 'Todo not found');
    return;
  }
  const next = [...todos.slice(0, targetIndex), ...todos.slice(targetIndex + 1)];
  ctx.replaceTodos?.(next);
  sendResult(ctx, ws, true, `Removed: ${removed.content}`);
  ctx.broadcast({ type: 'todos.updated', payload: sessionPayload(ctx, { todos: next }) });
}

export function handleTodoUpdate(
  ctx: WorklistContext,
  ws: WebSocket,
  payload: { id: string; status?: TodoItem['status'] | undefined; activeForm?: string | undefined },
): void {
  const index = ctx.context.todos.findIndex((todo) => todo.id === payload.id);
  const existing = ctx.context.todos[index];
  if (index === -1 || !existing) {
    sendResult(ctx, ws, false, 'Todo not found');
    return;
  }
  const next = [...ctx.context.todos];
  next[index] = {
    ...existing,
    status: payload.status ?? existing.status,
    activeForm: payload.activeForm !== undefined ? payload.activeForm : existing.activeForm,
  };
  ctx.replaceTodos?.(next);
  sendResult(ctx, ws, true, `Todo "${existing.content}" updated`);
  ctx.broadcast({ type: 'todos.updated', payload: sessionPayload(ctx, { todos: next }) });
}

export async function handleTasksGet(ctx: WorklistContext, ws: WebSocket): Promise<void> {
  const taskPath = taskPathOf(ctx);
  if (!taskPath) {
    ctx.send(ws, {
      type: 'tasks.updated',
      payload: sessionPayload(ctx, { tasks: [], error: 'Task storage not configured.' }),
    });
    return;
  }
  try {
    const file = await loadTasks(taskPath);
    ctx.send(ws, {
      type: 'tasks.updated',
      payload: sessionPayload(ctx, { tasks: file?.tasks ?? [] }),
    });
  } catch {
    ctx.send(ws, { type: 'tasks.updated', payload: sessionPayload(ctx, { tasks: [] }) });
  }
}

export async function handleTaskUpdate(
  ctx: WorklistContext,
  ws: WebSocket,
  payload: {
    id: string;
    status: 'pending' | 'in_progress' | 'blocked' | 'failed' | 'review' | 'completed';
  },
): Promise<void> {
  const taskPath = taskPathOf(ctx);
  if (!taskPath) {
    sendResult(ctx, ws, false, 'Task storage not configured.');
    return;
  }
  try {
    const file = await mutateTasks(taskPath, currentSessionId(ctx), async (tasks) => {
      const task = tasks.tasks.find((candidate) => candidate.id === payload.id);
      if (!task) return tasks;
      task.status = payload.status;
      task.updatedAt = new Date().toISOString();
      return tasks;
    });
    sendResult(ctx, ws, true, `Task status updated to "${payload.status}".`);
    ctx.broadcast({
      type: 'tasks.updated',
      payload: sessionPayload(ctx, { tasks: file.tasks }),
    });
  } catch (error) {
    sendResult(ctx, ws, false, error instanceof Error ? error.message : String(error));
  }
}

export async function handlePlanGet(ctx: WorklistContext, ws: WebSocket): Promise<void> {
  const planPath = planPathOf(ctx);
  const emptySnapshot = () => ({
    version: 1,
    sessionId: currentSessionId(ctx),
    updatedAt: new Date().toISOString(),
    items: [],
  });
  if (!planPath) {
    ctx.send(ws, {
      type: 'plan.updated',
      payload: sessionPayload(ctx, {
        plan: null,
        error: 'Plan storage is not configured for this session.',
      }),
    });
    return;
  }
  try {
    const plan = await loadPlan(planPath);
    ctx.send(ws, {
      type: 'plan.updated',
      payload: sessionPayload(ctx, { plan: plan ?? emptySnapshot() }),
    });
  } catch {
    ctx.send(ws, {
      type: 'plan.updated',
      payload: sessionPayload(ctx, { plan: emptySnapshot() }),
    });
  }
}

export async function handlePlanTemplateUse(
  ctx: WorklistContext,
  ws: WebSocket,
  template: string,
): Promise<void> {
  const planPath = planPathOf(ctx);
  if (!planPath) {
    sendResult(ctx, ws, false, 'Plan storage is not configured for this session.');
    return;
  }
  try {
    const templateDefinition = getPlanTemplate(template);
    if (!templateDefinition) {
      sendResult(ctx, ws, false, `Unknown template "${template}".`);
      return;
    }
    let plan = (await loadPlan(planPath)) ?? emptyPlan(currentSessionId(ctx));
    for (const item of templateDefinition.items) {
      ({ plan } = addPlanItem(plan, item.title, item.details));
    }
    await savePlan(planPath, plan);
    sendResult(
      ctx,
      ws,
      true,
      `Applied template "${templateDefinition.name}" — ${templateDefinition.items.length} items added.`,
    );
    ctx.broadcast({ type: 'plan.updated', payload: sessionPayload(ctx, { plan }) });
  } catch (error) {
    sendResult(ctx, ws, false, error instanceof Error ? error.message : String(error));
  }
}

export async function handlePlanItemUpdate(
  ctx: WorklistContext,
  ws: WebSocket,
  payload: { target: string; status: 'open' | 'in_progress' | 'done' },
): Promise<void> {
  const planPath = planPathOf(ctx);
  if (!planPath) {
    sendResult(ctx, ws, false, 'Plan storage is not configured for this session.');
    return;
  }
  try {
    let changed = false;
    const plan = await mutatePlan(planPath, currentSessionId(ctx), async (currentPlan) => {
      const before = currentPlan.updatedAt;
      const next = setPlanItemStatus(currentPlan, payload.target, payload.status);
      changed = next.updatedAt !== before;
      return next;
    });
    if (!changed) {
      sendResult(ctx, ws, false, `No plan item matched "${payload.target}".`);
      return;
    }
    sendResult(ctx, ws, true, `Plan item status updated to "${payload.status}".`);
    ctx.broadcast({ type: 'plan.updated', payload: sessionPayload(ctx, { plan }) });
  } catch (error) {
    sendResult(ctx, ws, false, error instanceof Error ? error.message : String(error));
  }
}

export async function handleWorklistMessage(
  ctx: WorklistContext,
  ws: WebSocket,
  message: WorklistMessage,
): Promise<void> {
  switch (message.type) {
    case 'todos.get':
      handleTodosGet(ctx, ws);
      return;
    case 'todos.clear':
      handleTodosClear(ctx, ws);
      return;
    case 'todos.remove':
      handleTodosRemove(ctx, ws, message.payload as { id?: string; index?: number } | undefined);
      return;
    case 'todo.update':
      handleTodoUpdate(
        ctx,
        ws,
        message.payload as {
          id: string;
          status?: TodoItem['status'];
          activeForm?: string;
        },
      );
      return;
    case 'tasks.get':
      await handleTasksGet(ctx, ws);
      return;
    case 'task.update':
      await handleTaskUpdate(
        ctx,
        ws,
        message.payload as {
          id: string;
          status: 'pending' | 'in_progress' | 'blocked' | 'failed' | 'review' | 'completed';
        },
      );
      return;
    case 'plan.get':
      await handlePlanGet(ctx, ws);
      return;
    case 'plan.template_use': {
      const parsed = validatePlanTemplateUsePayload(message.payload);
      if (!parsed.ok) {
        sendResult(ctx, ws, false, parsed.message);
        return;
      }
      await handlePlanTemplateUse(ctx, ws, parsed.value.template);
      return;
    }
    case 'plan.item.update':
      await handlePlanItemUpdate(
        ctx,
        ws,
        message.payload as { target: string; status: 'open' | 'in_progress' | 'done' },
      );
  }
}
