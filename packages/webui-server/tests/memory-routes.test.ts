import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { handleMemoryRoute } from '../src/server/memory-routes.js';
import type { WSServerMessage } from '../src/server/types.js';

describe('canonical memory handler family', () => {
  it('owns every memory message and normalizes an unavailable store', async () => {
    const sent: WSServerMessage[] = [];
    const sendResult = vi.fn();
    const context = {
      getMemoryStore: () => undefined,
      send: (_ws: WebSocket, message: WSServerMessage) => sent.push(message),
      sendResult,
    };
    const types = [
      'memory.list',
      'memory.super.list',
      'memory.super.listPage',
      'memory.super.get',
      'memory.super.graph',
      'memory.super.update',
      'memory.super.delete',
      'memory.super.remember',
      'memory.super.recover',
      'memory.super.candidateResolve',
      'memory.super.backfillRecoverable',
      'memory.super.forFile',
    ];
    for (const type of types) {
      expect(await handleMemoryRoute(context, {} as WebSocket, { type })).toBe(true);
    }
    expect(sent[0]).toEqual({
      type: 'memory.list',
      payload: { text: '', error: 'Memory store not available' },
    });
    expect(sendResult).toHaveBeenCalledWith(expect.anything(), false, 'Memory store not available');
  });

  it('declines foreign messages without reading the store', async () => {
    const getMemoryStore = vi.fn();
    expect(
      await handleMemoryRoute(
        { getMemoryStore, send: vi.fn(), sendResult: vi.fn() },
        {} as WebSocket,
        { type: 'test.foreign' },
      ),
    ).toBe(false);
    expect(getMemoryStore).not.toHaveBeenCalled();
  });
});
