import type { AgentPipelines } from '@wrongstack/core/agent';
import type { Config, Logger, MemoryPort } from '@wrongstack/core/types';
import type { EventBus } from '@wrongstack/core/kernel';
import {
  createSuperMemoryContextMonitorMiddleware,
  createSuperMemoryToolCallMiddleware,
  createSuperMemoryTurnMiddleware,
  getSuperMemoryRetrieval,
  InjectionTracker,
} from '@wrongstack/super-memory';

export interface SuperMemoryWiringDeps {
  config: Config;
  pipelines: AgentPipelines;
  memoryStore: MemoryPort | undefined;
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

/**
 * Test-only: reset the auto-hygiene throttle so the next teardown always
 * runs hygiene. Used by the regression test to verify the throttle skips
 * on the second call within the interval.
 */
export function _resetAutoHygieneThrottleForTesting(): void {
  lastAutoHygieneAt = 0;
}

export function setupSuperMemory(deps: SuperMemoryWiringDeps): () => Promise<void> {
  const cfg = deps.config.superMemory;
  const noop = async () => {};
  if (deps.config.features.memory === false) return noop;
  if (cfg?.enabled === false) return noop;
  if (!deps.memoryStore) return noop;
  const memoryStore = deps.memoryStore;
  const retrieval = getSuperMemoryRetrieval(memoryStore);
  if (!retrieval) {
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
        memory: retrieval,
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
        memory: retrieval,
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
    await retrieval.flushPendingCounters?.();
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
    await memoryStore.hygiene?.({
      retentionDays: cfg?.hygiene?.retentionDays,
      archiveLowConfidenceAfterDays: cfg?.hygiene?.archiveLowConfidenceAfterDays,
      archiveUnusedAfterDays: cfg?.hygiene?.archiveUnusedAfterDays,
      unusedMinInjections: cfg?.hygiene?.unusedMinInjections,
    });
    lastAutoHygieneAt = now;
  };
}
