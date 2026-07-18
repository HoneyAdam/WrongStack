import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InjectionTracker } from '../src/middleware/injection-tracker.js';
import { createSuperMemoryTurnMiddleware } from '../src/middleware/turn-memory.js';
import { isSqliteAvailable, SqliteSuperMemoryStore } from '../src/sqlite-store.js';
import { SuperMemoryStore } from '../src/store.js';
import type { SuperMemory } from '../src/types.js';

let tempDir: string;
let current: Date;

const T0 = '2026-01-01T00:00:00.000Z';

function advance(ms: number): void {
  current = new Date(current.getTime() + ms);
}

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wrongstack-feedback-'));
  current = new Date(T0);
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

function makeStore(): SuperMemoryStore {
  return new SuperMemoryStore({ projectRoot: tempDir, now: () => current });
}

describe('SuperMemoryStore feedback counters (JSONL)', () => {
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid counter flush interval: %s',
    (counterFlushIntervalMs) => {
      expect(() => new SuperMemoryStore({ projectRoot: tempDir, counterFlushIntervalMs }))
        .toThrow('counterFlushIntervalMs must be a finite, non-negative number.');
    },
  );

  it('accepts zero to disable counter batching', async () => {
    const store = new SuperMemoryStore({
      projectRoot: tempDir,
      now: () => current,
      counterFlushIntervalMs: 0,
    });
    const memory = await store.rememberSuper({ text: 'Use pnpm for all package operations.' });

    await store.recordInjection([memory.id], 'turn_context');
    await store.recordInjection([memory.id], 'tool:read');

    expect((await store.getSuperMemory(memory.id))?.injectionCount).toBe(2);
  });

  it('persists the first injection immediately and preserves updatedAt', async () => {
    const store = makeStore();
    const memory = await store.rememberSuper({ text: 'Use pnpm for all package operations.' });
    advance(2 * HOUR);
    await store.recordInjection([memory.id], 'turn_context');

    const loaded = await store.getSuperMemory(memory.id);
    expect(loaded?.injectionCount).toBe(1);
    expect(loaded?.useCount ?? 0).toBe(0);
    expect(loaded?.lastAccessedAt).toBe(current.toISOString());
    // Counter flushes must not look like a content edit: updatedAt is the
    // archive-unused age basis, so it has to survive feedback writes.
    expect(loaded?.updatedAt).toBe(T0);
  });

  it('batches increments within the flush interval and applies them additively', async () => {
    const store = makeStore();
    const memory = await store.rememberSuper({ text: 'Use pnpm for all package operations.' });

    await store.recordInjection([memory.id], 'turn_context'); // first flush → 1
    advance(30 * 60_000);
    await store.recordInjection([memory.id], 'turn_context');
    await store.recordInjection([memory.id], 'tool:read');
    await store.recordInjection([memory.id], 'tool:grep');
    expect((await store.getSuperMemory(memory.id))?.injectionCount).toBe(1); // pending not yet persisted

    advance(31 * 60_000); // now 61 min since the flush at T0
    await store.recordInjection([memory.id], 'turn_context'); // due → flush 3 pending + this one
    expect((await store.getSuperMemory(memory.id))?.injectionCount).toBe(5);
  });

  it('keeps increments additive across store instances sharing the same project', async () => {
    const storeA = makeStore();
    const storeB = makeStore();
    const memory = await storeA.rememberSuper({ text: 'Use pnpm for all package operations.' });

    await storeA.recordInjection([memory.id], 'turn_context'); // A flushes → 1
    await storeB.recordInjection([memory.id], 'turn_context'); // B reloads, flushes → 2

    advance(61 * 60_000);
    await storeA.recordInjection([memory.id], 'turn_context'); // A reloads from disk (2) + 1 → 3

    expect((await storeB.getSuperMemory(memory.id))?.injectionCount).toBe(3);
  });

  it('recordUse increments useCount and stamps lastUsedAt', async () => {
    const store = makeStore();
    const memory = await store.rememberSuper({ text: 'Use pnpm for all package operations.' });
    advance(3 * HOUR);
    await store.recordUse([memory.id], 'assistant_reference');

    const loaded = await store.getSuperMemory(memory.id);
    expect(loaded?.useCount).toBe(1);
    expect(loaded?.injectionCount ?? 0).toBe(0);
    expect(loaded?.lastUsedAt).toBe(current.toISOString());
    expect(loaded?.lastAccessedAt).toBe(current.toISOString());
  });

  it('hygiene creates a review candidate for an active memory injected often but never used (does NOT auto-archive)', async () => {
    const store = makeStore();
    const memory = await store.rememberSuper({ text: 'Use pnpm for all package operations.' });

    await store.recordInjection([memory.id], 'turn_context');
    for (let i = 0; i < 9; i++) {
      advance(61 * 60_000);
      await store.recordInjection([memory.id], 'turn_context');
    }
    expect((await store.getSuperMemory(memory.id))?.injectionCount).toBe(10);

    advance(31 * DAY);
    const report = await store.hygiene({ verify: false, archiveUnusedAfterDays: 30, unusedMinInjections: 10 });

    // Hygiene now produces a review candidate instead of auto-archiving.
    // The memory's status must NOT change — final decision is the user's.
    expect(report.reviewCandidatesCreated).toBe(1);
    // Historical fields kept for backward compatibility; now always 0.
    expect(report.archivedUnused).toBe(0);
    expect(report.archived).toBe(0);
    expect(report.deleted).toBe(0);
    expect((await store.getSuperMemory(memory.id))?.status).toBe('active');

    // The candidate exists and is pending review.
    const candidates = await store.listCandidates();
    expect(candidates).toHaveLength(1);
    const candidate = candidates[0]!;
    expect(candidate.status).toBe('pending');
    expect(candidate.text).toBe(memory.text);
    expect(candidate.tags.some((tag) => tag === 'review:injected_never_used')).toBe(true);
    expect(candidate.tags.some((tag) => tag === 'suggested:delete')).toBe(true);
  });

  it('hygiene keeps a memory that was used at least once', async () => {
    const store = makeStore();
    const memory = await store.rememberSuper({ text: 'Use pnpm for all package operations.' });

    await store.recordInjection([memory.id], 'turn_context');
    for (let i = 0; i < 9; i++) {
      advance(61 * 60_000);
      await store.recordInjection([memory.id], 'turn_context');
    }
    advance(61 * 60_000);
    await store.recordUse([memory.id], 'assistant_reference');

    advance(31 * DAY);
    const report = await store.hygiene({ verify: false, archiveUnusedAfterDays: 30, unusedMinInjections: 10 });

    expect(report.archivedUnused).toBe(0);
    expect((await store.getSuperMemory(memory.id))?.status).toBe('active');
    // No review candidate should be produced for a used memory.
    expect(report.reviewCandidatesCreated).toBe(0);
    expect(await store.listCandidates()).toHaveLength(0);
  });

  it('hygiene ignores memories below the injection threshold', async () => {
    const store = makeStore();
    const memory = await store.rememberSuper({ text: 'Use pnpm for all package operations.' });

    await store.recordInjection([memory.id], 'turn_context');
    advance(61 * 60_000);
    await store.recordInjection([memory.id], 'turn_context');
    advance(61 * 60_000);
    await store.recordInjection([memory.id], 'turn_context');

    advance(31 * DAY);
    const report = await store.hygiene({ verify: false, archiveUnusedAfterDays: 30, unusedMinInjections: 10 });

    expect(report.archivedUnused).toBe(0);
    expect((await store.getSuperMemory(memory.id))?.status).toBe('active');
    // Below-threshold memories shouldn't produce review candidates either.
    expect(report.reviewCandidatesCreated).toBe(0);
    expect(await store.listCandidates()).toHaveLength(0);
  });

  it('stats aggregates injections and uses across memories', async () => {
    const store = makeStore();
    const a = await store.rememberSuper({ text: 'Use pnpm for all package operations.' });
    const b = await store.rememberSuper({ text: 'Run tests with vitest, never jest.' });

    await store.recordInjection([a.id, b.id], 'turn_context');
    await store.recordUse([a.id], 'assistant_reference');

    const stats = await store.stats();
    expect(stats.injections).toBe(2);
    expect(stats.uses).toBe(1);
  });
});

