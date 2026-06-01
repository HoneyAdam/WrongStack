import type { MemoryScope, MemoryStore, Tool } from '@wrongstack/core';

interface RememberInput {
  text: string;
  scope?: MemoryScope;
}

interface RememberOutput {
  ok: true;
  scope: MemoryScope;
}

interface ForgetInput {
  query: string;
  scope?: MemoryScope;
}

interface ForgetOutput {
  removed: number;
  scope: MemoryScope;
}

export function rememberTool(memory: MemoryStore): Tool<RememberInput, RememberOutput> {
  return {
    name: 'remember',
    category: 'Session',
    description:
      'Persist important long-term facts into project or user memory. These memories survive conversation restarts and are available to future sessions.',
    usageHint:
      'USE VERY SPARINGLY — ONLY FOR HIGH-VALUE RECURRING KNOWLEDGE:\n\n' +
      '- Good: coding standards, project conventions, user preferences, recurring architecture decisions, important facts.\n' +
      '- Bad: temporary state, current task progress, one-off notes → use `todo` or `plan` instead.\n' +
      '- `scope: "project"` → visible to all agents on this codebase.\n' +
      '- `scope: "user"` → personal to you.\n\n' +
      'Polluting memory with noise hurts future context quality. Be extremely deliberate.',
    permission: 'auto',
    mutating: true,
    timeoutMs: 2_000,
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The fact or note to remember. Keep it concise and factual.',
        },
        scope: {
          type: 'string',
          enum: ['project-agents', 'project-memory', 'user-memory'],
          description: 'Where to store it: project-memory (shared), user-memory (personal), or project-agents.',
        },
      },
      required: ['text'],
    },
    async execute(input) {
      if (!input?.text) throw new Error('remember: text is required');
      const scope = input.scope ?? 'project-memory';
      await memory.remember(input.text, scope);
      return { ok: true, scope };
    },
  };
}

export function forgetTool(memory: MemoryStore): Tool<ForgetInput, ForgetOutput> {
  return {
    name: 'forget',
    category: 'Session',
    description: 'Remove memory entries that contain the given substring (case-insensitive). Use with caution.',
    usageHint:
      'This permanently deletes matching memories in the chosen scope.\n' +
      '- Provide a reasonably specific `query` to avoid deleting unrelated memories.\n' +
      '- Always double-check before calling with broad queries.\n' +
      '- Use `remember` + `forget` together to maintain clean long-term memory.',
    permission: 'confirm',
    mutating: true,
    timeoutMs: 2_000,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        scope: { type: 'string', enum: ['project-agents', 'project-memory', 'user-memory'] },
      },
      required: ['query'],
    },
    async execute(input) {
      if (!input?.query) throw new Error('forget: query is required');
      const scope = input.scope ?? 'project-memory';
      const removed = await memory.forget(input.query, scope);
      return { removed, scope };
    },
  };
}
