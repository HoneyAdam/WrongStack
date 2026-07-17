import { render, screen } from '@testing-library/react';
import type { KanbanBoard, KanbanEvent, KanbanTask } from '@wrongstack/kanban';
import { describe, expect, it } from 'vitest';
import {
  deriveTaskIntelligence,
  TaskIntelligencePanel,
} from '../../src/components/TaskIntelligencePanel.js';

const blockedDependency: KanbanTask = {
  id: 'dependency-1',
  title: 'Approve production access',
  columnId: 'review',
  order: 0,
  priority: 'high',
  status: 'review',
  createdAt: '2026-07-16T08:00:00.000Z',
  updatedAt: '2026-07-16T08:02:00.000Z',
};

const task: KanbanTask = {
  id: 'task-1',
  title: 'Ship the agent ledger',
  description: 'Make execution ownership inspectable.',
  columnId: 'running',
  order: 0,
  priority: 'critical',
  type: 'feature',
  status: 'in_progress',
  assignee: 'Audit Agent',
  dependsOn: [blockedDependency.id],
  retryPolicy: 'exponential',
  costCeilingUsd: 3.5,
  successCriteria: [
    { id: 'check-1', description: 'Activity is durable', type: 'test', status: 'passed' },
    { id: 'check-2', description: 'Fallback is visible', type: 'review', status: 'pending' },
  ],
  origin: { system: 'sdd', graphId: 'graph-1', taskId: 'source-task-1' },
  assignment: {
    agentId: 'agent-audit-1',
    name: 'Audit Agent',
    role: 'reviewer',
    status: 'running',
    modelRouting: 'fallback_profile',
    provider: 'openai',
    model: 'gpt-5.4',
    fallbackProfile: 'resilient',
    fallbackModels: ['anthropic/claude-opus', 'google/gemini-pro'],
    skills: ['testing'],
    tools: ['kanban', 'bash'],
    allowedCapabilities: ['fs.write'],
    attempt: 2,
    maxAttempts: 4,
    costCeilingUsd: 3.5,
    retryPolicy: 'exponential',
    subagentId: 'subagent-7',
    runTaskId: 'run-99',
    dispatchedAt: '2026-07-16T08:05:00.000Z',
    lastResult: 'Implementation is awaiting the dependency.',
  },
  createdAt: '2026-07-16T08:00:00.000Z',
  updatedAt: '2026-07-16T08:10:00.000Z',
};

const board: KanbanBoard = {
  id: 'board-1',
  title: 'Agent delivery',
  columns: [
    { id: 'running', title: 'In progress', order: 0 },
    { id: 'review', title: 'Review', order: 1 },
  ],
  tasks: [task, blockedDependency],
  presence: [
    {
      id: 'session-live:observer-1',
      sessionId: 'session-live',
      agentId: 'observer-1',
      agentName: 'Release Observer',
      taskId: task.id,
      firstSeenAt: '2026-07-16T08:07:00.000Z',
      lastSeenAt: '2026-07-16T08:11:00.000Z',
      activeUntil: '2026-07-16T08:13:00.000Z',
      active: true,
    },
  ],
  createdAt: '2026-07-16T07:00:00.000Z',
  updatedAt: '2026-07-16T08:10:00.000Z',
  version: 1,
};

const events: KanbanEvent[] = [
  {
    id: 'running-event',
    boardId: board.id,
    taskId: task.id,
    type: 'task.assignment.running',
    ts: '2026-07-16T08:10:00.000Z',
    actor: 'agent-audit-1',
    sessionId: 'session-42',
    subagentId: 'subagent-7',
    runTaskId: 'run-99',
    after: { ...task.assignment },
  },
  {
    id: 'failed-event',
    boardId: board.id,
    taskId: task.id,
    type: 'task.assignment.failed',
    ts: '2026-07-16T08:09:00.000Z',
    actor: 'agent-audit-1',
    sessionId: 'session-41',
    note: 'First route timed out.',
    after: { status: 'failed', attempt: 1 },
  },
];

describe('TaskIntelligencePanel', () => {
  it('derives placement, blockers, execution route, attempts, actors, and sessions', () => {
    const intelligence = deriveTaskIntelligence(board, task, events);

    expect(intelligence).toMatchObject({
      column: 'In progress',
      owner: 'Audit Agent',
      reason: 'Blocked by Approve production access.',
      routingMode: 'fallback_profile',
      provider: 'openai',
      model: 'gpt-5.4',
      primaryModel: 'openai/gpt-5.4',
      fallbackRoute: 'profile:resilient → anthropic/claude-opus → google/gemini-pro',
      attempts: 2,
      failures: 1,
      lastFailure: 'First route timed out.',
    });
    expect(intelligence.blockers).toEqual([
      { id: 'dependency-1', title: 'Approve production access', status: 'review' },
    ]);
    expect(intelligence.actors).toEqual(['agent-audit-1', 'observer-1']);
    expect(intelligence.sessions).toEqual(['session-42', 'session-41', 'session-live']);
    expect(intelligence.presence).toEqual(['Release Observer · active']);
    expect(intelligence.activePresence).toBe(1);
  });

  it('renders the full ownership, provider/model, fallback, policy, and result summary', () => {
    render(<TaskIntelligencePanel board={board} task={task} events={events} />);

    expect(screen.getByText('Task intelligence')).toBeTruthy();
    expect(screen.getByText(/Blocked by Approve production access/)).toBeTruthy();
    expect(screen.getAllByText('agent-audit-1').length).toBeGreaterThan(0);
    expect(screen.getByText('openai/gpt-5.4')).toBeTruthy();
    expect(
      screen.getByText('profile:resilient → anthropic/claude-opus → google/gemini-pro'),
    ).toBeTruthy();
    expect(screen.getByText('2 / 4')).toBeTruthy();
    expect(screen.getByText('Implementation is awaiting the dependency.')).toBeTruthy();
    expect(screen.getByText('subagent-7')).toBeTruthy();
    expect(screen.getByText('run-99')).toBeTruthy();
    expect(screen.getByText('Release Observer · active')).toBeTruthy();
  });
});
