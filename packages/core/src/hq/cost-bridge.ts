/**
 * CostTelemetryBridge — forwards local token/cost accounting events to the HQ
 * publisher as `session.usage` envelopes, giving the command center the
 * granular per-call cost signal it needs to render live cost trends and
 * roll-ups across every connected machine.
 *
 * Source: the `token.accounted` EventBus event, emitted by the TokenCounter
 * (`infrastructure/token-counter.ts`) after every provider call. The payload
 * is plain serializable data (usage counts + a cost breakdown) — no closures.
 *
 * This is the high-frequency cost feed; HQ's persistence layer (Phase 2)
 * time-buckets these into trend series.
 *
 * @module hq/cost-bridge
 */
import type { EventBus } from '../kernel/events.js';
import type { Usage } from '../types/provider.js';
import type { HqEventEnvelope, HqUsagePayload } from './protocol.js';
import type { HqPublisher } from './publisher.js';

export interface CostTelemetryBridgeOptions {
  /** Local EventBus emitting `token.accounted`. */
  events: EventBus;
  /** HQ publisher to forward envelopes to. */
  publisher: HqPublisher;
  /** Optional sessionId to tag envelopes with (overrides the event's, when set). */
  sessionId?: string;
  /** Override `now()` for deterministic tests. */
  now?: () => string;
}

interface TokenAccountedEvent {
  sessionId?: string | undefined;
  usage: Usage;
  cost: { input: number; output: number; total: number };
}

/**
 * Start forwarding token/cost events to HQ. Returns a disposer that
 * unsubscribes the listener — call on shutdown.
 */
export function startCostTelemetryBridge(opts: CostTelemetryBridgeOptions): () => void {
  const { events, publisher } = opts;
  const now = opts.now ?? (() => new Date().toISOString());

  const off = events.on('token.accounted', (p: TokenAccountedEvent) => {
    try {
      const payload: HqUsagePayload = {
        inputTokens: p.usage.input,
        outputTokens: p.usage.output,
        totalTokens: p.usage.input + p.usage.output,
        costUsd: p.cost.total,
      };
      const sessionId = opts.sessionId ?? p.sessionId;
      publisher.publishEvent({
        type: 'session.usage',
        payload,
        ...(sessionId !== undefined ? { sessionId } : {}),
        timestamp: now(),
      });
    } catch {
      /* best-effort */
    }
  });

  return () => {
    off();
  };
}

/** Re-export for type-only consumers. */
export type { HqEventEnvelope };
