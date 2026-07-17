import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createBoard,
  type KanbanBoardPresence,
  type KanbanEvent,
  type KanbanTask,
} from '@wrongstack/kanban';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import type { WsServerMessage } from '../src/webui-server/ws-handlers/index.js';
import { handleKanbanMessage, type KanbanContext } from '../src/webui-server/ws-handlers/kanban.js';

const ws = {} as WebSocket;
let root = '';

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'kanban-activity-route-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function rig(): { ctx: KanbanContext; sent: WsServerMessage[] } {
  const sent: WsServerMessage[] = [];
  return {
    sent,
    ctx: {
      projectRoot: root,
      sessionContext: {
        session: { id: 'session-route-42' },
        agentId: 'operator-agent',
        agentName: 'Operator Agent',
      } as never,
      send: (_ws, message) => sent.push(message),
      broadcast: () => {},
      log: () => {},
    },
  };
}

function payload<T>(sent: WsServerMessage[], type: string): T {
  return sent.findLast((message) => message.type === type)?.payload as T;
}

describe('Kanban task activity route', () => {
  it('returns only the selected task events with session and agent identity', async () => {
    const board = await createBoard(root, { title: 'Activity route' });
    const { ctx, sent } = rig();

    await handleKanbanMessage(ctx, ws, {
      type: 'kanban.task.add',
      payload: { boardId: board.id, title: 'Route activity task', columnId: 'backlog' },
    });
    const task = payload<{ success: true; data: KanbanTask }>(sent, 'kanban.task.add').data;
    await handleKanbanMessage(ctx, ws, {
      type: 'kanban.task.assign',
      payload: {
        boardId: board.id,
        taskId: task.id,
        agentId: 'agent-route-1',
        activityNote: 'Security reviewer owns the release gate.',
      },
    });
    await handleKanbanMessage(ctx, ws, {
      type: 'kanban.task.activity.add',
      payload: {
        boardId: board.id,
        taskId: task.id,
        kind: 'decision',
        outcome: 'succeeded',
        summary: 'Reviewer accepted the dispatch route.',
        details: 'Fallback remains available.',
        actor: 'release-lead',
      },
    });
    await handleKanbanMessage(ctx, ws, {
      type: 'kanban.task.activity',
      payload: { boardId: board.id, taskId: task.id },
    });

    const response = payload<{
      success: true;
      data: {
        boardId: string;
        taskId: string;
        events: KanbanEvent[];
        presence: KanbanBoardPresence[];
      };
    }>(sent, 'kanban.task.activity');
    expect(response.success).toBe(true);
    expect(response.data).toMatchObject({ boardId: board.id, taskId: task.id });
    expect(response.data.events.map((event) => event.type)).toEqual([
      'task.activity.decision',
      'task.assigned',
      'task.created',
    ]);
    expect(response.data.events.every((event) => event.sessionId === 'session-route-42')).toBe(
      true,
    );
    expect(response.data.events[0]).toMatchObject({
      actor: 'release-lead',
      note: 'Reviewer accepted the dispatch route.',
      after: { outcome: 'succeeded', details: 'Fallback remains available.' },
    });
    expect(response.data.events[1]?.actor).toBe('agent-route-1');
    expect(response.data.events[1]?.note).toBe('Security reviewer owns the release gate.');
    expect(response.data.presence).toMatchObject([
      {
        sessionId: 'session-route-42',
        agentId: 'operator-agent',
        agentName: 'Operator Agent',
        taskId: task.id,
        active: true,
      },
    ]);
  });
});
