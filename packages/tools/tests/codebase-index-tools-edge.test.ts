import type { Context } from '@wrongstack/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Control the index host's reported state so each status-gate branch of the
// three codebase tools runs without a real SQLite index / worker.
type Circuit = { state: string; cooldownRemainingMs: number; lastFailure?: string };
const state: {
  ready: boolean;
  indexing: boolean;
  currentFile: number;
  totalFiles: number;
  lastError?: string;
  circuit: Circuit;
} = { ready: true, indexing: false, currentFile: 0, totalFiles: 0, circuit: { state: 'closed', cooldownRemainingMs: 0 } };

let isIndexingValue = false;
let statsError: Error | undefined;
let statsCalls = 0;
const statsValue = {
  totalSymbols: 5,
  totalFiles: 2,
  byLang: { ts: 5 },
  byKind: { function: 5 },
  lastIndexed: 1 as number | null,
  sizeBytes: 100,
  indexPath: '/x',
  version: 1,
};
let circuitSnapshot: Circuit = { state: 'closed', cooldownRemainingMs: 0 };

vi.mock('../src/codebase-index/background-indexer.js', () => ({
  getIndexState: () => state,
  isIndexing: () => isIndexingValue,
  codebaseIndexStats: async () => {
    statsCalls += 1;
    if (statsError) throw statsError;
    return statsValue;
  },
  searchCodebaseIndex: async () => ({ results: [], total: 0 }),
  runStartupIndex: async () => ({
    filesIndexed: 1,
    symbolsIndexed: 1,
    langStats: {},
    durationMs: 1,
    errors: [],
  }),
}));

vi.mock('../src/codebase-index/circuit-breaker.js', () => ({
  IndexTimeoutError: class IndexTimeoutError extends Error {
    override name = 'IndexTimeoutError';
  },
  indexCircuitBreaker: { snapshot: () => circuitSnapshot },
}));

import { codebaseIndexTool } from '../src/codebase-index/codebase-index-tool.js';
import { codebaseSearchTool } from '../src/codebase-index/codebase-search-tool.js';
import { codebaseStatsTool } from '../src/codebase-index/codebase-stats-tool.js';

const ctx = () => ({ cwd: '/p', projectRoot: '/p', tools: [], meta: {} }) as never as Context;
const opts = () => ({ signal: new AbortController().signal });

beforeEach(() => {
  state.ready = true;
  state.indexing = false;
  state.currentFile = 0;
  state.totalFiles = 0;
  state.lastError = undefined;
  state.circuit = { state: 'closed', cooldownRemainingMs: 0 };
  isIndexingValue = false;
  statsError = undefined;
  statsCalls = 0;
  circuitSnapshot = { state: 'closed', cooldownRemainingMs: 0 };
  statsValue.totalSymbols = 5;
  statsValue.totalFiles = 2;
  statsValue.lastIndexed = 1;
});
afterEach(() => vi.restoreAllMocks());

describe('codebase-index tool gates', () => {
  it('reports when an index is already in progress', async () => {
    isIndexingValue = true;
    const out = await codebaseIndexTool.execute({}, ctx(), opts());
    expect(out.note).toMatch(/already in progress/);
  });

  it('reports when the circuit breaker is open', async () => {
    circuitSnapshot = { state: 'open', cooldownRemainingMs: 5000, lastFailure: 'boom' };
    const out = await codebaseIndexTool.execute({}, ctx(), opts());
    expect(out.note).toMatch(/paused after repeated failures/);
  });

  it('reports open circuit without a specific last failure', async () => {
    circuitSnapshot = { state: 'open', cooldownRemainingMs: 5000 };
    const out = await codebaseIndexTool.execute({}, ctx(), opts());
    expect(out.note).toContain('last: unknown');
  });

  it('runs the indexer when not gated', async () => {
    const out = await codebaseIndexTool.execute({}, ctx(), opts());
    expect(out.filesIndexed).toBe(1);
  });
});

