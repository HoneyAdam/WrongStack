import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { createConnectionLifecycle } from '../src/server/connection-lifecycle.js';

class TestSocket {
  readonly listeners = new Map<string, (...args: unknown[]) => unknown>();
  on(event: string, listener: (...args: never[]) => unknown): this {
    this.listeners.set(event, listener as (...args: unknown[]) => unknown);
    return this;
  }
  async emit(event: string, value?: unknown): Promise<void> {
    await this.listeners.get(event)?.(value);
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createConnectionLifecycle', () => {
  it('installs socket error protection before authentication and does not register a denial', async () => {
    const socket = new TestSocket();
    const clients = new Map<WebSocket, { id: string }>();
    const registerClient = vi.fn();
    const lifecycle = createConnectionLifecycle({
      clients,
      pendingConfirms: new Map(),
      authenticate: (ws) => {
        expect(ws).toBe(socket);
        expect(socket.listeners.has('error')).toBe(true);
        return false;
      },
      createClient: (_ws, id) => ({ id }),
      registerClient,
      decode: () => ({ ok: false, issue: { code: 'bad', message: 'bad' } }),
      dispatch: vi.fn(),
      send: vi.fn(),
      sessionPayload: (payload) => payload,
      buildInitialPayload: vi.fn(async () => ({})),
    });

    await lifecycle(socket as never, undefined);
    expect(registerClient).not.toHaveBeenCalled();
    expect(clients.size).toBe(0);
  });

  it('replays pending confirms, sends session.start, and dispatches decoded messages', async () => {
    const socket = new TestSocket();
    const send = vi.fn();
    const dispatch = vi.fn(async () => undefined);
    const lifecycle = createConnectionLifecycle({
      clients: new Map<WebSocket, { id: string }>(),
      pendingConfirms: new Map([['confirm-1', { resolve: vi.fn(), payload: { id: 'confirm-1' } }]]),
      createClient: (_ws, id) => ({ id }),
      registerClient: vi.fn(),
      decode: () => ({ ok: true, message: { type: 'ping' } }),
      dispatch,
      send,
      sessionPayload: (payload) => payload,
      buildInitialPayload: async () => ({ sessionId: 'session-1' }),
    });

    await lifecycle(socket as never, undefined);
    await socket.emit('message', Buffer.from('{"type":"ping"}'));
    expect(send).toHaveBeenCalledWith(socket, {
      type: 'tool.confirm_needed',
      payload: { id: 'confirm-1' },
    });
    expect(send).toHaveBeenCalledWith(socket, {
      type: 'session.start',
      payload: { sessionId: 'session-1' },
    });
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it('drains pending confirmations after the final client disconnects', async () => {
    vi.useFakeTimers();
    const socket = new TestSocket();
    const resolve = vi.fn();
    const lifecycle = createConnectionLifecycle({
      clients: new Map<WebSocket, { id: string }>(),
      pendingConfirms: new Map([['confirm-1', { resolve }]]),
      createClient: (_ws, id) => ({ id }),
      registerClient: vi.fn(),
      decode: () => ({ ok: true, message: {} }),
      dispatch: vi.fn(async () => undefined),
      send: vi.fn(),
      sessionPayload: (payload) => payload,
      buildInitialPayload: async () => ({}),
      confirmDrainGraceMs: 10,
    });

    await lifecycle(socket as never, undefined);
    await socket.emit('close');
    await vi.advanceTimersByTimeAsync(10);
    expect(resolve).toHaveBeenCalledWith('no');
  });
});
