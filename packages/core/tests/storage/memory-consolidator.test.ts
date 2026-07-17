import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionMemoryConsolidator } from '../../src/storage/memory-consolidator.js';
import type { Context } from '../../src/core/context.js';
import type { RunResult } from '../../src/core/agent-types.js';
import type { MemoryStore } from '../../src/types/memory.js';
import type { Provider } from '../../src/types/provider.js';

const mkStore = () =>
  ({
    list: vi.fn(async () => [] as never[]),
    remember: vi.fn(async () => {}),
    forget: vi.fn(async () => 1),
  }) as never as MemoryStore & {
    list: ReturnType<typeof vi.fn>;
    remember: ReturnType<typeof vi.fn>;
    forget: ReturnType<typeof vi.fn>;
  };

/**
 * A mock store whose `getBackend()` returns a Super Memory-shaped backend
 * with `deleteSuperMemory` + `listSuper`. `permanentIds` are entries that
 * `deleteSuperMemory` refuses to remove (matching the real store's
 * `persistence:'permanent'` + force guard).
 */
const mkSuperStore = (memories: Array<{ id: string; text: string; scope?: string; status?: string }>, permanentIds: Set<string> = new Set()) => {
  const deleteSuperMemory = vi.fn(async (id: string, _reason?: string) => {
    if (permanentIds.has(id)) {
      throw new Error(`Super Memory "${id}" is marked 'permanent' and cannot be deleted.`);
    }
    const idx = memories.findIndex((m) => m.id === id);
    if (idx >= 0) memories.splice(idx, 1);
  });
  const listSuper = vi.fn(async () =>
    memories.map((m) => ({
      ...m,
      scope: m.scope ?? 'project',
      legacyScope: 'project-memory',
      status: m.status ?? 'active',
      tags: [],
      anchors: [],
    })),
  );
  const store = {
    list: vi.fn(async () => [] as never[]),
    remember: vi.fn(async () => {}),
    forget: vi.fn(async () => 0),
    getBackend: () => ({ deleteSuperMemory, listSuper }),
  } as never as MemoryStore & {
    list: ReturnType<typeof vi.fn>;
    remember: ReturnType<typeof vi.fn>;
    forget: ReturnType<typeof vi.fn>;
    getBackend: () => { deleteSuperMemory: typeof deleteSuperMemory; listSuper: typeof listSuper };
  };
  return { store, deleteSuperMemory, listSuper };
};

const mkProvider = (text: string): Provider =>
  ({
    complete: vi.fn(async () => ({ content: [{ type: 'text', text }], stopReason: 'end_turn' })),
  }) as never as Provider;

const ctx = (provider?: Provider): Context => ({ provider, model: 'haiku' }) as never as Context;

const result = (over: Partial<RunResult> = {}): RunResult =>
  ({ status: 'done', finalText: 'a meaningful session summary text', iterations: 5, ...over }) as RunResult;

let store: ReturnType<typeof mkStore>;
beforeEach(() => {
  store = mkStore();
});
afterEach(() => vi.restoreAllMocks());

describe('SessionMemoryConsolidator early returns', () => {
  it('skips non-done sessions', async () => {
    const c = new SessionMemoryConsolidator({ memoryStore: store });
    await c.afterRun(ctx(mkProvider('{}')), result({ status: 'error' }));
    expect(store.list).not.toHaveBeenCalled();
  });

  it('skips sessions with trivial final text', async () => {
    const c = new SessionMemoryConsolidator({ memoryStore: store });
    await c.afterRun(ctx(mkProvider('{}')), result({ finalText: 'short' }));
    expect(store.list).not.toHaveBeenCalled();
  });

  it('skips sessions below the iteration floor', async () => {
    const c = new SessionMemoryConsolidator({ memoryStore: store, minIterations: 5 });
    await c.afterRun(ctx(mkProvider('{}')), result({ iterations: 2 }));
    expect(store.list).not.toHaveBeenCalled();
  });

  it('skips when there is no provider', async () => {
    const c = new SessionMemoryConsolidator({ memoryStore: store });
    await c.afterRun(ctx(undefined), result());
    expect(store.list).not.toHaveBeenCalled();
  });

  it('skips when the provider has no complete method', async () => {
    const c = new SessionMemoryConsolidator({ memoryStore: store });
    await c.afterRun(ctx({} as Provider), result());
    expect(store.list).not.toHaveBeenCalled();
  });
});

