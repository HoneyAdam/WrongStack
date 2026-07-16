import type { AgentPipelines, Config, Logger, MemoryStore } from '@wrongstack/core';
import {
  createSuperMemoryToolCallMiddleware,
  createSuperMemoryTurnMiddleware,
  type SuperMemoryRetrieverLike,
} from '@wrongstack/super-memory';

export interface SuperMemoryWiringDeps {
  config: Config;
  pipelines: AgentPipelines;
  memoryStore: MemoryStore | undefined;
  logger: Logger;
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

  if (cfg?.inject?.toolResults !== false) {
    deps.pipelines.toolCall.use(
      createSuperMemoryToolCallMiddleware({
        memory: deps.memoryStore,
        maxHintsPerTool: cfg?.inject?.maxHintsPerTool,
        maxCharsPerTool: cfg?.inject?.maxCharsPerTool,
        minScore: cfg?.inject?.minScore,
        repeatCooldownMs: cfg?.inject?.repeatCooldownMs,
        verifyOnMutation: cfg?.hygiene?.autoOnFileChange,
        triggers: cfg?.inject?.triggers,
      }),
    );
  }
  if (cfg?.inject?.turnContext !== false) {
    deps.pipelines.request.use(
      createSuperMemoryTurnMiddleware({
        memory: deps.memoryStore,
        maxMemories: cfg?.inject?.maxTurnMemories,
        maxChars: cfg?.inject?.maxCharsPerTurn,
        minScore: cfg?.inject?.minScore,
        metadataWeight: cfg?.retrieval?.metadataWeight,
      }),
    );
  }
  return async () => {
    if (cfg?.hygiene?.autoAfterSession === false) return;
    const candidate = deps.memoryStore as unknown as { hygiene?: (opts?: object) => Promise<unknown> };
    await candidate.hygiene?.({
      retentionDays: cfg?.hygiene?.retentionDays,
      archiveLowConfidenceAfterDays: cfg?.hygiene?.archiveLowConfidenceAfterDays,
    });
  };
}

function isSuperMemoryRetriever(value: MemoryStore): value is MemoryStore & SuperMemoryRetrieverLike {
  const candidate = value as unknown as Record<string, unknown>;
  return typeof candidate.retrieveForPath === 'function'
    && typeof candidate.searchSuper === 'function';
}
