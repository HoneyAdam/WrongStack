export { verifyMemoryAnchors } from './anchors/verify.js';
export {
  HashingEmbeddingProvider,
  type HashingEmbeddingProviderOptions,
} from './embeddings/hashing.js';
export {
  createSqliteMemoryPort,
  getSageRetrieval,
  getSageService,
  getSageSurface,
  LegacyMemoryPortAdapter,
  SqliteMemoryPort,
  SAGE_RETRIEVAL_CAPABILITY,
  SAGE_SERVICE_CAPABILITY,
  SAGE_SURFACE_CAPABILITY,
  type SageRetrievalCapability,
} from './memory-port.js';
export {
  createSageContextMonitorMiddleware,
  type SageContextMonitorOptions,
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
  createSageToolCallMiddleware,
  type MemoryToolTrigger,
  type SageRetrieverLike,
  type SageToolCallMiddlewareOptions,
} from './middleware/tool-call-memory.js';
export {
  createSageTurnMiddleware,
  overlapCoefficient,
  type SageTurnMiddlewareOptions,
} from './middleware/turn-memory.js';
export {
  ancestorPaths,
  DEFAULT_SAGE_DIR,
  normalizeProjectPath,
  normalizeSlashes,
  resolveSagePaths,
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
export type { SageServiceLike, SageSurface } from './service-contract.js';
export { isSageService } from './service-guard.js';
export { isSqliteAvailable, SqliteSageStore } from './sqlite-store.js';
export { normalizeTextKey, tokenize } from './store-helpers.js';
export { createSageTools } from './tools/memory-tools.js';
export type { UpdateSageInput } from './types.js';
export * from './types.js';
