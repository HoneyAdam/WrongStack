import { handleKanbanHostRoute, type KanbanHostRouteHandlers } from '@wrongstack/webui-server';
import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';

const ws = {} as WebSocket;

function handlers(): KanbanHostRouteHandlers {
  return {
    meta: vi.fn(),
    supervisorStatus: vi.fn(),
    supervisorAudit: vi.fn(),
    runStart: vi.fn(),
  };
}

describe('handleKanbanHostRoute', () => {
  it.each([
    ['kanban.meta', 'meta'],
    ['kanban.supervisor.status', 'supervisorStatus'],
    ['kanban.supervisor.audit', 'supervisorAudit'],
    ['kanban.run.start', 'runStart'],
  ] as const)('dispatches %s to the host capability', async (type, handlerName) => {
    const routeHandlers = handlers();
    const msg = { type, payload: {} };

    await expect(handleKanbanHostRoute(ws, msg, routeHandlers)).resolves.toBe(true);
    expect(routeHandlers[handlerName]).toHaveBeenCalledWith(ws, msg);
  });

  it('does not claim ordinary kanban operations', async () => {
    await expect(handleKanbanHostRoute(ws, { type: 'kanban.list' }, handlers())).resolves.toBe(
      false,
    );
  });
});
