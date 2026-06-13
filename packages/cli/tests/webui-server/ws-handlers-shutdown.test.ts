import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import type { WsServerMessage } from '../../src/webui-server/ws-handlers/index.js';
import { handleWebuiShutdown } from '../../src/webui-server/ws-handlers/index.js';
import type { ShutdownContext } from '../../src/webui-server/ws-handlers/shutdown.js';

/**
 * PR 5i of Issue #30: shutdown ws-handler unit tests.
 */

const FAKE_WS = {} as WebSocket;

function makeCtx(over: Partial<ShutdownContext> = {}): {
  ctx: ShutdownContext;
  logs: string[];
} {
  const logs: string[] = [];
  const ctx: ShutdownContext = {
    send: () => {},
    broadcast: () => {},
    log: (m) => logs.push(m),
    shutdown: () => {},
    ...over,
  };
  return { ctx, logs };
}

describe('handleWebuiShutdown', () => {
  it('invokes the supplied shutdown callback', () => {
    const shutdown = vi.fn();
    const { ctx } = makeCtx({ shutdown });
    handleWebuiShutdown(ctx, FAKE_WS);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it('logs the shutdown request', () => {
    const { ctx, logs } = makeCtx();
    handleWebuiShutdown(ctx, FAKE_WS);
    expect(logs.some((l) => l.includes('Shutdown requested'))).toBe(true);
  });
});
