import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import type { CollabContext } from '../../src/webui-server/ws-handlers/collab.js';
import type { WsServerMessage } from '../../src/webui-server/ws-handlers/index.js';
import { handleCollabNoop } from '../../src/webui-server/ws-handlers/index.js';

/**
 * PR 5i of Issue #30: collab ws-handler unit tests.
 *
 * The embedded server treats collab.* as a known-but-ignored message.
 * The contract under test: it must NOT send or broadcast anything.
 */

const FAKE_WS = {} as WebSocket;

describe('handleCollabNoop', () => {
  it('sends and broadcasts nothing', () => {
    const sent: WsServerMessage[] = [];
    const bc: WsServerMessage[] = [];
    const ctx: CollabContext = {
      send: (_ws, m) => sent.push(m),
      broadcast: (m) => bc.push(m),
      log: () => {},
    };
    handleCollabNoop(ctx, FAKE_WS);
    expect(sent).toHaveLength(0);
    expect(bc).toHaveLength(0);
  });
});