describe('InjectionTracker', () => {
  const TEXT = 'Use pnpm for installing dependencies in this repo';

  it('matches a referencing assistant message exactly once (consume-once)', () => {
    const tracker = new InjectionTracker();
    tracker.record('mem_a', TEXT);

    expect(tracker.consumeMatches('I will use pnpm for installing dependencies now.')).toEqual(['mem_a']);
    expect(tracker.consumeMatches('I will use pnpm for installing dependencies now.')).toEqual([]);
  });

  it('does not match unrelated assistant text', () => {
    const tracker = new InjectionTracker();
    tracker.record('mem_a', TEXT);

    expect(tracker.consumeMatches('The database migration failed with a constraint error.')).toEqual([]);
  });

  it('ignores memories too short to be a trustworthy signal', () => {
    const tracker = new InjectionTracker();
    tracker.record('mem_short', 'Use pnpm');

    expect(tracker.consumeMatches('I will use pnpm now.')).toEqual([]);
  });

  it('expires tracked injections after the TTL', () => {
    const tracker = new InjectionTracker({ ttlMs: 1_000 });
    tracker.record('mem_a', TEXT, 5_000);

    expect(tracker.consumeMatches('I will use pnpm for installing dependencies now.', 7_000)).toEqual([]);
  });
});

