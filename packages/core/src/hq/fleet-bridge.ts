/**
 * FleetTelemetryBridge — forwards local multi-agent coordinator stats to the
 * HQ publisher as `fleet.snapshot` envelopes, so the command center can render
 * a global fleet roll-up (queued/completed/failed tasks, per-subagent status,
 * fleet cost) across every connected machine.
 *
 * Source: the `coordinator.stats` EventBus event (originating on the FleetBus
 * and re-emitted onto the host EventBus by `fleet/host.ts`). All payload
 * fields are plain serializable data — no closures, no decoupled relay needed.
 *
 * The snapshot is republished on every `coordinator.stats` change (hash-dedup,
 * mirroring {@link startSessionTelemetryBridge}) so the HQ browser sees live
 * fleet counters without polling.
 *
 * @module hq/fleet-bridge
 */
import type { EventBus } from '../kernel/events.js';
import type { HqEventEnvelope, HqFleetSnapshotPayload, HqSubagentSummary } from './protocol.js';
import { createBridgeContext, type BridgeContextOptions } from './bridge-context.js';

export interface FleetTelemetryBridgeOptions extends BridgeContextOptions {
  /** Local EventBus emitting `coordinator.stats` (host EventBus after the FleetBus hop). */
  events: EventBus;
  /** Coordinator run id — identifies this fleet instance. Falls back to a stable per-session id. */
  runId: string;
}

/**
 * Start forwarding coordinator stats to HQ. Returns a disposer that
 * unsubscribes the listener — call on shutdown.
 */
export function startFleetTelemetryBridge(opts: FleetTelemetryBridgeOptions): () => void {
  const { events, publisher, runId } = opts;
  const ctx = createBridgeContext(opts);
  let lastHash = '';

  function buildPayload(stats: {
    total: number;
    running: number;
    idle: number;
    stopped: number;
    inFlight: number;
    pending: number;
    completed: number;
    totalCostUsd?: number | undefined;
    subagentStatuses: {
      subagentId: string;
      taskId: string;
      status: string;
      assigned: boolean;
      model?: string | undefined;
      costUsd?: number | undefined;
      runtimeMs?: number | undefined;
      lastActivityAt?: string | undefined;
      iterations?: number | undefined;
      toolCalls?: number | undefined;
    }[];
  }): HqFleetSnapshotPayload {
    const subagents: HqSubagentSummary[] = stats.subagentStatuses.map((s) => ({
      subagentId: s.subagentId,
      ...(s.taskId ? { task: s.taskId } : {}),
      status: normalizeSubagentStatus(s.status),
      ...(s.model !== undefined ? { model: s.model } : {}),
      ...(s.costUsd !== undefined ? { costUsd: s.costUsd } : {}),
      ...(s.runtimeMs !== undefined ? { runtimeMs: s.runtimeMs } : {}),
      ...(s.lastActivityAt !== undefined ? { lastActivityAt: s.lastActivityAt } : {}),
    }));
    return {
      runId,
      activeSubagents: stats.running + stats.idle,
      queuedTasks: stats.pending,
      completedTasks: stats.completed,
      failedTasks: stats.stopped,
      ...(stats.totalCostUsd !== undefined ? { totalCostUsd: stats.totalCostUsd } : {}),
      subagents,
    };
  }

  const off = events.on('coordinator.stats', (stats) => {
    const payload = buildPayload(stats);
    // Hash-dedup so identical fleet state isn't republished.
    const hash = JSON.stringify(payload);
    if (hash === lastHash) return;
    lastHash = hash;
    try {
      publisher.publishFleetSnapshot(payload, {
        ...ctx.sessionIdTag(),
        timestamp: ctx.now(),
      });
    } catch {
      /* best-effort — HQ telemetry must never break the host */
    }
  });

  ctx.track(off);
  return ctx.dispose;
}

const FLEET_STATUS_MAP: Record<string, HqSubagentSummary['status']> = {
  running: 'running',
  idle: 'idle',
  pending: 'pending',
  completed: 'completed',
  failed: 'failed',
  stopped: 'stopped',
  timeout: 'stopped',
  budget_exhausted: 'stopped',
};

function normalizeSubagentStatus(raw: string): HqSubagentSummary['status'] {
  return FLEET_STATUS_MAP[raw] ?? 'idle';
}

/** Re-export for type-only consumers. */
export type { HqEventEnvelope };
