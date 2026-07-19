import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { SuperMemoryStore } from '@wrongstack/super-memory';
import { handleSuperMemoryGraph } from '@wrongstack/webui-server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'wrongstack-memory-graph-handler-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function mockSocket(): WebSocket & { sent: unknown[] } {
  return {
    readyState: 1,
    sent: [],
    send(data: string) {
      this.sent.push(JSON.parse(data));
    },
  } as never;
}

describe('handleSuperMemoryGraph', () => {
  it('returns persisted edges, evidence, and referenced memory records', async () => {
    const store = new SuperMemoryStore({ projectRoot: root });
    const first = await store.rememberSuper({
      text: 'The auth package owns session state.',
      kind: 'file_note',
      tags: ['auth', 'session'],
      anchors: [{ type: 'package', path: 'packages/auth' }],
    });
    const second = await store.rememberSuper({
      text: 'Session changes require auth tests.',
      kind: 'command_note',
      tags: ['auth', 'session'],
      anchors: [{ type: 'package', path: 'packages/auth' }],
    });
    const ws = mockSocket();

    await handleSuperMemoryGraph(
      ws,
      { type: 'memory.super.graph', payload: { query: first.id, maxDepth: 1 } },
      store,
    );

    expect(ws.sent).toHaveLength(1);
    const response = ws.sent[0] as {
      type: string;
      payload: {
        query: string;
        edges: Array<{ evidence?: string[] }>;
        memories: Array<{ id: string }>;
      };
    };
    expect(response.type).toBe('memory.super.graph');
    expect(response.payload.query).toBe(first.id);
    expect(
      response.payload.edges.some((edge) => edge.evidence?.includes('package:packages/auth')),
    ).toBe(true);
    expect(response.payload.memories.map((memory) => memory.id)).toEqual(
      expect.arrayContaining([first.id, second.id]),
    );
  });
});