describe('SessionMemoryConsolidator operations', () => {
  it('applies add/edit/delete operations and logs a summary', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    store.list.mockResolvedValue([
      { scope: 'project-memory', text: 'old fact', ts: '2026-01-01T00:00:00Z' },
    ] as never);
    const ops = {
      operations: [
        { action: 'add', text: 'new fact', type: 'fact', priority: 'high', tags: ['x'] },
        { action: 'edit', query: 'old', text: 'updated fact', type: 'fact' },
        { action: 'delete', query: 'gone' },
      ],
    };
    const c = new SessionMemoryConsolidator({ memoryStore: store, provider: mkProvider(JSON.stringify(ops)) });
    c.afterRun(ctx(), result());
    // Consolidation is fire-and-forget — wait for the background IIFE to settle.
    await vi.waitFor(() => {
      expect(store.remember).toHaveBeenCalledTimes(2); // add + edit
    });
    expect(store.forget).toHaveBeenCalledTimes(2); // edit + delete
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('consolidation'));
  });

  it('wraps JSON in surrounding prose and still extracts it', async () => {
    const text = 'Here is the result:\n{"operations":[{"action":"add","text":"wrapped fact"}]}\nDone.';
    const c = new SessionMemoryConsolidator({ memoryStore: store, provider: mkProvider(text) });
    c.afterRun(ctx(), result());
    await vi.waitFor(() => {
      expect(store.remember).toHaveBeenCalledWith('wrapped fact', undefined, expect.any(Object));
    });
  });

  it('ignores operations with missing fields without logging', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const ops = {
      operations: [
        { action: 'add' }, // no text
        { action: 'edit', query: 'q' }, // no text
        { action: 'delete' }, // no query
      ],
    };
    const c = new SessionMemoryConsolidator({ memoryStore: store, provider: mkProvider(JSON.stringify(ops)) });
    c.afterRun(ctx(), result());
    // Give the fire-and-forget IIFE time to settle, then verify nothing was written.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.remember).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });

  it('returns when the model produces no text', async () => {
    const c = new SessionMemoryConsolidator({ memoryStore: store, provider: mkProvider('   ') });
    c.afterRun(ctx(), result());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.remember).not.toHaveBeenCalled();
  });

  it('returns when there is no JSON object in the response', async () => {
    const c = new SessionMemoryConsolidator({ memoryStore: store, provider: mkProvider('no json here') });
    c.afterRun(ctx(), result());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.remember).not.toHaveBeenCalled();
  });

  it('returns when operations is empty or not an array', async () => {
    const c1 = new SessionMemoryConsolidator({ memoryStore: store, provider: mkProvider('{"operations":[]}') });
    c1.afterRun(ctx(), result());
    const c2 = new SessionMemoryConsolidator({ memoryStore: store, provider: mkProvider('{"operations":"nope"}') });
    c2.afterRun(ctx(), result());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.remember).not.toHaveBeenCalled();
  });

  it('swallows a malformed-JSON parse error', async () => {
    const c = new SessionMemoryConsolidator({ memoryStore: store, provider: mkProvider('{ not valid json }') });
    c.afterRun(ctx(), result());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.remember).not.toHaveBeenCalled();
  });

  it('swallows a provider failure', async () => {
    const provider = { complete: vi.fn(async () => { throw new Error('llm down'); }) } as never as Provider;
    const c = new SessionMemoryConsolidator({ memoryStore: store, provider });
    c.afterRun(ctx(), result());
    await new Promise((resolve) => setTimeout(resolve, 10));
    // No throw = pass. No memory was touched.
    expect(store.remember).not.toHaveBeenCalled();
  });
});

