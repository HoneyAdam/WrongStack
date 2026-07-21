import { describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import {
  type ChronicleRouteContext,
  type ChronicleRouteEngine,
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
  const context = {
    getProjectRoot: () => '/proj',
    send: (_ws, message) => sent.push(message),
    getEngine: async () => engine,
  } satisfies ChronicleRouteContext;
  return { context, engine, sent };
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
