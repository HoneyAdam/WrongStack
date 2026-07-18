import type { EventBus, EventMap } from '../kernel/events.js';
import type { ChronicleContext } from './context.js';
import type { ChronicleJournal } from './journal.js';
import type { ChronicleEventInput } from './types.js';

export interface ChronicleProviderAdapterOptions {
  events: EventBus;
  journal: ChronicleJournal;
  context: ChronicleContext | (() => ChronicleContext);
  onPersistError?: ((error: unknown, event: ChronicleEventInput) => void) | undefined;
}

/** Persist provider attempt facts without coupling the provider runner to storage. */
export function wireProviderAttemptsToChronicle(options: ChronicleProviderAdapterOptions): () => void {
  const unsubs = [
    options.events.on('provider.attempt.started', (event) => persist(options, event, {
      eventType: 'provider.attempt.started',
      outcome: 'started',
      occurredAt: event.startedAt,
    })),
    options.events.on('provider.attempt.completed', (event) => persist(options, event, {
      eventType: 'provider.attempt.completed',
      outcome: 'success',
      occurredAt: event.endedAt,
      durationNs: millisecondsToNanoseconds(event.durationMs),
    })),
    options.events.on('provider.attempt.failed', (event) => persist(options, event, {
      eventType: 'provider.attempt.failed',
      outcome: 'failure',
      occurredAt: event.endedAt,
      durationNs: millisecondsToNanoseconds(event.durationMs),
    })),
  ];
  return () => unsubs.forEach((unsubscribe) => unsubscribe());
}

type ProviderAttemptEvent =
  | EventMap['provider.attempt.started']
  | EventMap['provider.attempt.completed']
  | EventMap['provider.attempt.failed'];

function persist(
  options: ChronicleProviderAdapterOptions,
  event: ProviderAttemptEvent,
  base: Pick<ChronicleEventInput, 'eventType' | 'outcome' | 'occurredAt' | 'durationNs'>,
): void {
  const context = typeof options.context === 'function' ? options.context() : options.context;
  const input: ChronicleEventInput = {
    ...base,
    scope: {
      ...context.scope,
      sessionId: event.sessionId,
      ...(event.agentId ? { agentId: event.agentId } : {}),
    },
    correlation: {
      ...context.correlation,
      ...(event.traceId ? { traceId: event.traceId } : {}),
      logicalRequestId: event.logicalRequestId,
      attemptId: event.attemptId,
    },
    runtime: { providerId: event.providerId, modelId: event.model },
    attributes: providerAttributes(event),
  };
  void options.journal.append(input).catch((error) => options.onPersistError?.(error, input));
}

function providerAttributes(event: ProviderAttemptEvent): Record<string, unknown> {
  const { sessionId: _sessionId, traceId: _traceId, agentId: _agentId, providerId: _providerId,
    model: _model, logicalRequestId: _logicalRequestId, attemptId: _attemptId, ...attributes } = event;
  return attributes;
}

function millisecondsToNanoseconds(durationMs: number): string {
  return Math.round(durationMs * 1_000_000).toString();
}