describe('createSuperMemoryTurnMiddleware feedback loop', () => {
  const memory: SuperMemory = {
    id: 'mem_feedback',
    revision: 1,
    scope: 'project',
    kind: 'convention',
    status: 'active',
    text: 'Always run lifecycle tests with pnpm vitest before committing.',
    importance: 0.95,
    confidence: 0.95,
    freshness: 0.9,
    tags: [],
    anchors: [],
    sources: [],
    createdAt: T0,
    updatedAt: T0,
  };

  function makeService() {
    return {
      searchSuper: vi.fn(async (query: string) => (query.includes('lifecycle') ? [memory] : [])),
      recordInjection: vi.fn(async () => {}),
      recordUse: vi.fn(async () => {}),
    };
  }

  it('credits recordUse when the next assistant message references an injected memory', async () => {
    const service = makeService();
    const tracker = new InjectionTracker();
    const middleware = createSuperMemoryTurnMiddleware({ memory: service, tracker });

    const turn1 = {
      model: 'test',
      system: [],
      messages: [{ role: 'user' as const, content: 'How do I run the lifecycle tests?' }],
    };
    const injected = await middleware.handler(turn1 as never, async (next) => next);
    expect(service.recordInjection).toHaveBeenCalledWith(['mem_feedback'], 'turn_context');
    expect(injected.system?.some((block) => block.text.includes('pnpm vitest'))).toBe(true);

    const turn2 = {
      model: 'test',
      system: injected.system,
      messages: [
        { role: 'user' as const, content: 'How do I run the lifecycle tests?' },
        { role: 'assistant' as const, content: 'I will run lifecycle tests with pnpm vitest now before committing.' },
        { role: 'user' as const, content: 'Thanks.' },
      ],
    };
    await middleware.handler(turn2 as never, async (next) => next);

    expect(service.recordUse).toHaveBeenCalledTimes(1);
    expect(service.recordUse).toHaveBeenCalledWith(['mem_feedback'], 'assistant_reference');
  });

  it('does not credit a use when the assistant ignores the injection', async () => {
    const service = makeService();
    const tracker = new InjectionTracker();
    const middleware = createSuperMemoryTurnMiddleware({ memory: service, tracker });

    const turn1 = {
      model: 'test',
      system: [],
      messages: [{ role: 'user' as const, content: 'How do I run the lifecycle tests?' }],
    };
    await middleware.handler(turn1 as never, async (next) => next);

    const turn2 = {
      model: 'test',
      system: [],
      messages: [
        { role: 'user' as const, content: 'How do I run the lifecycle tests?' },
        { role: 'assistant' as const, content: 'The database migration failed with a constraint error.' },
        { role: 'user' as const, content: 'Thanks.' },
      ],
    };
    await middleware.handler(turn2 as never, async (next) => next);

    expect(service.recordUse).not.toHaveBeenCalled();
  });
});

describe.skipIf(!isSqliteAvailable())('SqliteSuperMemoryStore feedback counters', () => {
  let sqliteStores: SqliteSuperMemoryStore[] = [];

  beforeEach(() => {
    sqliteStores = [];
  });

  afterEach(async () => {
    for (const store of sqliteStores) {
      try { store.close(); } catch { /* already closed */ }
    }
    // Give Windows a tick to release WAL file handles
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  function makeSqliteStore(): SqliteSuperMemoryStore {
    const store = new SqliteSuperMemoryStore({ projectRoot: tempDir, now: () => current });
    sqliteStores.push(store);
    return store;
  }

  it('applies counter increments immediately (no batching throttle)', async () => {
    const store = makeSqliteStore();
    const memory = await store.rememberSuper({ text: 'Use pnpm for all package operations.' });

    await store.recordInjection([memory.id], 'turn_context');
    await store.recordInjection([memory.id], 'tool:read');
    await store.recordUse([memory.id], 'assistant_reference');

    const [loaded] = await store.listMemories({ status: 'active', limit: 10 });
    expect(loaded?.injectionCount).toBe(2);
    expect(loaded?.useCount).toBe(1);
    expect(loaded?.lastUsedAt).toBe(current.toISOString());
    expect(loaded?.lastAccessedAt).toBe(current.toISOString());
  });

  it('SQLite hygiene currently does NOT auto-archive — report fields reflect zero', async () => {
    // SQLite backend's hygiene() is a separate implementation that was already
    // a near-stub before the redesign (it never had the unused-rule code-path
    // that the JSONL store's hygieneUnlocked had). The redesigned JSONL
    // pipeline (no auto-archive, only review candidates) is the source of
    // truth — the SQLite report's `archived`/`archivedUnused` fields are
    // intentionally zero to mirror the new contract. A full parity follow-up
    // is tracked separately; this test pins the *current* contract surface.
    const store = makeSqliteStore();
    const memory = await store.rememberSuper({ text: 'Use pnpm for all package operations.' });

    advance(40 * DAY);
    for (let i = 0; i < 10; i++) {
      await store.recordInjection([memory.id], 'turn_context');
    }

    const report = await store.hygiene({ archiveUnusedAfterDays: 30, unusedMinInjections: 10 });
    expect(report.archivedUnused).toBe(0);
    expect(report.archived).toBe(0);
    expect(report.deleted).toBe(0);

    // Memory status must NOT change — same invariant as the JSONL store.
    const refreshed = await store.listMemories({ status: 'active', limit: 100 });
    expect(refreshed.some((item) => item.id === memory.id)).toBe(true);
  });
});
