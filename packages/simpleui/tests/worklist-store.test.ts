import { describe, expect, it, vi } from 'vitest';
import {
  createWorklistStore,
  parseSimplePlan,
  parseSimpleTasks,
  parseSimpleTodos,
} from '../src/lib/worklist-store.js';

describe('SimpleUI worklist store', () => {
  it('parses valid work items and drops malformed server entries', () => {
    expect(
      parseSimpleTodos([
        { id: 'todo-1', content: 'Ship it', status: 'pending' },
        { id: 'bad', content: { unsafe: true }, status: 'pending' },
      ]),
    ).toEqual([{ id: 'todo-1', content: 'Ship it', status: 'pending' }]);

    expect(
      parseSimpleTasks([
        { id: 'task-1', title: 'Test it', status: 'review', type: 'test', priority: 'high' },
        { id: 'task-2', title: 'Legacy shape', status: 'pending' },
      ]),
    ).toEqual([
      { id: 'task-1', title: 'Test it', status: 'review', type: 'test', priority: 'high' },
      { id: 'task-2', title: 'Legacy shape', status: 'pending', type: 'chore', priority: 'medium' },
    ]);

    expect(
      parseSimplePlan({ items: [{ id: 'plan-1', title: 'First step', status: 'in_progress' }] }),
    ).toEqual([{ id: 'plan-1', title: 'First step', status: 'in_progress' }]);
  });

  it('publishes matching worklist updates without accepting stale-session frames', () => {
    const store = createWorklistStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.reset('session-a');

    expect(
      store.applyMessage({
        type: 'todos.updated',
        payload: {
          sessionId: 'session-a',
          todos: [{ id: 'todo-1', content: 'Current', status: 'in_progress' }],
        },
      }),
    ).toBe(true);
    expect(store.getSnapshot().todos[0]?.content).toBe('Current');

    expect(
      store.applyMessage({
        type: 'todos.updated',
        payload: {
          sessionId: 'session-b',
          todos: [{ id: 'todo-2', content: 'Stale', status: 'pending' }],
        },
      }),
    ).toBe(false);
    expect(store.getSnapshot().todos).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
