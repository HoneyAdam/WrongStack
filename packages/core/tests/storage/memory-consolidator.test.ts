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
 * Store mock that also exposes a Super Memory–shaped backend via `getBackend()`.
 * Used to prove the consolidator never routes deletions through the Super
 * Memory deletion API either — not just the legacy `forget()` path.
 */
const mkStoreWithBackend = () => {
  const deleteSuperMemory = vi.fn(async () => {});
  const listSuper = vi.fn(async () => [] as never[]);
  const store = {
    list: vi.fn(async () => [] as never[]),
    remember: vi.fn(async () => {}),
    forget: vi.fn(async () => 1),
    getBackend: vi.fn(() => ({ deleteSuperMemory, listSuper })),
  };
  return { store: store as never as MemoryStore & Record<string, ReturnType<typeof vi.fn>>, deleteSuperMemory, listSuper };
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
  it('applies add operations and logs a summary', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    store.list.mockResolvedValue([
      { scope: 'project-memory', text: 'old fact', ts: '2026-01-01T00:00:00Z' },
    ] as never);
    const ops = {
      operations: [
        { action: 'add', text: 'new fact', type: 'fact', priority: 'high', tags: ['x'] },
        { action: 'add', text: 'another fact', type: 'convention' },
      ],
    };
    const c = new SessionMemoryConsolidator({ memoryStore: store, provider: mkProvider(JSON.stringify(ops)) });
    c.afterRun(ctx(), result());
    // Consolidation is fire-and-forget — wait for the background IIFE to settle.
    await vi.waitFor(() => {
      expect(store.remember).toHaveBeenCalledTimes(2);
    });
    expect(store.remember).toHaveBeenCalledWith('new fact', undefined, expect.objectContaining({ type: 'fact' }));
    expect(store.remember).toHaveBeenCalledWith('another fact', undefined, expect.objectContaining({ type: 'convention' }));
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('2 added'));
  });

  it('ignores edit/delete ops entirely — add-only contract (regression: mass deletion)', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    // Even a well-formed delete/edit batch must never reach forget() or any
    // other mutation path — the consolidator no longer has deletion authority.
    const ops = {
      operations: [
        { action: 'delete', query: 'gone' },
        { action: 'edit', query: 'old', text: 'updated fact', type: 'fact' },
      ],
    };
    const c = new SessionMemoryConsolidator({ memoryStore: store, provider: mkProvider(JSON.stringify(ops)) });
    c.afterRun(ctx(), result());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.forget).not.toHaveBeenCalled();
    expect(store.remember).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });

  it('never routes deletions through the Super Memory backend either (regression: mass deletion)', async () => {
    // A future reintroduction of destructive routing could bypass forget()
    // by calling getBackend().deleteSuperMemory() — this test locks that path
    // out too, so the add-only contract holds regardless of which deletion
    // surface a regression tries to use.
    const { store: backendStore, deleteSuperMemory, listSuper } = mkStoreWithBackend();
    const ops = {
      operations: [
        { action: 'delete', query: 'gone' },
        { action: 'edit', query: 'old', text: 'updated fact' },
        { action: 'add', text: 'safe fact' },
      ],
    };
    const c = new SessionMemoryConsolidator({ memoryStore: backendStore, provider: mkProvider(JSON.stringify(ops)) });
    c.afterRun(ctx(), result());
    await vi.waitFor(() => {
      expect((backendStore as { remember: ReturnType<typeof vi.fn> }).remember).toHaveBeenCalledTimes(1);
    });
    expect(deleteSuperMemory).not.toHaveBeenCalled();
    expect(listSuper).not.toHaveBeenCalled();
    expect((backendStore as { forget: ReturnType<typeof vi.fn> }).forget).not.toHaveBeenCalled();
  });

  it('applies only the add ops from a mixed batch', async () => {
    const ops = {
      operations: [
        { action: 'add', text: 'kept fact', type: 'fact' },
        { action: 'delete', query: 'gone' },
        { action: 'edit', query: 'old', text: 'updated fact' },
      ],
    };
    const c = new SessionMemoryConsolidator({ memoryStore: store, provider: mkProvider(JSON.stringify(ops)) });
    c.afterRun(ctx(), result());
    await vi.waitFor(() => {
      expect(store.remember).toHaveBeenCalledTimes(1);
    });
    expect(store.remember).toHaveBeenCalledWith('kept fact', undefined, expect.any(Object));
    expect(store.forget).not.toHaveBeenCalled();
  });

  it('wraps JSON in surrounding prose and still extracts it', async () => {
    const text = 'Here is the result:\n{"operations":[{"action":"add","text":"wrapped fact"}]}\nDone.';
    const c = new SessionMemoryConsolidator({ memoryStore: store, provider: mkProvider(text) });
    c.afterRun(ctx(), result());
    await vi.waitFor(() => {
      expect(store.remember).toHaveBeenCalledWith('wrapped fact', undefined, expect.any(Object));
    });
  });

  it('ignores add operations with missing text without logging', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const ops = {
      operations: [
        { action: 'add' }, // no text
        { action: 'add', text: '   ' }, // blank text
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

  // ── End-to-end add-only contract ─────────────────────────────────────
  // Walks the full consolidator flow as one observable scenario: the LLM
  // emits a mixed batch of add/edit/delete ops, and only adds are applied.
  // Verifies that NO destructive surface (forget, deleteSuperMemory) is
  // ever touched — regardless of what the LLM returns. This is the
  // consolidator-side mirror of the propose→resolve deletion contract test.
  it('end-to-end: consolidator applies only adds and never touches any deletion surface', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const { store: backendStore, deleteSuperMemory, listSuper } = mkStoreWithBackend();

    // The LLM "helpfully" returns a full add/edit/delete batch — including
    // an edit that matches existing memory and a delete targeting real text.
    (backendStore as { list: ReturnType<typeof vi.fn> }).list.mockResolvedValue([
      { scope: 'project-memory', text: 'old fact that should survive', ts: '2026-01-01T00:00:00Z' },
      { scope: 'project-memory', text: 'another fact', ts: '2026-01-01T00:00:00Z' },
    ] as never);

    const ops = {
      operations: [
        { action: 'add', text: 'new convention discovered', type: 'convention', priority: 'high', tags: ['test'] },
        { action: 'edit', query: 'old fact', text: 'this edit should be ignored', type: 'fact' },
        { action: 'delete', query: 'another fact' },
        { action: 'add', text: 'second new fact', type: 'decision' },
        { action: 'delete', query: 'old fact that should survive' },
      ],
    };

    const c = new SessionMemoryConsolidator({ memoryStore: backendStore, provider: mkProvider(JSON.stringify(ops)) });
    c.afterRun(ctx(), result());

    // Wait for the background IIFE to settle.
    await vi.waitFor(() => {
      expect((backendStore as { remember: ReturnType<typeof vi.fn> }).remember).toHaveBeenCalledTimes(2);
    });

    // 1. Only the two add ops reached store.remember()
    const remember = (backendStore as { remember: ReturnType<typeof vi.fn> }).remember;
    expect(remember).toHaveBeenCalledWith('new convention discovered', undefined, expect.objectContaining({ type: 'convention' }));
    expect(remember).toHaveBeenCalledWith('second new fact', undefined, expect.objectContaining({ type: 'decision' }));

    // 2. NO deletion surface was ever called — the core invariant
    expect((backendStore as { forget: ReturnType<typeof vi.fn> }).forget).not.toHaveBeenCalled();
    expect(deleteSuperMemory).not.toHaveBeenCalled();
    expect(listSuper).not.toHaveBeenCalled();

    // 3. The summary log mentions only adds — no edits, no deletions
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('2 added'));
    expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining('deleted'));
    expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining('edited'));
  });
});