describe('codebase-stats tool gates', () => {
  it('keeps the outer tool timeout above the index host read watchdog', () => {
    expect(codebaseStatsTool.timeoutMs).toBeGreaterThan(30_000);
  });

  it('reports "not yet built" when the persisted index has no data', async () => {
    state.ready = false;
    statsValue.totalSymbols = 0;
    statsValue.totalFiles = 0;
    statsValue.lastIndexed = null;
    const out = await codebaseStatsTool.execute({}, ctx(), opts());
    expect(out.indexStatus).toMatch(/No persisted index data.*codebase-index/);
    expect(out.totalSymbols).toBe(0);
  });

  it('reports indexing-in-progress when persisting data is in flight', async () => {
    state.ready = false;
    state.indexing = true;
    state.currentFile = 3;
    state.totalFiles = 10;
    const out = await codebaseStatsTool.execute({}, ctx(), opts());
    expect(out.indexStatus).toMatch(/Startup indexing in progress/);
    expect(out.statsAvailable).toBe(false);
    expect(out.indexing).toEqual({ currentFile: 3, totalFiles: 10 });
    expect(statsCalls).toBe(0);
  });

  it('reports refresh-in-progress when ready and indexing', async () => {
    state.indexing = true;
    const out = await codebaseStatsTool.execute({}, ctx(), opts());
    expect(out.indexStatus).toMatch(/refresh in progress/);
    expect(out.statsAvailable).toBe(false);
    expect(statsCalls).toBe(0);
  });

  it('returns structured guidance instead of throwing when the stats host times out', async () => {
    const err = new Error('index stats timed out');
    err.name = 'IndexTimeoutError';
    statsError = err;
    const out = await codebaseStatsTool.execute({}, ctx(), opts());
    expect(out.indexStatus).toMatch(/statistics timed out.*codebase-search/s);
    expect(out.statsAvailable).toBe(false);
  });

  it('appends a paused note when the circuit is open', async () => {
    state.circuit = { state: 'open', cooldownRemainingMs: 3000, lastFailure: 'x' };
    const out = await codebaseStatsTool.execute({}, ctx(), opts());
    expect(out.indexStatus).toMatch(/paused after repeated failures/);
    expect(out.totalSymbols).toBe(statsValue.totalSymbols);
  });

  it('handles open circuit without a lastFailure value', async () => {
    state.circuit = { state: 'open', cooldownRemainingMs: 3000 };
    const out = await codebaseStatsTool.execute({}, ctx(), opts());
    expect(out.indexStatus).toContain('unknown');
    expect(out.totalSymbols).toBe(statsValue.totalSymbols);
  });

  it('returns plain stats when ready and healthy', async () => {
    const out = await codebaseStatsTool.execute({}, ctx(), opts());
    expect(out.totalSymbols).toBe(statsValue.totalSymbols);
    expect(out.indexStatus).toBeUndefined();
  });
});

describe('codebase-search tool gates', () => {
  it('keeps the outer tool timeout above the index host read watchdog', () => {
    expect(codebaseSearchTool.timeoutMs).toBeGreaterThan(30_000);
  });

  it('reports no persisted data when not ready and DB is empty', async () => {
    state.ready = false;
    statsValue.totalSymbols = 0;
    statsValue.totalFiles = 0;
    statsValue.lastIndexed = null;
    const out = await codebaseSearchTool.execute({ query: 'q' }, ctx(), opts());
    expect(out.indexStatus).toMatch(/No persisted index data/);
  });

  it('does not mistake a zero-hit persisted snapshot for a missing index', async () => {
    state.ready = false;
    const out = await codebaseSearchTool.execute({ query: 'q' }, ctx(), opts());
    expect(out.indexStatus).toBeUndefined();
  });

  it('reports indexing-in-progress when not ready but indexing', async () => {
    state.ready = false;
    state.indexing = true;
    state.currentFile = 0;
    state.totalFiles = 0;
    const out = await codebaseSearchTool.execute({ query: 'q' }, ctx(), opts());
    // The first build still surfaces a clear "not ready" status so callers
    // know to retry rather than read a misleading zero-result snapshot.
    expect(out.indexStatus).toMatch(/Indexing in progress/);
  });

  it('proceeds against the persisted snapshot while refreshing', async () => {
    state.ready = true;
    state.indexing = true;
    const out = await codebaseSearchTool.execute({ query: 'q' }, ctx(), opts());
    // Refresh no longer blocks — WAL readers see the prior snapshot.
    expect(out.indexStatus).toBeUndefined();
  });

  it('reports a build failure with a circuit-open retry hint', async () => {
    state.lastError = 'disk full';
    state.circuit = { state: 'open', cooldownRemainingMs: 2000 };
    const out = await codebaseSearchTool.execute({ query: 'q' }, ctx(), opts());
    expect(out.indexStatus).toMatch(/Index build failed.*circuit open/s);
  });

  it('reports a build failure with a plain retry hint when the circuit is closed', async () => {
    state.lastError = 'parse error';
    const out = await codebaseSearchTool.execute({ query: 'q' }, ctx(), opts());
    expect(out.indexStatus).toMatch(/Try \/codebase-reindex/);
  });
});
