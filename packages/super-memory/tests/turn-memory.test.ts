import { describe, expect, it } from 'vitest';
import { createSuperMemoryTurnMiddleware } from '../src/middleware/turn-memory.js';
import type { SuperMemory } from '../src/types.js';
import type { Message } from '@wrongstack/core';

describe('createSuperMemoryTurnMiddleware', () => {
  const makeMemory = (overrides: Partial<SuperMemory> = {}): SuperMemory => ({
    id: `mem_${Date.now()}`,
    revision: 1,
    scope: 'project',
    kind: 'fact',
    status: 'active',
    text: 'Always run lifecycle tests.',
    importance: 0.95,
    confidence: 0.95,
    freshness: 0.9,
    tags: [],
    anchors: [],
    sources: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  it('injects turn-level memory into system prompt', async () => {
    const memory = {
      searchSuper: async () => [makeMemory()],
      recordInjection: async () => {},
    };
    const middleware = createSuperMemoryTurnMiddleware({ memory });
    const request = {
      model: 'test',
      messages: [{ role: 'user' as const, content: 'Change the session lifecycle.' }],
      system: [{ type: 'text' as const, text: 'Base prompt' }],
    };

    const result = await middleware.handler(request as never, async (next) => next);
    expect(result.system).toHaveLength(2);
    expect(result.system?.[1]?.text).toContain('Always run lifecycle tests.');
  });

  it('does not inject when no user text matches', async () => {
    const memory = {
      searchSuper: async () => [],
      recordInjection: async () => {},
    };
    const middleware = createSuperMemoryTurnMiddleware({ memory });
    const request = {
      model: 'test',
      messages: [{ role: 'user' as const, content: 'Hello.' }],
      system: [],
    };

    const result = await middleware.handler(request as never, async (next) => next);
    expect(result.system).toHaveLength(0);
  });

  it('skips memories already in the system prompt', async () => {
    const memory = {
      searchSuper: async () => [makeMemory({ text: 'Always run lifecycle tests.' })],
      recordInjection: async () => {},
    };
    const middleware = createSuperMemoryTurnMiddleware({ memory });
    const request = {
      model: 'test',
      messages: [{ role: 'user' as const, content: 'Change the lifecycle.' }],
      system: [{ type: 'text' as const, text: 'Always run lifecycle tests.' }],
    };

    const result = await middleware.handler(request as never, async (next) => next);
    expect(result.system).toHaveLength(1);
  });

  it('filters by minScore', async () => {
    const memory = {
      searchSuper: async () => [makeMemory({ importance: 0.1, confidence: 0.1, freshness: 0.1 })],
      recordInjection: async () => {},
    };
    const middleware = createSuperMemoryTurnMiddleware({ memory, minScore: 0.9 });
    const request = {
      model: 'test',
      messages: [{ role: 'user' as const, content: 'Low quality memory.' }],
      system: [],
    };

    const result = await middleware.handler(request as never, async (next) => next);
    expect(result.system).toHaveLength(0);
  });

  it('includes low-score memory with importance >= 0.95', async () => {
    const memory = {
      searchSuper: async () => [makeMemory({ importance: 0.95, confidence: 0.1, freshness: 0.1 })],
      recordInjection: async () => {},
    };
    const middleware = createSuperMemoryTurnMiddleware({ memory, minScore: 0.9 });
    const request = {
      model: 'test',
      messages: [{ role: 'user' as const, content: 'High importance low confidence.' }],
      system: [],
    };

    const result = await middleware.handler(request as never, async (next) => next);
    expect(result.system).toHaveLength(1);
  });

  it('handles string content messages', async () => {
    const memory = {
      searchSuper: async () => [makeMemory()],
      recordInjection: async () => {},
    };
    const middleware = createSuperMemoryTurnMiddleware({ memory });
    const request = {
      model: 'test',
      messages: [{ role: 'user' as const, content: 'Testing string content' }],
      system: [],
    };

    const result = await middleware.handler(request as never, async (next) => next);
    expect(result.system).toHaveLength(1);
  });

  it('handles messages with content blocks', async () => {
    const memory = {
      searchSuper: async () => [makeMemory()],
      recordInjection: async () => {},
    };
    const middleware = createSuperMemoryTurnMiddleware({ memory });
    const request = {
      model: 'test',
      messages: [{
        role: 'user' as const,
        content: [{ type: 'text' as const, text: 'Block content' }],
      }],
      system: [],
    };

    const result = await middleware.handler(request as never, async (next) => next);
    expect(result.system).toHaveLength(1);
  });

  it('fails open when searchSuper throws', async () => {
    const memory = {
      searchSuper: async () => { throw new Error('unavailable'); },
    };
    const middleware = createSuperMemoryTurnMiddleware({ memory });
    const request = {
      model: 'test',
      messages: [{ role: 'user' as const, content: 'Test' }],
      system: [],
    };

    const result = await middleware.handler(request as never, async (next) => next);
    expect(result).toBe(request);
  });

  it('returns unchanged request when no user message found', async () => {
    const memory = {
      searchSuper: async () => [makeMemory()],
      recordInjection: async () => {},
    };
    const middleware = createSuperMemoryTurnMiddleware({ memory });
    const request = {
      model: 'test',
      messages: [{ role: 'assistant' as const, content: 'I say things.' }],
      system: [],
    };

    const result = await middleware.handler(request as never, async (next) => next);
    expect(result.system).toHaveLength(0);
  });

  it('deduplicates memories with same text key', async () => {
    const memory = {
      searchSuper: async () => [
        makeMemory({ id: 'mem_1', text: 'Duplicate text.' }),
        makeMemory({ id: 'mem_2', text: 'Duplicate text.' }),
      ],
      recordInjection: async () => {},
    };
    const middleware = createSuperMemoryTurnMiddleware({ memory });
    const request = {
      model: 'test',
      messages: [{ role: 'user' as const, content: 'dedup' }],
      system: [],
    };

    const result = await middleware.handler(request as never, async (next) => next);
    // Only one injected because second has same normalized text
    expect(result.system).toHaveLength(1);
  });
});
