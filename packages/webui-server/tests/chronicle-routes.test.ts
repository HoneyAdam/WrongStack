import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import {
  type ChronicleRouteContext,
  type ChronicleRouteEngine,
  type ChronicleRouteMetrics,
  handleChronicleRoute,
} from '../src/server/chronicle-routes.js';
import type { WSServerMessage } from '../src/server/types.js';

function harness() {
  const sent: WSServerMessage[] = [];
  const engine = {
    diagnostics: { partitions: 1 },
    query: vi.fn(async (query) => ({ items: [], query })),
    facet: vi.fn(async () => [{ value: 'tool', count: 2 }]),
    facets: vi.fn(async () => ({ eventType: [{ value: 'tool', count: 2 }] })),
    graph: vi.fn(async () => ({ nodes: [], edges: [] })),
  } as unknown as ChronicleRouteEngine;
  const metrics = {
    refresh: vi.fn(async () => ({ ingestedEvents: 3, ingestedBytes: 42, sourceFiles: 1, invalidLines: 0 })),
    summary: vi.fn(() => ({ providers: { attempts: 2, completed: 2, failed: 0, successRate: 1 }, tasks: {}, files: { mutations: 0, uniquePaths: 0 }, estimatedCostUsd: 0 })),
    providerDaily: vi.fn(() => []),
    taskOutcomes: vi.fn(() => []),
    fileLineage: vi.fn(() => []),
  } as unknown as ChronicleRouteMetrics;
  const context = {
    getProjectRoot: () => '/proj',
    send: (_ws, message) => sent.push(message),
    getEngine: async () => engine,
    getMetrics: async () => metrics,
  } satisfies ChronicleRouteContext;
  return { context, engine, metrics, sent };
}

describe('canonical Chronicle handler family', () => {
  it('routes query, facet, facets, and graph through one injected engine', async () => {
    const { context, engine } = harness();
    const ws = {} as WebSocket;
    expect(await handleChronicleRoute(context, ws, { type: 'chronicle.query' })).toBe(true);
    expect(
      await handleChronicleRoute(context, ws, {
        type: 'chronicle.facet',
        payload: { field: 'eventType' },
      }),
    ).toBe(true);
    expect(
      await handleChronicleRoute(context, ws, {
        type: 'chronicle.facets',
        payload: { fields: ['eventType'] },
      }),
    ).toBe(true);
    expect(await handleChronicleRoute(context, ws, { type: 'chronicle.graph' })).toBe(true);
    expect(engine.query).toHaveBeenCalledOnce();
    expect(engine.facet).toHaveBeenCalledOnce();
    expect(engine.facets).toHaveBeenCalledOnce();
    expect(engine.graph).toHaveBeenCalledOnce();
  });

  it('serves derived metrics views from the injected store after a refresh', async () => {
    const { context, metrics, sent } = harness();
    const ws = {} as WebSocket;
    expect(await handleChronicleRoute(context, ws, { type: 'chronicle.metrics' })).toBe(true);
    expect(metrics.refresh).toHaveBeenCalledOnce();
    expect(metrics.summary).toHaveBeenCalledOnce();
    expect(sent.at(-1)).toMatchObject({
      type: 'chronicle.metrics_result',
      payload: { view: 'summary', refreshed: { ingestedEvents: 3 } },
    });
    await handleChronicleRoute(context, ws, {
      type: 'chronicle.metrics',
      payload: { view: 'files', path: 'src/app.ts', limit: 5 },
    });
    expect(metrics.fileLineage).toHaveBeenCalledWith({ path: 'src/app.ts', limit: 5 });
    expect(sent.at(-1)).toMatchObject({ type: 'chronicle.metrics_result', payload: { view: 'files' } });
    await handleChronicleRoute(context, ws, {
      type: 'chronicle.metrics',
      payload: { view: 'providers', from: '2026-07-01' },
    });
    expect(metrics.providerDaily).toHaveBeenCalledWith({ from: '2026-07-01' });
  });

  it('surfaces metrics store failures as chronicle.error instead of crashing', async () => {
    const { context, sent } = harness();
    (context as { getMetrics: () => Promise<ChronicleRouteMetrics> }).getMetrics = async () => {
      throw new Error('node:sqlite unavailable');
    };
    const ws = {} as WebSocket;
    expect(await handleChronicleRoute(context, ws, { type: 'chronicle.metrics' })).toBe(true);
    expect(sent.at(-1)).toEqual({
      type: 'chronicle.error',
      payload: { message: 'node:sqlite unavailable' },
    });
  });

  it('returns canonical validation errors and declines foreign messages', async () => {
    const { context, engine, sent } = harness();
    const ws = {} as WebSocket;
    expect(
      await handleChronicleRoute(context, ws, {
        type: 'chronicle.facet',
        payload: { field: 'not-a-facet' },
      }),
    ).toBe(true);
    expect(sent.at(-1)).toEqual({
      type: 'chronicle.error',
      payload: { message: 'Invalid Chronicle facet field.' },
    });
    expect(engine.facet).not.toHaveBeenCalled();
    expect(await handleChronicleRoute(context, ws, { type: 'test.foreign' })).toBe(false);
  });
});
