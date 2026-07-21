import {
  type ClientTransportRouteHandlers,
  handleClientTransportRoute,
} from '@wrongstack/webui-server';
import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';

const ws = {} as WebSocket;

describe('handleClientTransportRoute', () => {
  it.each(['collab.join', 'collab.inject_tool'])('routes %s to collaboration', async (type) => {
    const handlers: ClientTransportRouteHandlers = {
      collaboration: vi.fn(),
      terminal: vi.fn(),
    };
    const msg = { type, payload: {} };

    await expect(handleClientTransportRoute(ws, msg, handlers)).resolves.toBe(true);
    expect(handlers.collaboration).toHaveBeenCalledWith(ws, msg);
    expect(handlers.terminal).not.toHaveBeenCalled();
  });

  it.each(['terminal.create', 'terminal.close'])('routes %s to terminal', async (type) => {
    const handlers: ClientTransportRouteHandlers = {
      collaboration: vi.fn(),
      terminal: vi.fn(),
    };
    const msg = { type, payload: {} };

    await expect(handleClientTransportRoute(ws, msg, handlers)).resolves.toBe(true);
    expect(handlers.terminal).toHaveBeenCalledWith(ws, msg);
  });

  it('does not claim unrelated messages', async () => {
    const handlers: ClientTransportRouteHandlers = {
      collaboration: vi.fn(),
      terminal: vi.fn(),
    };
    await expect(handleClientTransportRoute(ws, { type: 'ping' }, handlers)).resolves.toBe(false);
  });
});
