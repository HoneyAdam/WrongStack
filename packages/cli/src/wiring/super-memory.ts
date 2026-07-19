import type { AgentPipelines, Config, EventBus, Logger, MemoryStore } from '@wrongstack/core';
import {
  createSuperMemoryToolCallMiddleware,
  createSuperMemoryContextMonitorMiddleware,
  createSuperMemoryTurnMiddleware,
  InjectionTracker,
  type SuperMemoryRetrieverLike,
} from '@wrongstack/super-memory';

export interface SuperMemoryWiringDeps {
  config: Config;
  pipelines: AgentPipelines;
  memoryStore: MemoryStore | undefined;
  logger: Logger;
  events: EventBus;
  getSessionId?: (() => string | undefined) | undefined;
}

export function setupSuperMemory(deps: SuperMemoryWiringDeps): () => Promise<void> {
  const cfg = deps.config.superMemory;
  const noop = async () => {};
  if (deps.config.features.memory === false) return noop;
  if (cfg?.enabled === false) return noop;
  if (!deps.memoryStore) return noop;
  if (!isSuperMemoryRetriever(deps.memoryStore)) {
    deps.logger.debug('super-memory middleware skipped: memory store does not support retrieval');
    return noop;
  }

  // One tracker shared by both middlewares: tool-result injections must be
  // matchable when the turn middleware scans assistant messages for references
  // (the usefulness signal behind recordUse). A tracker per middleware would
  // silently drop every cross-path use.
  const injectionTracker = new InjectionTracker();

  if (cfg?.inject?.toolResults !== false) {
    deps.pipelines.toolCall.use(
      createSuperMemoryToolCallMiddleware({
        memory: deps.memoryStore,
        maxHintsPerTool: cfg?.inject?.maxHintsPerTool,
        maxCharsPerTool: cfg?.inject?.maxCharsPerTool,
        taskAware: cfg?.inject?.taskAware,
        minScore: cfg?.inject?.minScore,
        repeatCooldownMs: cfg?.inject?.repeatCooldownMs,
        verifyOnMutation: cfg?.hygiene?.autoOnFileChange,
        triggers: cfg?.inject?.triggers,
        tracker: injectionTracker,
        events: deps.events,
      }),
    );
  }
  // Turn-level injection is deliberately opt-in. The default retrieval path
  // is tool-result injection, after a concrete path/query supplies context.
  if (cfg?.inject?.turnContext === true) {
    deps.pipelines.request.use(
      createSuperMemoryTurnMiddleware({
        memory: deps.memoryStore,
        maxMemories: cfg?.inject?.maxTurnMemories,
        maxChars: cfg?.inject?.maxCharsPerTurn,
        minScore: cfg?.inject?.minScore,
        metadataWeight: cfg?.retrieval?.metadataWeight,
        tracker: injectionTracker,
        getSessionId: deps.getSessionId,
      }),
    );
  }
  deps.pipelines.request.use(
    createSuperMemoryContextMonitorMiddleware({
      tracker: injectionTracker,
      events: deps.events,
      getSessionId: deps.getSessionId,
    }),
  );
  return async () => {
    if (cfg?.hygiene?.autoAfterSession === false) return;
    const candidate = deps.memoryStore as unknown as {
      hygiene?: (opts?: object) => Promise<unknown>;
    };
    await candidate.hygiene?.call(candidate, {
      retentionDays: cfg?.hygiene?.retentionDays,
      archiveLowConfidenceAfterDays: cfg?.hygiene?.archiveLowConfidenceAfterDays,
      archiveUnusedAfterDays: cfg?.hygiene?.archiveUnusedAfterDays,
      unusedMinInjections: cfg?.hygiene?.unusedMinInjections,
    });
  };
}

function isSuperMemoryRetriever(value: MemoryStore): value is MemoryStore & SuperMemoryRetrieverLike {
  const candidate = value as unknown as Record<string, unknown>;
  return typeof candidate.retrieveForPath === 'function'
    && typeof candidate.searchSuper === 'function';
}
