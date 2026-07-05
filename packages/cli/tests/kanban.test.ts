import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  addDependency,
  addTask,
  assignTask,
  copyTaskToBoard,
  createBoard,
  duplicateBoard,
  getBoard,
  getKanbanPath,
  type KanbanBoard,
  moveTask,
  readBoard,
  removeBoard,
  searchKanban,
  transferTaskToBoard,
  updateTaskAssignment,
} from '@wrongstack/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import type { WsServerMessage } from '../src/webui-server/ws-handlers/index.js';
import { handleKanbanMessage, type KanbanContext } from '../src/webui-server/ws-handlers/kanban.js';

const FAKE_WS = {} as WebSocket;

let tmpDir = '';

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wstack-kanban-'));
});

afterEach(async () => {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  tmpDir = '';
});

function wsRig(): { ctx: KanbanContext; sent: WsServerMessage[] } {
  const sent: WsServerMessage[] = [];
  return {
    sent,
    ctx: {
      projectRoot: tmpDir,
      send: (_ws, msg) => sent.push(msg),
      broadcast: () => {},
      log: () => {},
    },
  };
}

function lastPayload<T>(sent: WsServerMessage[], type: string): T {
  return sent.filter((msg) => msg.type === type).at(-1)?.payload as T;
}

describe('kanban storage and manager', () => {
  it('creates boards and resolves unique short board ids', async () => {
    const board = await createBoard(tmpDir, { title: 'Ship kanban MVP' });
    const shortId = board.id.slice(0, 8);

    const loaded = await getBoard(tmpDir, shortId);
    expect(loaded?.id).toBe(board.id);

    const added = await addTask(tmpDir, shortId, {
      title: 'Wire slash command',
      columnId: 'backlog',
    });
    expect(added?.task.title).toBe('Wire slash command');

    const moved = await moveTask(tmpDir, shortId, added!.task.id, 'in-progress');
    expect(moved?.tasks.find((task) => task.id === added!.task.id)?.columnId).toBe('in-progress');

    await expect(fs.stat(getKanbanPath(tmpDir, board.id))).resolves.toBeDefined();
    await expect(removeBoard(tmpDir, shortId)).resolves.toBe(true);
    await expect(getBoard(tmpDir, board.id)).resolves.toBeNull();
  });

  it('rejects board ids that would escape the kanban directory', async () => {
    await expect(readBoard(tmpDir, '../escape')).rejects.toThrow('Invalid kanban board id');
    await expect(() => getKanbanPath(tmpDir, '..\\escape')).toThrow('Invalid kanban board id');
  });

  it('supports multiple boards, board duplication, and cross-board task copy/transfer', async () => {
    const source = await createBoard(tmpDir, { title: 'Backend board' });
    const target = await createBoard(tmpDir, { title: 'Frontend board' });
    const added = await addTask(tmpDir, source.id, {
      title: 'Implement websocket route',
      labels: ['api'],
      assignedAgent: 'api-agent',
    });
    expect(added).toBeTruthy();

    const duplicate = await duplicateBoard(tmpDir, source.id, { title: 'Backend board clone' });
    expect(duplicate?.id).not.toBe(source.id);
    expect(duplicate?.title).toBe('Backend board clone');
    expect(duplicate?.tasks).toHaveLength(1);
    expect(duplicate?.tasks[0]?.id).not.toBe(added!.task.id);

    const copied = await copyTaskToBoard(tmpDir, source.id, added!.task.id, target.id);
    expect(copied?.targetBoard.tasks.map((task) => task.title)).toContain(
      'Implement websocket route',
    );
    expect(copied?.task.assignedAgent).toBeUndefined();

    const transferred = await transferTaskToBoard(tmpDir, source.id, added!.task.id, target.id);
    expect(transferred?.task.assignedAgent).toBe('api-agent');
    await expect(getBoard(tmpDir, source.id)).resolves.toMatchObject({ tasks: [] });
    expect((await getBoard(tmpDir, target.id))?.tasks).toHaveLength(2);
  });

  it('tracks assignment lifecycle and searches assigned tasks', async () => {
    const board = await createBoard(tmpDir, { title: 'Agent work' });
    const added = await addTask(tmpDir, board.id, { title: 'Let agent fix tests' });
    await assignTask(tmpDir, board.id, added!.task.id.slice(0, 8), {
      agentId: 'tester',
      provider: 'openai',
      model: 'gpt-5',
      fallbackModels: ['anthropic/claude-sonnet-4'],
      tools: ['kanban', 'bash'],
      allowedCapabilities: ['fs.write', 'shell.exec'],
    });

    let loaded = await getBoard(tmpDir, board.id);
    expect(loaded?.tasks[0]?.assignment).toMatchObject({
      agentId: 'tester',
      provider: 'openai',
      model: 'gpt-5',
      fallbackModels: ['anthropic/claude-sonnet-4'],
    });

    await updateTaskAssignment(tmpDir, board.id, added!.task.id, {
      status: 'running',
      subagentId: 'sub-1',
    });
    loaded = await getBoard(tmpDir, board.id);
    expect(loaded?.tasks[0]?.status).toBe('in_progress');

    await updateTaskAssignment(tmpDir, board.id, added!.task.id, {
      status: 'completed',
      lastResult: 'done',
    });
    loaded = await getBoard(tmpDir, board.id);
    expect(loaded?.tasks[0]?.status).toBe('completed');
    expect(loaded?.tasks[0]?.assignment?.completedAt).toBeTruthy();

    const matches = await searchKanban(tmpDir, { assignedAgent: 'tester' });
    expect(matches.map((match) => match.task.title)).toEqual(['Let agent fix tests']);
  });

  it('rejects self dependencies and dependency cycles', async () => {
    const board = await createBoard(tmpDir, { title: 'Dependency board' });
    const a = await addTask(tmpDir, board.id, { title: 'A' });
    const b = await addTask(tmpDir, board.id, { title: 'B' });

    await expect(addDependency(tmpDir, board.id, a!.task.id, a!.task.id)).rejects.toThrow(
      'cannot depend on itself',
    );
    await expect(addDependency(tmpDir, board.id, a!.task.id, b!.task.id)).resolves.toBeTruthy();
    await expect(addDependency(tmpDir, board.id, b!.task.id, a!.task.id)).rejects.toThrow(
      'dependency cycle',
    );
  });
});