describe('SessionMemoryConsolidator Super Memory backend routing', () => {
  it('routes delete ops through deleteSuperMemory by id with the LLM reason', async () => {
    const memories = [
      { id: 'mem_aaa', text: 'old convention about pnpm' },
      { id: 'mem_bbb', text: 'unrelated fact' },
    ];
    const { store: superStore, deleteSuperMemory, listSuper } = mkSuperStore(memories);
    const ops = { operations: [{ action: 'delete', query: 'pnpm' }] };
    const c = new SessionMemoryConsolidator({ memoryStore: superStore, provider: mkProvider(JSON.stringify(ops)) });
    c.afterRun(ctx(), result());

    await vi.waitFor(() => {
      expect(listSuper).toHaveBeenCalled();
    });
    // Only mem_aaa matched "pnpm" — deleteSuperMemory should be called once.
    await vi.waitFor(() => {
      expect(deleteSuperMemory).toHaveBeenCalledTimes(1);
    });
    expect(deleteSuperMemory).toHaveBeenCalledWith('mem_aaa', expect.stringContaining('memory-consolidator delete'));
    // forget() must NOT be used when the backend is a Super Memory store.
    expect(superStore.forget).not.toHaveBeenCalled();
    // mem_bbb survives.
    expect(deleteSuperMemory).not.toHaveBeenCalledWith('mem_bbb', expect.anything());
  });

  it('skips permanent memories instead of crashing when deleteSuperMemory throws', async () => {
    const memories = [
      { id: 'mem_perm', text: 'permanent fact about pnpm' },
      { id: 'mem_norm', text: 'normal fact about pnpm' },
    ];
    const permanentIds = new Set(['mem_perm']);
    const { store: superStore, deleteSuperMemory } = mkSuperStore(memories, permanentIds);
    const ops = { operations: [{ action: 'delete', query: 'pnpm' }] };
    const c = new SessionMemoryConsolidator({ memoryStore: superStore, provider: mkProvider(JSON.stringify(ops)) });
    c.afterRun(ctx(), result());

    await vi.waitFor(() => {
      expect(deleteSuperMemory).toHaveBeenCalledTimes(2);
    });
    // The normal one was deleted; the permanent one threw and was skipped.
    expect(deleteSuperMemory).toHaveBeenCalledWith('mem_norm', expect.anything());
    expect(deleteSuperMemory).toHaveBeenCalledWith('mem_perm', expect.anything());
  });

  it('falls back to forget() when no Super Memory backend is present', async () => {
    const ops = { operations: [{ action: 'delete', query: 'gone' }] };
    const c = new SessionMemoryConsolidator({ memoryStore: store, provider: mkProvider(JSON.stringify(ops)) });
    c.afterRun(ctx(), result());
    await vi.waitFor(() => {
      expect(store.forget).toHaveBeenCalledWith('gone');
    });
  });

  it('routes edit ops through deleteSuperMemory then remember', async () => {
    const memories = [{ id: 'mem_old', text: 'old pnpm fact' }];
    const { store: superStore, deleteSuperMemory } = mkSuperStore(memories);
    const ops = { operations: [{ action: 'edit', query: 'pnpm', text: 'new pnpm v9 fact' }] };
    const c = new SessionMemoryConsolidator({ memoryStore: superStore, provider: mkProvider(JSON.stringify(ops)) });
    c.afterRun(ctx(), result());

    await vi.waitFor(() => {
      expect(deleteSuperMemory).toHaveBeenCalledTimes(1);
    });
    expect(deleteSuperMemory).toHaveBeenCalledWith('mem_old', expect.stringContaining('memory-consolidator edit'));
    await vi.waitFor(() => {
      expect(superStore.remember).toHaveBeenCalledWith('new pnpm v9 fact', undefined, expect.any(Object));
    });
    expect(superStore.forget).not.toHaveBeenCalled();
  });
});
