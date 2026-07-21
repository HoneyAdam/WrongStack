import * as os from 'node:os';
import * as path from 'node:path';
import {
  CHRONICLE_FACET_FIELDS,
  type ChronicleFacet,
  type ChronicleQuery,
  ChronicleQueryEngine,
  resolveWstackPaths,
} from '@wrongstack/core';
import type { WebSocket } from 'ws';
import type { WSClientMessage, WSServerMessage } from './types.js';

export type ChronicleRouteEngine = Pick<
  ChronicleQueryEngine,
  'query' | 'facet' | 'facets' | 'graph' | 'diagnostics'
>;

export interface ChronicleRouteContext {
  getProjectRoot: () => string;
  send: (ws: WebSocket, message: WSServerMessage) => void;
  getEngine?: (() => Promise<ChronicleRouteEngine>) | undefined;
}

const engineCache = new Map<string, { loadedAt: number; engine: Promise<ChronicleQueryEngine> }>();

function defaultEngine(projectRoot: string): Promise<ChronicleQueryEngine> {
  const now = Date.now();
  const cached = engineCache.get(projectRoot);
  if (cached && now - cached.loadedAt < 60_000) return cached.engine;
  const paths = resolveWstackPaths({ projectRoot, userHome: os.homedir() });
  const engine = ChronicleQueryEngine.fromDirectory(path.join(paths.projectDir, 'chronicle'));
  engineCache.set(projectRoot, { loadedAt: now, engine });
  return engine;
}

/** Canonical Chronicle query/facet/graph handler shared by every WebUI host. */
export async function handleChronicleRoute(
  ctx: ChronicleRouteContext,
  ws: WebSocket,
  message: WSClientMessage,
): Promise<boolean> {
  if (!message.type.startsWith('chronicle.')) return false;
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
