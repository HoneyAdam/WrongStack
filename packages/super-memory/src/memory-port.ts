import {
  defineMemoryCapability,
  type MemoryCapability,
  type MemoryHealth,
  type MemoryPort,
  type MemoryStore,
} from '@wrongstack/core/types';
import type { SuperMemoryRetrieverLike } from './middleware/tool-call-memory.js';
import type { SuperMemoryServiceLike, SuperMemorySurface } from './service-contract.js';
import { isSuperMemoryService } from './service-guard.js';
import { SqliteSuperMemoryStore } from './sqlite-store.js';
import { SuperMemoryStore } from './store.js';
import type { SuperMemoryStoreOptions } from './types.js';

export const SUPER_MEMORY_SERVICE_CAPABILITY = defineMemoryCapability<SuperMemoryServiceLike>(
  'wrongstack.memory.super-service.v1',
);

export interface SuperMemoryRetrievalCapability extends SuperMemoryRetrieverLike {
  flushPendingCounters?(): Promise<void>;
  retrieveForAudience?(
    context: { role?: string; taskType?: string; mode?: string },
    limit?: number,
  ): Promise<import('./types.js').SuperMemory[]>;
}

export const SUPER_MEMORY_RETRIEVAL_CAPABILITY =
  defineMemoryCapability<SuperMemoryRetrievalCapability>('wrongstack.memory.retrieval.v1');
export const SUPER_MEMORY_SURFACE_CAPABILITY = defineMemoryCapability<SuperMemorySurface>(
  'wrongstack.memory.surface.v1',
);

export function getSuperMemoryService(port: MemoryPort): SuperMemoryServiceLike | undefined {
  return port.getCapability(SUPER_MEMORY_SERVICE_CAPABILITY);
}

export function getSuperMemoryRetrieval(
  port: MemoryPort,
): SuperMemoryRetrievalCapability | undefined {
  return port.getCapability(SUPER_MEMORY_RETRIEVAL_CAPABILITY);
}

export function getSuperMemorySurface(port: MemoryPort): SuperMemorySurface | undefined {
  return port.getCapability(SUPER_MEMORY_SURFACE_CAPABILITY);
}

/** Production SQLite backend exposed through the host-facing MemoryPort. */
export class SqliteMemoryPort extends SqliteSuperMemoryStore implements MemoryPort {
  private readonly retrievalCapability: SuperMemoryRetrievalCapability = {
    retrieveForPath: (options) =>
      super.retrieveForPath([options.path], {
        path: options.path,
        limit: options.limit,
        includeAncestors: options.includeAncestors,
        includeStatuses: options.includeStatuses,
        includeAudienceScoped: options.includeAudienceScoped,
      }),
    searchSuper: (query, options) => super.searchSuper(query, options),
    findRelatedSuper: (memoryIds, options) => super.findRelatedSuper(memoryIds, options),
    recordInjection: (memoryIds, trigger, sessionId) =>
      super.recordInjection(memoryIds, trigger, sessionId),
    recordUse: (memoryIds, source, sessionId) => super.recordUse(memoryIds, source, sessionId),
    retrieveForAudience: (context, limit) =>
      super.retrieveForAudience(context, limit === undefined ? undefined : { limit }),
  };
  private readonly surfaceCapability: SuperMemorySurface = {
    stats: () => super.stats(),
    listSuper: (statuses) => super.listSuper(statuses),
    listSuperPage: (options) => super.listSuperPage(options),
    getSuperMemory: (id) => super.getSuperMemory(id),
    rememberSuper: (input) => super.rememberSuper(input),
    updateSuperMemory: (id, patch) => super.updateSuperMemory(id, patch),
    deleteSuperMemory: (id, reason, options) => super.deleteSuperMemory(id, reason, options),
    retrieveForPath: (options) =>
      super.retrieveForPath([options.path], { ...options, path: options.path }),
    searchSuper: (query, options) => super.searchSuper(query, options),
    acceptCandidate: (candidateId) => super.acceptCandidate(candidateId),
    rejectCandidate: (candidateId, reason) => super.rejectCandidate(candidateId, reason),
    retrieveForAudience: (context, limit) =>
      super.retrieveForAudience(context, limit === undefined ? undefined : { limit }),
    hygiene: (options) => super.hygiene(options),
    listCandidates: (includeResolved) => super.listCandidates(includeResolved),
  };

  override withTraceId(traceId: string): this {
    super.withTraceId(traceId);
    return this;
  }

  getCapability<T>(capability: MemoryCapability<T>): T | undefined {
    if (capability.id === SUPER_MEMORY_RETRIEVAL_CAPABILITY.id) {
      return this.retrievalCapability as unknown as T;
    }
    if (capability.id === SUPER_MEMORY_SURFACE_CAPABILITY.id) {
      return this.surfaceCapability as unknown as T;
    }
    if (capability.id === SUPER_MEMORY_SERVICE_CAPABILITY.id && isSuperMemoryService(this)) {
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

/** JSONL compatibility backend, retained only behind an explicit port. */
export class JsonlMemoryPort extends SuperMemoryStore implements MemoryPort {
  override withTraceId(traceId: string): this {
    super.withTraceId(traceId);
    return this;
  }

  getCapability<T>(capability: MemoryCapability<T>): T | undefined {
    if (capability.id === SUPER_MEMORY_RETRIEVAL_CAPABILITY.id) return this as unknown as T;
    if (capability.id === SUPER_MEMORY_SURFACE_CAPABILITY.id) return this as unknown as T;
    if (capability.id === SUPER_MEMORY_SERVICE_CAPABILITY.id && isSuperMemoryService(this)) {
      return this as unknown as T;
    }
    return undefined;
  }

  async health(): Promise<MemoryHealth> {
    try {
      await this.initialize();
      return { status: 'ready', backend: 'jsonl-compatibility' };
    } catch (error) {
      return {
        status: 'unavailable',
        backend: 'jsonl-compatibility',
        details: { error: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  async dispose(): Promise<void> {
    await this.flushPendingCounters();
  }
}

/**
 * Compatibility wrapper for third-party implementations of the legacy Core
 * MemoryStore. It deliberately exposes no optional Super Memory capability.
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

export function createSqliteMemoryPort(options: SuperMemoryStoreOptions): MemoryPort {
  return new SqliteMemoryPort(options);
}

export function createJsonlCompatibilityMemoryPort(options: SuperMemoryStoreOptions): MemoryPort {
  return new JsonlMemoryPort(options);
}