describe('kanban websocket handler', () => {
  it('creates a board and adds a task through websocket messages', async () => {
    const { ctx, sent } = wsRig();

    await handleKanbanMessage(ctx, FAKE_WS, {
      type: 'kanban.create',
      payload: { title: 'WS board' },
    });

    const created = lastPayload<{ success: true; data: KanbanBoard }>(sent, 'kanban.create');
    expect(created.success).toBe(true);
    expect(created.data.title).toBe('WS board');

    await handleKanbanMessage(ctx, FAKE_WS, {
      type: 'kanban.task.add',
      payload: {
        boardId: created.data.id.slice(0, 8),
        title: 'Add client store',
        priority: 'high',
      },
    });

    const added = lastPayload<{ success: true; data: { title: string; priority: string } }>(
      sent,
      'kanban.task.add',
    );
    expect(added).toMatchObject({
      success: true,
      data: { title: 'Add client store', priority: 'high' },
    });
  });

  it('copies and transfers tasks between boards through websocket messages', async () => {
    const { ctx, sent } = wsRig();
    const source = await createBoard(tmpDir, { title: 'Source' });
    const target = await createBoard(tmpDir, { title: 'Target' });
    const task = await addTask(tmpDir, source.id, {
      title: 'Move me across boards',
      assignedAgent: 'worker-1',
    });

    await handleKanbanMessage(ctx, FAKE_WS, {
      type: 'kanban.duplicate',
      payload: { boardId: source.id, title: 'Source Clone', preserveAssignment: true },
    });
    const duplicated = lastPayload<{ success: true; data: KanbanBoard }>(sent, 'kanban.duplicate');
    expect(duplicated.data.title).toBe('Source Clone');
    expect(duplicated.data.tasks[0]?.assignedAgent).toBe('worker-1');

    await handleKanbanMessage(ctx, FAKE_WS, {
      type: 'kanban.task.copy',
      payload: { boardId: source.id, taskId: task!.task.id, targetBoardId: target.id },
    });
    const copied = lastPayload<{ success: true; data: KanbanBoard }>(sent, 'kanban.task.copy');
    expect(copied.data.tasks).toHaveLength(1);
    expect(copied.data.tasks[0]?.assignedAgent).toBeUndefined();

    await handleKanbanMessage(ctx, FAKE_WS, {
      type: 'kanban.task.transfer',
      payload: {
        boardId: source.id,
        taskId: task!.task.id,
        targetBoardId: target.id,
        preserveAssignment: true,
      },
    });
    const transferred = lastPayload<{ success: true; data: KanbanBoard }>(
      sent,
      'kanban.task.transfer',
    );
    expect(transferred.data.tasks).toHaveLength(2);
    expect(transferred.data.tasks.at(-1)?.assignedAgent).toBe('worker-1');
    expect((await getBoard(tmpDir, source.id))?.tasks).toHaveLength(0);
  });

  it('dispatches kanban tasks with provider, model, fallback, tools, and capabilities', async () => {
    const dispatched: Array<{ description: string; opts: Record<string, unknown> | undefined }> =
      [];
    let onDone:
      | ((result: {
          status: 'completed' | 'failed';
          result?: string | undefined;
          error?: string | undefined;
        }) => void | Promise<void>)
      | undefined;
    const { ctx, sent } = wsRig();
    ctx.dispatchTask = async (description, opts) => {
      dispatched.push({ description, opts: opts as Record<string, unknown> | undefined });
      onDone = opts?.onDone;
      return 'Spawned subagent kanban-123 for task task-456.';
    };

    const board = await createBoard(tmpDir, { title: 'Dispatch board' });
    const task = await addTask(tmpDir, board.id, { title: 'Run this with an agent' });

    await handleKanbanMessage(ctx, FAKE_WS, {
      type: 'kanban.task.dispatch',
      payload: {
        boardId: board.id,
        taskId: task!.task.id.slice(0, 8),
        agentId: 'runner',
        provider: 'openai',
        model: 'gpt-5',
        fallbackModels: ['anthropic/claude-sonnet-4'],
        tools: ['kanban', 'bash'],
        allowedCapabilities: ['fs.write'],
      },
    });

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.opts).toMatchObject({
      provider: 'openai',
      model: 'gpt-5',
      fallbackModels: ['anthropic/claude-sonnet-4'],
      tools: ['kanban', 'bash'],
      allowedCapabilities: ['fs.write'],
    });
    expect(dispatched[0]?.description).toContain('Run this with an agent');

    const payload = lastPayload<{ success: true; data: { task: { assignment: unknown } } }>(
      sent,
      'kanban.task.dispatch',
    );
    expect(payload.success).toBe(true);
    expect(payload.data.task.assignment).toMatchObject({
      agentId: 'runner',
      status: 'running',
      subagentId: 'kanban-123',
    });

    await onDone?.({ status: 'completed', result: 'agent finished' });
    const loaded = await getBoard(tmpDir, board.id);
    expect(loaded?.tasks[0]?.assignment).toMatchObject({
      agentId: 'runner',
      status: 'completed',
      lastResult: 'agent finished',
    });
  });
});
