import * as os from 'node:os';
import * as path from 'node:path';
import {
  CHRONICLE_FACET_FIELDS,
  type ChronicleFacet,
  ChronicleMetricsStore,
  type ChronicleQuery,
  ChronicleQueryEngine,
} from '@wrongstack/core/chronicle';
import { resolveWstackPaths } from '@wrongstack/core/utils';
import type { WebSocket } from 'ws';
import type { WSClientMessage, WSServerMessage } from './types.js';

export type ChronicleRouteEngine = Pick<
  ChronicleQueryEngine,
  'query' | 'facet' | 'facets' | 'graph' | 'diagnostics'
>;

export type ChronicleRouteMetrics = Pick<
  ChronicleMetricsStore,
  'refresh' | 'summary' | 'providerDaily' | 'taskOutcomes' | 'fileLineage'
>;

export interface ChronicleRouteContext {
  getProjectRoot: () => string;
  send: (ws: WebSocket, message: WSServerMessage) => void;
  getEngine?: (() => Promise<ChronicleRouteEngine>) | undefined;
  getMetrics?: (() => Promise<ChronicleRouteMetrics>) | undefined;
}

const engineCache = new Map<string, { loadedAt: number; engine: Promise<ChronicleQueryEngine> }>();
const ENGINE_CACHE_MAX_PROJECTS = 8;

function defaultEngine(projectRoot: string): Promise<ChronicleQueryEngine> {
  const now = Date.now();
  const cached = engineCache.get(projectRoot);
  if (cached && now - cached.loadedAt < 60_000) {
    engineCache.delete(projectRoot);
    engineCache.set(projectRoot, cached);
    return cached.engine;
  }
  const paths = resolveWstackPaths({ projectRoot, userHome: os.homedir() });
  const engine = ChronicleQueryEngine.fromDirectory(path.join(paths.projectDir, 'chronicle'));
  engineCache.delete(projectRoot);
  while (engineCache.size >= ENGINE_CACHE_MAX_PROJECTS) {
    const oldest = engineCache.keys().next().value;
    if (oldest === undefined) break;
    engineCache.delete(oldest);
  }
  engineCache.set(projectRoot, { loadedAt: now, engine });
  return engine;
}

interface MetricsCacheEntry {
  store: ChronicleMetricsStore;
  lastRefreshAt: number;
  refreshing: Promise<void> | null;
}
const metricsCache = new Map<string, MetricsCacheEntry>();
const METRICS_CACHE_MAX_PROJECTS = 8;
/** metrics.db ingest is incremental (per-partition byte offsets); this only
 *  bounds how often a burst of dashboard messages re-stats the partitions. */
const METRICS_REFRESH_INTERVAL_MS = 10_000;

function defaultMetrics(projectRoot: string): ChronicleRouteMetrics {
  let entry = metricsCache.get(projectRoot);
  if (!entry) {
    const paths = resolveWstackPaths({ projectRoot, userHome: os.homedir() });
    const store = ChronicleMetricsStore.open(path.join(paths.projectDir, 'chronicle'));
    entry = { store, lastRefreshAt: 0, refreshing: null };
    while (metricsCache.size >= METRICS_CACHE_MAX_PROJECTS) {
      const oldestKey = metricsCache.keys().next().value;
      if (oldestKey === undefined) break;
      metricsCache.get(oldestKey)?.store.close();
      metricsCache.delete(oldestKey);
    }
    metricsCache.set(projectRoot, entry);
  }
  const cached = entry;
  return {
    async refresh() {
      const now = Date.now();
      if (cached.refreshing) {
        await cached.refreshing;
        return { ingestedEvents: 0, ingestedBytes: 0, sourceFiles: 0, invalidLines: 0 };
      }
      if (now - cached.lastRefreshAt < METRICS_REFRESH_INTERVAL_MS) {
        return { ingestedEvents: 0, ingestedBytes: 0, sourceFiles: 0, invalidLines: 0 };
      }
      const run = cached.store.refresh();
      cached.refreshing = run.then(
        () => undefined,
        () => undefined,
      );
      try {
        return await run;
      } finally {
        cached.lastRefreshAt = Date.now();
        cached.refreshing = null;
      }
    },
    summary: () => cached.store.summary(),
    providerDaily: (options) => cached.store.providerDaily(options),
    taskOutcomes: (options) => cached.store.taskOutcomes(options),
    fileLineage: (options) => cached.store.fileLineage(options),
  };
}

