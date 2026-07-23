export { verifyMemoryAnchors } from './anchors/verify.js';
export {
  HashingEmbeddingProvider,
  type HashingEmbeddingProviderOptions,
} from './embeddings/hashing.js';
export {
  createSqliteMemoryPort,
  getSuperMemoryRetrieval,
  getSuperMemoryService,
  getSuperMemorySurface,
  LegacyMemoryPortAdapter,
  SqliteMemoryPort,
  SUPER_MEMORY_RETRIEVAL_CAPABILITY,
  SUPER_MEMORY_SERVICE_CAPABILITY,
  SUPER_MEMORY_SURFACE_CAPABILITY,
  type SuperMemoryRetrievalCapability,
} from './memory-port.js';
export {
  createSuperMemoryContextMonitorMiddleware,
  type SuperMemoryContextMonitorOptions,
} from './middleware/context-monitor.js';
export {
  type ContextMemorySnapshot,
  InjectionTracker,
  type InjectionTrackerOptions,
} from './middleware/injection-tracker.js';
export {
  MemoryInjectorAgent,
  type MemoryInjectorMeasurement,
  type MemoryInjectorPlan,
  type MemoryInjectorPlanInput,
} from './middleware/memory-injector-agent.js';
export {
  createSuperMemoryToolCallMiddleware,
  type MemoryToolTrigger,
  type SuperMemoryRetrieverLike,
  type SuperMemoryToolCallMiddlewareOptions,
} from './middleware/tool-call-memory.js';
export {
  createSuperMemoryTurnMiddleware,
  overlapCoefficient,
  type SuperMemoryTurnMiddlewareOptions,
} from './middleware/turn-memory.js';
export {
  ancestorPaths,
  DEFAULT_SUPER_MEMORY_DIR,
  normalizeProjectPath,
  normalizeSlashes,
  resolveSuperMemoryPaths,
} from './paths.js';
export {
  type FormatMemoryHintsOptions,
  type FormattedMemoryHints,
  formatMemoryHints,
  formatMemoryHintsDetailed,
} from './retrieval/format.js';
export {
  type MemoryQueryRelevance,
  memoryQueryRelevance,
  memoryStructuralRelevance,
} from './retrieval/relevance.js';
export type { SuperMemoryServiceLike, SuperMemorySurface } from './service-contract.js';
export { isSuperMemoryService } from './service-guard.js';
export { isSqliteAvailable, SqliteSuperMemoryStore } from './sqlite-store.js';
export { normalizeTextKey, tokenize } from './store-helpers.js';
export { createSuperMemoryTools } from './tools/memory-tools.js';
export type { UpdateSuperMemoryInput } from './types.js';
export * from './types.js';
