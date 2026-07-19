import { describe, expect, it } from 'vitest';
import { MemoryInjectorAgent } from '../src/middleware/memory-injector-agent.js';

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    todos: [],
    meta: {},
    provider: { capabilities: { maxContext: 100_000 } },
    ...overrides,
  } as never;
}

describe('MemoryInjectorAgent', () => {
  it('adds live todo and Kanban content to the retrieval plan', () => {
    const agent = new MemoryInjectorAgent();
    const plan = agent.plan({
      ctx: makeCtx({
        todos: [{ id: 't1', content: 'Refactor authentication package', status: 'in_progress' }],
        meta: { kanban: { title: 'Token refresh migration', tags: ['auth', 'oauth'] } },
      }),
      trigger: 'read',
      toolQuery: 'src/auth/session.ts',
      baseMaxHints: 8,
      baseMaxChars: 2800,
    });

    expect(plan.queryText).toContain('Refactor authentication package');
    expect(plan.queryText).toContain('Token refresh migration');
    expect(plan.maxHints).toBe(8);
    expect(plan.maxChars).toBe(2800);
  });

  it('shrinks but does not zero the memory budget under high context pressure', () => {
    const agent = new MemoryInjectorAgent();
    const ctx = makeCtx({ lastRequestTokens: 90_000 });
    const plan = agent.plan({
      ctx,
      trigger: 'bash',
      toolQuery: 'pnpm test',
      baseMaxHints: 8,
      baseMaxChars: 2800,
    });

    expect(plan.contextPressure).toBe(0.9);
    expect(plan.maxHints).toBe(3);
    expect(plan.maxChars).toBe(1260);

    agent.record(ctx, plan, { candidates: 12, eligible: 5, injected: 3, injectedChars: 900 });
    expect((ctx as never as { meta: Record<string, any> }).meta['memoryInjectorLastRun']).toMatchObject({
      candidates: 12,
      eligible: 5,
      injected: 3,
      injectedChars: 900,
    });
  });
});
