import { handleWorklistRoute, type WorklistRouteHandlers } from '@wrongstack/webui-server';
import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';

const ws = {} as WebSocket;

function handlers(): WorklistRouteHandlers {
  return {
    getTodos: vi.fn(),
    clearTodos: vi.fn(),
    removeTodo: vi.fn(),
    updateTodo: vi.fn(),
    getTasks: vi.fn(),
    updateTask: vi.fn(),
    getPlan: vi.fn(),
    usePlanTemplate: vi.fn(),
    updatePlanItem: vi.fn(),
  };
}

describe('handleWorklistRoute', () => {
  it.each([
    ['todos.get', 'getTodos'],
    ['todos.clear', 'clearTodos'],
    ['todos.remove', 'removeTodo'],
    ['todo.update', 'updateTodo'],
    ['tasks.get', 'getTasks'],
    ['task.update', 'updateTask'],
    ['plan.get', 'getPlan'],
    ['plan.template_use', 'usePlanTemplate'],
    ['plan.item.update', 'updatePlanItem'],
  ] as const)('dispatches %s through the canonical route', async (type, handlerName) => {
    const routeHandlers = handlers();
    const msg = { type, payload: {} };

    await expect(handleWorklistRoute(ws, msg, routeHandlers)).resolves.toBe(true);

    expect(routeHandlers[handlerName]).toHaveBeenCalledWith(ws, msg);
  });

  it('does not claim unrelated messages', async () => {
    await expect(handleWorklistRoute(ws, { type: 'providers.list' }, handlers())).resolves.toBe(
      false,
    );
  });
});
