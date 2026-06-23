/**
 * Shadow Agent FleetBus Events
 *
 * Event types emitted and consumed by the Shadow Agent's FleetBus subscription.
 * These events flow through the fleet-wide event bus and are tagged with
 * subagent attribution.
 */

// ── Shadow Agent Lifecycle Events ────────────────────────────────────────────

export interface ShadowAgentStartedEvent {
  type: 'shadow.started';
  subagentId: string;
  intervalMs: number;
  model: string;
  startTime: string;
}

export interface ShadowAgentHeartbeatEvent {
  type: 'shadow.heartbeat';
  subagentId: string;
  timestamp: string;
  agentCount: number;
  runningCount: number;
  anomalyCount: number;
}

export interface ShadowAgentAnomalyEvent {
  type: 'shadow.anomaly';
  subagentId: string;
  anomaly: {
    id: string;
    type: 'stuck_agent' | 'spike_task' | 'mailbox_loop' | 'budget_exhausted' | 'orphan_assign';
    severity: 'low' | 'medium' | 'high' | 'critical';
    agentId?: string;
    description: string;
    detectedAt: string;
  };
}

export interface ShadowAgentInterventionEvent {
  type: 'shadow.intervention';
  subagentId: string;
  command: 'hoop' | 'mute' | 'resume' | 'custom';
  target?: string;
  result: 'success' | 'failure' | 'partial';
  affectedAgents: string[];
  timestamp: string;
}

export interface ShadowAgentStoppedEvent {
  type: 'shadow.stopped';
  subagentId: string;
  reason: 'natural' | 'commanded' | 'error';
  finalState: {
    totalHeartbeats: number;
    anomaliesDetected: number;
    interventionsExecuted: number;
    uptimeMs: number;
  };
}

// ── Union type for all Shadow Agent events ─────────────────────────────────

export type ShadowAgentEvent =
  | ShadowAgentStartedEvent
  | ShadowAgentHeartbeatEvent
  | ShadowAgentAnomalyEvent
  | ShadowAgentInterventionEvent
  | ShadowAgentStoppedEvent;

// ── FleetBus event envelope (what actually travels through FleetBus) ─────────

export interface FleetBusShadowEnvelope {
  shadowAgentId: string;
  event: ShadowAgentEvent;
  publishedAt: string;
}
