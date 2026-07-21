import { handleWorktreeRoute, type WorktreeRouteHandlers } from '@wrongstack/webui-server';
import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';

const ws = {} as WebSocket;

describe('handleWorktreeRoute', () => {
  it('delegates worktree messages and preserves the handler claim result', async () => {
    const handlers: WorktreeRouteHandlers = { handleMessage: vi.fn(async () => true) };
    const msg = { type: 'worktree.scan', payload: {} };

    await expect(handleWorktreeRoute(ws, msg, handlers)).resolves.toBe(true);
    expect(handlers.handleMessage).toHaveBeenCalledWith(msg);
  });

  it('does not claim unrelated messages', async () => {
    const handlers: WorktreeRouteHandlers = { handleMessage: vi.fn(async () => true) };

    await expect(handleWorktreeRoute(ws, { type: 'ping' }, handlers)).resolves.toBe(false);
    expect(handlers.handleMessage).not.toHaveBeenCalled();
  });
});
