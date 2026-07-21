import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { createConversationOperations } from '../src/server/conversation-operations.js';

const ws = {} as WebSocket;

function harness(options: { busy?: boolean } = {}) {
  const sent: Array<{ type: string; payload: unknown }> = [];
  const aborted: Array<{ type: string; payload: unknown }> = [];
  const controller = new AbortController();
  const run = vi.fn(async () => ({ status: 'completed', iterations: 2, finalText: 'done' }));
  const begin = vi.fn(() => (options.busy ? undefined : controller));
  const end = vi.fn();
  const abort = vi.fn();
  const routes = createConversationOperations({
    getAgent: () =>
      ({
        run,
        ctx: {
          provider: { id: 'provider', capabilities: { vision: true } },
          model: 'model',
        },
        tools: { list: () => [] },
      }) as never,
    getSessionId: () => 'session-live',
    runControl: { begin, end, abort },
    pendingConfirms: new Map(),
    send: (_ws, message) => sent.push(message),
    notifyAbort: (_ws, message) => aborted.push(message),
    getMaxIterations: () => 7,
  });
  return { routes, sent, aborted, controller, run, begin, end, abort };
}

describe('createConversationOperations', () => {
  it('runs through the host controller and projects the live session result', async () => {
    const h = harness();
    await h.routes.userMessage(ws, { type: 'user_message', payload: { content: 'hello' } });

    expect(h.run).toHaveBeenCalledWith('hello', {
      signal: h.controller.signal,
      maxIterations: 7,
    });
    expect(h.end).toHaveBeenCalledWith(ws, h.controller);
    expect(h.sent.at(-1)).toMatchObject({
      type: 'run.result',
      payload: { sessionId: 'session-live', finalText: 'done' },
    });
  });

  it('rejects a stale session before acquiring run control', async () => {
    const h = harness();
    await h.routes.userMessage(ws, {
      type: 'user_message',
      payload: { content: 'hello', sessionId: 'session-stale' },
    });

    expect(h.begin).not.toHaveBeenCalled();
    expect(h.sent.at(-1)).toMatchObject({
      type: 'error',
      payload: { phase: 'user_message', requestedSessionId: 'session-stale' },
    });
  });

  it('delegates abort delivery to the host policy', async () => {
    const h = harness();
    await h.routes.abort(ws, { type: 'abort', payload: {} });

    expect(h.abort).toHaveBeenCalledWith(ws);
    expect(h.aborted.at(-1)).toMatchObject({
      type: 'error',
      payload: { phase: 'abort', sessionId: 'session-live' },
    });
  });
});
