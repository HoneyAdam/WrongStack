import type { Tool, MemoryScope, MemoryStore } from '@wrongstack/core';

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
    description: 'Persist a short note to project or user memory.',
    usageHint:
      'Use sparingly. Only for facts that should outlive the session (project conventions, user preferences). Transient state belongs in `todo`. Scope defaults to project-memory.',
    permission: 'auto',
    mutating: true,
    timeoutMs: 2_000,
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        scope: { type: 'string', enum: ['project-agents', 'project-memory', 'user-memory'] },
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
    description: 'Remove memory entries matching a substring (case-insensitive).',
    usageHint: 'Removes ALL matching bullet lines in the given scope. Use a unique substring.',
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
