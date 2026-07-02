/**
 * ToolTelemetryBridge — forwards local tool execution events to the HQ
 * publisher as `tool.started` and `tool.completed` envelopes, so the command
 * center can surface live tool activity (what's running, durations, success
 * rates) across every connected machine.
 *
 * Sources:
 *  - `tool.started` (EventBus) → `tool.started` envelope. Raw tool input is
 *    summarized via {@link summarizeHqToolArgs} so no secrets or oversized
 *    payloads leak to the HQ browser.
 *  - `tool.executed` (EventBus) → `tool.completed` envelope (carries the
 *    richer post-execution signal: duration, ok/error, output bytes).
 *
 * All payload fields are plain serializable data — no closures. The
 * `tool.started.input` raw args are the only sensitive surface and are
 * reduced to a summary before publishing.
 *
 * @module hq/tool-bridge
 */
import type { EventBus } from '../kernel/events.js';
import { summarizeHqToolArgs } from './redaction.js';
import type { HqEventEnvelope, HqToolCompletedPayload, HqToolStartedPayload } from './protocol.js';
import type { HqPublisher } from './publisher.js';

export interface ToolTelemetryBridgeOptions {
  /** Local EventBus emitting `tool.started` and `tool.executed` events. */
  events: EventBus;
  /** HQ publisher to forward envelopes to. */
  publisher: HqPublisher;
  /** Project root for path redaction in tool input summaries. */
  projectRoot?: string;
  /** Optional sessionId to tag envelopes with. */
  sessionId?: string;
  /** Override `now()` for deterministic tests. */
  now?: () => string;
}

interface ToolStartedEvent {
  sessionId?: string | undefined;
  name: string;
  id: string;
  input?: unknown | undefined;
}

interface ToolExecutedEvent {
  sessionId?: string | undefined;
  id?: string | undefined;
  name: string;
  durationMs: number;
  ok: boolean;
  input?: unknown | undefined;
  output?: string | undefined;
  outputBytes?: number | undefined;
}

/** Track in-flight tool calls so we can attach start info to completion. */
interface InFlightTool {
  name: string;
  startedAt: number;
}

/**
 * Start forwarding tool execution events to HQ. Returns a disposer that
 * unsubscribes all listeners — call on shutdown.
 */
export function startToolTelemetryBridge(opts: ToolTelemetryBridgeOptions): () => void {
  const { events, publisher } = opts;
  const now = opts.now ?? (() => new Date().toISOString());
  const inFlight = new Map<string, InFlightTool>();

  function sessionIdTag(sessionId?: string): { sessionId?: string } {
    const tag = sessionId ?? opts.sessionId;
    return tag !== undefined ? { sessionId: tag } : {};
  }

  const offStarted = events.on('tool.started', (p: ToolStartedEvent) => {
    inFlight.set(p.id, { name: p.name, startedAt: Date.now() });
    try {
      const payload: HqToolStartedPayload = {
        toolName: p.name,
        ...(p.input !== undefined
          ? {
              inputSummary: summarizeHqToolArgs(p.input, {
                ...(opts.projectRoot !== undefined ? { projectRoot: opts.projectRoot } : {}),
              }),
            }
          : {}),
      };
      publisher.publishEvent({
        type: 'tool.started',
        payload,
        ...sessionIdTag(p.sessionId),
        timestamp: now(),
      });
    } catch {
      /* best-effort */
    }
  });

  const offExecuted = events.on('tool.executed', (p: ToolExecutedEvent) => {
    const id = p.id;
    if (id !== undefined) inFlight.delete(id);
    try {
      const payload: HqToolCompletedPayload = {
        toolName: p.name,
        status: p.ok ? 'success' : 'error',
        durationMs: p.durationMs,
        ...(p.output !== undefined && p.output.length > 0
          ? { outputSummary: truncateForSummary(p.output) }
          : {}),
      };
      publisher.publishEvent({
        type: 'tool.completed',
        payload,
        ...sessionIdTag(p.sessionId),
        timestamp: now(),
      });
    } catch {
      /* best-effort */
    }
  });

  return () => {
    offStarted();
    offExecuted();
    inFlight.clear();
  };
}

function truncateForSummary(output: string, max = 280): unknown {
  if (output.length <= max) return output;
  return `${output.slice(0, max)}…[truncated:${output.length - max}]`;
}

/** Re-export for type-only consumers. */
export type { HqEventEnvelope };
