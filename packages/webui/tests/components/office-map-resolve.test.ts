import { describe, expect, it } from 'vitest';
import { resolveClients } from '../../src/components/OfficeMapCanvas/resolve.js';
import type { LiveSession } from '../../src/stores/monitor-store.js';

describe('resolveClients project roster', () => {
  it('merges a mailbox identity into the matching live-session agent', () => {
    const sessions: LiveSession[] = [
      {
        sessionId: 'session-a',
        projectName: 'WrongStack',
        clientType: 'tui',
        pid: 4242,
        lastHeartbeatAt: '2026-07-17T10:00:05.000Z',
        agents: [{ id: 'leader', name: 'Leader', status: 'running' }],
      },
    ];

    const clients = resolveClients(sessions, new Map(), [
      {
        agentId: 'leader@abc',
        name: 'Leader',
        role: 'lead',
        sessionId: 'session-a',
        status: 'running',
        lastSeenAt: '2026-07-17T10:00:00.000Z',
        online: true,
      },
    ]);

    expect(clients).toHaveLength(1);
    expect(clients[0]).toMatchObject({
      label: 'TUI · PID 4242',
      lastHeartbeatAt: '2026-07-17T10:00:05.000Z',
    });
    expect(clients[0]?.agents).toHaveLength(1);
    expect(clients[0]?.agents[0]).toMatchObject({
      serverId: 'leader',
      mailboxId: 'leader@abc',
      role: 'lead',
      presenceSource: 'registry',
    });
  });

  it('does not create a fake office from mailbox-only presence', () => {
    const clients = resolveClients([], new Map(), [
      {
        agentId: 'worker@xyz',
        name: 'Worker',
        sessionId: 'session-b',
        status: 'streaming',
        source: 'cli',
        pid: 4242,
        iterations: 3,
        toolCalls: 9,
        lastSeenAt: '2026-07-17T10:00:00.000Z',
        online: true,
      },
    ]);

    expect(clients).toHaveLength(1);
    expect(clients[0]).toMatchObject({ id: 'client-self', agents: [] });
  });

  it('does not add an unmatched mailbox identity to a real session', () => {
    const sessions: LiveSession[] = [
      {
        sessionId: 'session-a',
        projectName: 'WrongStack',
        clientType: 'cli',
        agents: [{ id: 'leader', name: 'Leader', status: 'idle' }],
      },
    ];
    const clients = resolveClients(sessions, new Map(), [
      {
        agentId: 'chimera-review',
        name: 'Chimera Review',
        sessionId: 'session-a',
        status: 'running',
        source: 'cli',
        lastSeenAt: '2026-07-17T10:00:00.000Z',
        online: true,
      },
    ]);

    expect(clients[0]?.agents.map((agent) => agent.name)).toEqual(['Leader']);
  });

  it('does not resurrect offline mailbox agents', () => {
    const clients = resolveClients([], new Map(), [
      {
        agentId: 'old@xyz',
        name: 'Old worker',
        sessionId: 'session-old',
        status: 'offline',
        lastSeenAt: '2026-07-16T10:00:00.000Z',
        online: false,
      },
    ]);

    expect(clients[0]?.agents).toHaveLength(0);
  });

  it('resolves prompt, todos, and assigned tasks from the real session snapshot', () => {
    const sessions: LiveSession[] = [
      {
        sessionId: 'session-work',
        clientType: 'webui',
        agents: [
          {
            id: 'leader',
            name: 'Leader',
            status: 'running',
            currentTool: 'read',
            currentTask: 'Build the office briefing',
            latestPrompt: 'Show every agent task and the active todo list',
            latestPromptAt: 1_752_750_000_000,
            todos: [{ id: 'todo-1', content: 'Render task cards', status: 'in_progress' }],
          },
          {
            id: 'reviewer',
            name: 'Reviewer',
            status: 'running',
            taskId: 'task-review',
            currentTask: 'Review the task visualization',
          },
        ],
      },
    ];

    const [client] = resolveClients(sessions, new Map());
    expect(client).toMatchObject({
      latestPrompt: 'Show every agent task and the active todo list',
      latestPromptAt: 1_752_750_000_000,
      activeInstruction: 'Show every agent task and the active todo list',
      todos: [{ id: 'todo-1', content: 'Render task cards', status: 'in_progress' }],
    });
    expect(client?.agents[0]).toMatchObject({
      currentTool: 'read',
      currentTask: 'Build the office briefing',
    });
    expect(client?.agents[1]).toMatchObject({
      taskId: 'task-review',
      currentTask: 'Review the task visualization',
    });
  });
});
