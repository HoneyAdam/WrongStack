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

/**
 * Auto-hygiene throttle: skip the post-session hygiene pass if one ran
 * within the last hour. Hygiene is an O(N) full-corpus scan; running it
 * after every short session wastes CPU and IO. The throttle is keyed by
 * process lifetime — a single shared timestamp across all teardown
 * callbacks in the same Node process. Operators can force a run via the
 * /memory hygiene slash command, which bypasses the throttle.
 */
let lastAutoHygieneAt = 0;
const AUTO_HYGIENE_INTERVAL_MS = 60 * 60_000; // 1 hour

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
    const candidate = deps.memoryStore as unknown as {
      hygiene?: (opts?: object) => Promise<unknown>;
      flushPendingCounters?: () => Promise<void>;
    };
    await candidate.flushPendingCounters?.call(candidate);
    if (cfg?.hygiene?.autoAfterSession === false) return;
    // Throttle: skip auto-hygiene if it ran less than AUTO_HYGIENE_INTERVAL_MS ago.
    // Manual /memory hygiene slash command bypasses this — it calls
    // memoryStore.hygiene() directly without going through this teardown.
    const now = Date.now();
    if (now - lastAutoHygieneAt < AUTO_HYGIENE_INTERVAL_MS) {
      deps.logger.debug(
        `super-memory auto-hygiene skipped: last run ${Math.round((now - lastAutoHygieneAt) / 1000)}s ago (throttle: ${AUTO_HYGIENE_INTERVAL_MS / 1000}s)`,
      );
      return;
    }
    await candidate.hygiene?.call(candidate, {
      retentionDays: cfg?.hygiene?.retentionDays,
      archiveLowConfidenceAfterDays: cfg?.hygiene?.archiveLowConfidenceAfterDays,
      archiveUnusedAfterDays: cfg?.hygiene?.archiveUnusedAfterDays,
      unusedMinInjections: cfg?.hygiene?.unusedMinInjections,
    });
    lastAutoHygieneAt = now;
  };
}

function isSuperMemoryRetriever(value: MemoryStore): value is MemoryStore & SuperMemoryRetrieverLike {
  const candidate = value as unknown as Record<string, unknown>;
  return typeof candidate.retrieveForPath === 'function'
    && typeof candidate.searchSuper === 'function';
}
