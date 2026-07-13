// ── Brain decision telemetry ───────────────────────────────────────────────
//
// The Brain (decision layer) routes autonomous decisions through a three-tier
// chain. These envelopes let the HQ command center observe decision requests,
// answers, denials, ask-human escalations, and self-activated interventions
// across every connected machine — without coupling HQ to the in-process
// Brain. All payloads are plain serializable data (no closures); the rich
// BrainDecisionRequest / BrainDecision shapes are forwarded as-is.

export type HqBrainEventKind =
  | 'decision_requested'
  | 'decision_answered'
  | 'decision_ask_human'
  | 'human_answered'
  | 'decision_denied'
  | 'intervention';

export interface HqBrainEventPayload {
  /** Which brain lifecycle event this is (mirrors the EventBus `brain.*` name suffix). */
  kind: HqBrainEventKind;
  /** The decision request id, when present (decision_request/answer/deny). */
  requestId?: string;
  /** Short human-readable question the brain was asked. */
  question?: string;
  /** The source that triggered the decision (e.g. 'autonomy', 'system'). */
  source?: string;
  /** Resolved risk tier, when known (e.g. 'low' | 'medium' | 'high'). */
  risk?: string;
  /** The chosen decision kind, when answered/denied (e.g. 'answer' | 'ask_human' | 'deny'). */
  decision?: string;
  /** Free-text rationale or answer payload, when present. */
  detail?: string;
  /** For `intervention`: the watched signal that engaged the brain. */
  interventionKind?: 'tool_failure_streak' | 'error_storm' | 'agent_stall' | 'file_churn';
  /** For `intervention`: true when a steer was actually delivered to the agent. */
  intervened?: boolean;
  /** Epoch milliseconds at which the event occurred. */
  at: number;
}
