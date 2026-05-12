import type { Tool, TodoItem } from '@wrongstack/core';

interface TodoInput {
  todos: TodoItem[];
}

interface TodoOutput {
  count: number;
  in_progress: number;
}

export const todoTool: Tool<TodoInput, TodoOutput> = {
  name: 'todo',
  description: 'Replace the current todo list with a new set of items.',
  usageHint:
    'Use for multi-step tasks. Replace the full list on each call. At most ONE task may be in_progress at a time. Items have id, content, status (pending|in_progress|completed), and optional activeForm.',
  permission: 'auto',
  mutating: false,
  timeoutMs: 1_000,
  inputSchema: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            content: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            activeForm: { type: 'string' },
          },
          required: ['id', 'content', 'status'],
        },
      },
    },
    required: ['todos'],
  },
  async execute(input, ctx) {
    if (!Array.isArray(input?.todos)) {
      throw new Error('todo: todos must be an array');
    }
    const items = input.todos.filter((t): t is TodoItem => Boolean(t?.id && t.content));
    const inProgress = items.filter((t) => t.status === 'in_progress');
    if (inProgress.length > 1) {
      // Keep only the first as in_progress, mark rest pending
      let seenInProgress = false;
      for (const item of items) {
        if (item.status === 'in_progress') {
          if (seenInProgress) item.status = 'pending';
          seenInProgress = true;
        }
      }
    }
    ctx.todos = items;
    return {
      count: items.length,
      in_progress: items.filter((t) => t.status === 'in_progress').length,
    };
  },
};
