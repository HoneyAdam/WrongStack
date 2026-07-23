import {
  defineMemoryCapability,
  type MemoryCapability,
  type MemoryHealth,
  type MemoryPort,
  type MemoryStore,
} from '@wrongstack/core/types';
import type { SageRetrieverLike } from './middleware/tool-call-memory.js';
import type { SageServiceLike, SageSurface } from './service-contract.js';
import { isSageService } from './service-guard.js';
import { SqliteSageStore } from './sqlite-store.js';
import type { SageStoreOptions } from './types.js';

export const SAGE_SERVICE_CAPABILITY = defineMemoryCapability<SageServiceLike>(
  'wrongstack.memory.sage-service.v1',
);

export interface SageRetrievalCapability extends SageRetrieverLike {
  flushPendingCounters?(): Promise<void>;
  retrieveForAudience?(
    context: { role?: string; taskType?: string; mode?: string },
    limit?: number,
  ): Promise<import('./types.js').Sage[]>;
}

export const SAGE_RETRIEVAL_CAPABILITY =
  defineMemoryCapability<SageRetrievalCapability>('wrongstack.memory.retrieval.v1');
export const SAGE_SURFACE_CAPABILITY = defineMemoryCapability<SageSurface>(
  'wrongstack.memory.surface.v1',
);

export function getSageService(port: MemoryPort): SageServiceLike | undefined {
  return port.getCapability(SAGE_SERVICE_CAPABILITY);
}

export function getSageRetrieval(
  port: MemoryPort,
): SageRetrievalCapability | undefined {
  return port.getCapability(SAGE_RETRIEVAL_CAPABILITY);
}

export function getSageSurface(port: MemoryPort): SageSurface | undefined {
  return port.getCapability(SAGE_SURFACE_CAPABILITY);
}

/** Production SQLite backend exposed through the host-facing MemoryPort. */
export class SqliteMemoryPort extends SqliteSageStore implements MemoryPort {
  private readonly retrievalCapability: SageRetrievalCapability = {
    retrieveForPath: (options) =>
      super.retrieveForPath([options.path], {
        path: options.path,
        limit: options.limit,
        includeAncestors: options.includeAncestors,
        includeStatuses: options.includeStatuses,
        includeAudienceScoped: options.includeAudienceScoped,
      }),
    searchSage: (query, options) => super.searchSage(query, options),
    findRelatedSage: (memoryIds, options) => super.findRelatedSage(memoryIds, options),
    recordInjection: (memoryIds, trigger, sessionId) =>
      super.recordInjection(memoryIds, trigger, sessionId),
    recordUse: (memoryIds, source, sessionId) => super.recordUse(memoryIds, source, sessionId),
    retrieveForAudience: (context, limit) =>
      super.retrieveForAudience(context, limit === undefined ? undefined : { limit }),
  };
  private readonly surfaceCapability: SageSurface = {
    stats: () => super.stats(),
    listSage: (statuses) => super.listSage(statuses),
    listSagePage: (options) => super.listSagePage(options),
    getSage: (id) => super.getSage(id),
    rememberSage: (input) => super.rememberSage(input),
    updateSage: (id, patch) => super.updateSage(id, patch),
    deleteSage: (id, reason, options) => super.deleteSage(id, reason, options),
    retrieveForPath: (options) =>
      super.retrieveForPath([options.path], { ...options, path: options.path }),
    searchSage: (query, options) => super.searchSage(query, options),
    acceptCandidate: (candidateId) => super.acceptCandidate(candidateId),
    rejectCandidate: (candidateId, reason) => super.rejectCandidate(candidateId, reason),
    retrieveForAudience: (context, limit) =>
      super.retrieveForAudience(context, limit === undefined ? undefined : { limit }),
    hygiene: (options) => super.hygiene(options),
    listCandidates: (includeResolved) => super.listCandidates(includeResolved),
    graphFor: (query, maxDepth, limit) => super.graphFor(query, maxDepth, limit),
    verify: (memoryId, signal) => super.verify(memoryId, signal),
  };

  override withTraceId(traceId: string): this {
    super.withTraceId(traceId);
    return this;
  }

  getCapability<T>(capability: MemoryCapability<T>): T | undefined {
    if (capability.id === SAGE_RETRIEVAL_CAPABILITY.id) {
      return this.retrievalCapability as unknown as T;
    }
    if (capability.id === SAGE_SURFACE_CAPABILITY.id) {
      return this.surfaceCapability as unknown as T;
    }
    if (capability.id === SAGE_SERVICE_CAPABILITY.id && isSageService(this)) {
      return this as unknown as T;
    }
    return undefined;
  }

  async health(): Promise<MemoryHealth> {
    try {
      await this.initialize();
      return { status: 'ready', backend: 'sqlite' };
    } catch (error) {
      return {
        status: 'unavailable',
        backend: 'sqlite',
        details: { error: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  async dispose(): Promise<void> {
    this.close();
  }
}


/**
 * Compatibility wrapper for third-party implementations of the legacy Core
 * MemoryStore. It deliberately exposes no optional SAGE capability.
 */
export class LegacyMemoryPortAdapter implements MemoryPort {
  constructor(
    private readonly store: MemoryStore,
    private readonly backend = 'legacy',
  ) {}

  async initialize(): Promise<void> {}

  readAll(): Promise<string> {
    return this.store.readAll();
  }

  read(...args: Parameters<MemoryStore['read']>): ReturnType<MemoryStore['read']> {
    return this.store.read(...args);
  }

  remember(...args: Parameters<MemoryStore['remember']>): ReturnType<MemoryStore['remember']> {
    return this.store.remember(...args);
  }

  forget(...args: Parameters<MemoryStore['forget']>): ReturnType<MemoryStore['forget']> {
    return this.store.forget(...args);
  }

  consolidate(
    ...args: Parameters<MemoryStore['consolidate']>
  ): ReturnType<MemoryStore['consolidate']> {
    return this.store.consolidate(...args);
  }

  clear(...args: Parameters<MemoryStore['clear']>): ReturnType<MemoryStore['clear']> {
    return this.store.clear(...args);
  }

  list(...args: Parameters<MemoryStore['list']>): ReturnType<MemoryStore['list']> {
    return this.store.list(...args);
  }

  search(...args: Parameters<MemoryStore['search']>): ReturnType<MemoryStore['search']> {
    return this.store.search(...args);
  }

  getBackend(): unknown {
    return this.store.getBackend?.();
  }

  findRelated(...args: Parameters<NonNullable<MemoryStore['findRelated']>>) {
    return this.store.findRelated?.(...args) ?? Promise.resolve([]);
  }

  scoreRelevant(...args: Parameters<NonNullable<MemoryStore['scoreRelevant']>>) {
    return this.store.scoreRelevant?.(...args) ?? Promise.resolve([]);
  }

  hygiene(...args: Parameters<NonNullable<MemoryStore['hygiene']>>) {
    return this.store.hygiene?.(...args) ?? Promise.resolve(undefined);
  }

  withTraceId(traceId: string): this {
    this.store.withTraceId(traceId);
    return this;
  }

  getCapability<T>(_capability: MemoryCapability<T>): T | undefined {
    return undefined;
  }

  async health(): Promise<MemoryHealth> {
    return { status: 'ready', backend: this.backend };
  }

  async dispose(): Promise<void> {}
}
export function createSqliteMemoryPort(options: SageStoreOptions): MemoryPort {
  return new SqliteMemoryPort(options);
}

