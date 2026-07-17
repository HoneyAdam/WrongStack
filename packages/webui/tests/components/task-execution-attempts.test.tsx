import { render, screen } from '@testing-library/react';
import type { KanbanEvent, KanbanTask } from '@wrongstack/kanban';
import { describe, expect, it } from 'vitest';
import {
  buildTaskExecutionAttempts,
  TaskExecutionAttempts,
} from '../../src/components/TaskExecutionAttempts.js';

const task: KanbanTask = {
  id: 'task-attempts',
  title: 'Ship with retries',
  columnId: 'done',
  order: 0,
  priority: 'critical',
  status: 'completed',
  createdAt: '2026-07-17T08:00:00.000Z',
  updatedAt: '2026-07-17T08:10:00.000Z',
};

const events: KanbanEvent[] = [
  {
    id: 'attempt-1-assigned',
    boardId: 'board-1',
    taskId: task.id,
    type: 'task.assigned',
    ts: '2026-07-17T08:00:00.000Z',
    actor: 'agent-1',
    sessionId: 'session-1',
    after: {
      status: 'queued',
      attempt: 1,
      agentId: 'agent-1',
      provider: 'openai',
      model: 'gpt-5.4',
      modelRouting: 'fallback_profile',
      fallbackProfile: 'resilient',
      fallbackModels: ['anthropic/claude-opus'],
    },
  },
  {
    id: 'attempt-1-running',
    boardId: 'board-1',
    taskId: task.id,
    type: 'task.assignment.running',
    ts: '2026-07-17T08:01:00.000Z',
    actor: 'agent-1',
    sessionId: 'session-1',
    subagentId: 'subagent-1',
    runTaskId: 'run-1',
    after: { status: 'running', attempt: 1 },
  },
  {
    id: 'attempt-1-failed',
    boardId: 'board-1',
    taskId: task.id,
    type: 'task.assignment.failed',
    ts: '2026-07-17T08:03:00.000Z',
    actor: 'agent-1',
    sessionId: 'session-1',
    note: 'Primary model timed out.',
    after: { status: 'failed', attempt: 1, error: 'Primary model timed out.' },
  },
  {
    id: 'attempt-2-assigned',
    boardId: 'board-1',
    taskId: task.id,
    type: 'task.assigned',
    ts: '2026-07-17T08:04:00.000Z',
    actor: 'agent-2',
    sessionId: 'session-2',
    after: {
      status: 'queued',
      attempt: 2,
      agentId: 'agent-2',
      provider: 'anthropic',
      model: 'claude-opus',
    },
  },
  {
    id: 'attempt-2-running',
    boardId: 'board-1',
    taskId: task.id,
    type: 'task.assignment.running',
    ts: '2026-07-17T08:05:00.000Z',
    actor: 'agent-2',
    sessionId: 'session-2',
    subagentId: 'subagent-2',
    runTaskId: 'run-2',
    after: { status: 'running', attempt: 2 },
  },
  {
    id: 'attempt-2-completed',
    boardId: 'board-1',
    taskId: task.id,
    type: 'task.assignment.completed',
    ts: '2026-07-17T08:10:00.000Z',
    actor: 'agent-2',
    sessionId: 'session-2',
    note: 'Release completed.',
    after: { status: 'completed', attempt: 2, lastResult: 'Release completed.' },
  },
];

describe('TaskExecutionAttempts', () => {
  it('groups assignment events into complete per-attempt execution records', () => {
    const attempts = buildTaskExecutionAttempts(task, events);

    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({
      attempt: 2,
      status: 'completed',
      owner: 'agent-2',
      provider: 'anthropic',
      model: 'claude-opus',
      sessionIds: ['session-2'],
      subagentId: 'subagent-2',
      runTaskId: 'run-2',
      result: 'Release completed.',
      durationMs: 360_000,
      eventCount: 3,
    });
    expect(attempts[1]).toMatchObject({
      attempt: 1,
      status: 'failed',
      provider: 'openai',
      model: 'gpt-5.4',
      fallbackProfile: 'resilient',
      fallbackModels: ['anthropic/claude-opus'],
      error: 'Primary model timed out.',
      durationMs: 180_000,
      eventCount: 3,
    });
  });

  it('renders attempt status, route, fallback, identifiers, error, result, and duration', () => {
    render(<TaskExecutionAttempts task={task} events={events} />);

    expect(screen.getByText('Execution attempts')).toBeTruthy();
    expect(screen.getByText('Attempt #2')).toBeTruthy();
    expect(screen.getByText('Attempt #1')).toBeTruthy();
    expect(screen.getByText('anthropic/claude-opus')).toBeTruthy();
    expect(screen.getByText(/fallback:profile:resilient/)).toBeTruthy();
    expect(screen.getByText(/subagent:subagent-2/)).toBeTruthy();
    expect(screen.getByText(/Error:/)).toBeTruthy();
    expect(screen.getByText(/Result:/)).toBeTruthy();
    expect(screen.getByText(/6m/)).toBeTruthy();
  });
});
