import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventBus } from '@wrongstack/core';
import { describe, expect, it } from 'vitest';
import { createSuperMemoryContextMonitorMiddleware } from '../src/middleware/context-monitor.js';
import { InjectionTracker } from '../src/middleware/injection-tracker.js';
import { createSuperMemoryToolCallMiddleware } from '../src/middleware/tool-call-memory.js';
import { SuperMemoryStore } from '../src/store.js';

describe('Super Memory provider-context monitor', () => {
  it('emits the exact active/entered/exited memory ids around provider requests', async () => {
    const events = new EventBus();
    const tracker = new InjectionTracker();
    const snapshots: Array<Record<string, unknown>> = [];
    events.on('memory.context_snapshot', (payload) => snapshots.push(payload));
    tracker.record(
      'mem_contract',
      'The refresh flow rotates the token before returning.',
      Date.parse('2026-07-19T12:00:00.000Z'),
      'sess_test',
    );
    let now = new Date('2026-07-19T12:00:01.000Z');
    const middleware = createSuperMemoryContextMonitorMiddleware({
      tracker,
      events,
      getSessionId: () => 'sess_test',
      now: () => now,
    });

    await middleware.handler(
      {
        model: 'test',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tool_1',
                content: 'The refresh flow rotates the token before returning.',
              },
            ],
          },
        ],
      },
      async (request) => request,
    );

    now = new Date('2026-07-19T12:00:02.000Z');
    await middleware.handler(
      {
        model: 'test',
        messages: [{ role: 'user', content: 'Compacted context.' }],
      },
      async (request) => request,
    );

    expect(snapshots).toEqual([
      expect.objectContaining({
        sessionId: 'sess_test',
        activeMemoryIds: ['mem_contract'],
        enteredMemoryIds: ['mem_contract'],
        exitedMemoryIds: [],
      }),
      expect.objectContaining({
        sessionId: 'sess_test',
        activeMemoryIds: [],
        enteredMemoryIds: [],
        exitedMemoryIds: ['mem_contract'],
      }),
    ]);
  });

  it('confirms a tool-result injection in the next provider-bound request', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'super-memory-context-flow-'));
    try {
      const events = new EventBus();
      const tracker = new InjectionTracker();
      const store = new SuperMemoryStore({ projectRoot });
      const memory = await store.rememberSuper({
        text: 'Statusline context counts come from provider request snapshots.',
        kind: 'convention',
        importance: 0.95,
        confidence: 0.98,
        anchors: [{ type: 'file', path: 'src/statusline.ts' }],
      });
      const toolMiddleware = createSuperMemoryToolCallMiddleware({
        memory: store,
        tracker,
        events,
        repeatCooldownMs: 0,
      });
      const toolPayload = {
        toolUse: {
          type: 'tool_use' as const,
          id: 'tool_read',
          name: 'read',
          input: { path: 'src/statusline.ts' },
        },
        result: {
          type: 'tool_result' as const,
          tool_use_id: 'tool_read',
          content: 'source text',
        },
        ctx: {
          projectRoot,
          cwd: projectRoot,
          session: { id: 'leader-session' },
          signal: new AbortController().signal,
        },
      };
      await toolMiddleware.handler(toolPayload as never, async (payload) => payload);
      expect(toolPayload.result.content).toContain(memory.text);

      const snapshots: Array<{ activeMemoryIds: string[] }> = [];
      events.on('memory.context_snapshot', (payload) => snapshots.push(payload));
      const contextMiddleware = createSuperMemoryContextMonitorMiddleware({
        tracker,
        events,
        getSessionId: () => 'leader-session',
      });
      await contextMiddleware.handler(
        {
          model: 'test',
          messages: [
            {
              role: 'user',
              content: [{ ...toolPayload.result }],
            },
          ],
        },
        async (request) => request,
      );

      expect(snapshots.at(-1)?.activeMemoryIds).toEqual([memory.id]);
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true });
    }
  });
});