/** Canonical Chronicle query/facet/graph handler shared by every WebUI host. */
export async function handleChronicleRoute(
  ctx: ChronicleRouteContext,
  ws: WebSocket,
  message: WSClientMessage,
): Promise<boolean> {
  if (!message.type.startsWith('chronicle.')) return false;
  if (message.type === 'chronicle.metrics') {
    const payload = (message.payload ?? {}) as {
      view?: 'summary' | 'providers' | 'tasks' | 'files';
      from?: string; to?: string; path?: string; taskId?: string;
      boardId?: string; sessionId?: string; status?: string; limit?: number;
    };
    const view = payload.view ?? 'summary';
    try {
      const metrics = await (ctx.getMetrics?.() ?? defaultMetrics(ctx.getProjectRoot()));
      const refreshed = await metrics.refresh();
      const data =
        view === 'providers'
          ? metrics.providerDaily({
              ...(payload.from ? { from: payload.from } : {}),
              ...(payload.to ? { to: payload.to } : {}),
            })
          : view === 'tasks'
            ? metrics.taskOutcomes({
                ...(payload.boardId ? { boardId: payload.boardId } : {}),
                ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
                ...(payload.status ? { status: payload.status } : {}),
                ...(payload.limit !== undefined ? { limit: payload.limit } : {}),
              })
            : view === 'files'
              ? metrics.fileLineage({
                  ...(payload.path ? { path: payload.path } : {}),
                  ...(payload.taskId ? { taskId: payload.taskId } : {}),
                  ...(payload.boardId ? { boardId: payload.boardId } : {}),
                  ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
                  ...(payload.limit !== undefined ? { limit: payload.limit } : {}),
                })
              : metrics.summary();
      ctx.send(ws, { type: 'chronicle.metrics_result', payload: { view, refreshed, data } });
    } catch (error) {
      // node:sqlite unavailable or a corrupt metrics.db — surface, don't crash.
      ctx.send(ws, {
        type: 'chronicle.error',
        payload: { message: error instanceof Error ? error.message : String(error) },
      });
    }
    return true;
  }
  const engine = await (ctx.getEngine?.() ?? defaultEngine(ctx.getProjectRoot()));
  switch (message.type) {
    case 'chronicle.query': {
      const payload = (message.payload ?? {}) as { query?: ChronicleQuery };
      ctx.send(ws, {
        type: 'chronicle.query_result',
        payload: await engine.query(payload.query ?? {}),
      });
      return true;
    }
    case 'chronicle.facet': {
      const payload = (message.payload ?? {}) as {
        field?: ChronicleFacet;
        query?: ChronicleQuery;
        limit?: number;
      };
      if (!payload.field || !CHRONICLE_FACET_FIELDS.has(payload.field)) {
        ctx.send(ws, {
          type: 'chronicle.error',
          payload: { message: 'Invalid Chronicle facet field.' },
        });
        return true;
      }
      ctx.send(ws, {
        type: 'chronicle.facet_result',
        payload: {
          field: payload.field,
          values: await engine.facet(payload.field, payload.query ?? {}, payload.limit),
          diagnostics: engine.diagnostics,
        },
      });
      return true;
    }
    case 'chronicle.facets': {
      const payload = (message.payload ?? {}) as {
        fields?: ChronicleFacet[];
        query?: ChronicleQuery;
        limit?: number;
      };
      if (
        !Array.isArray(payload.fields) ||
        payload.fields.length === 0 ||
        payload.fields.some((field) => !CHRONICLE_FACET_FIELDS.has(field))
      ) {
        ctx.send(ws, {
          type: 'chronicle.error',
          payload: { message: 'Invalid Chronicle facet fields.' },
        });
        return true;
      }
      ctx.send(ws, {
        type: 'chronicle.facets_result',
        payload: {
          values: await engine.facets(payload.fields, payload.query ?? {}, payload.limit),
          diagnostics: engine.diagnostics,
        },
      });
      return true;
    }
    case 'chronicle.graph': {
      const payload = (message.payload ?? {}) as {
        seed?: ChronicleQuery;
        hops?: number;
        maxNodes?: number;
      };
      ctx.send(ws, {
        type: 'chronicle.graph_result',
        payload: await engine.graph(payload.seed ?? {}, payload.hops, payload.maxNodes),
      });
      return true;
    }
    default:
      return false;
  }
}
