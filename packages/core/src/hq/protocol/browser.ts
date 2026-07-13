import type { HqAlertMessage, HqEventEnvelope, HqHeartbeatMessage } from './core.js';
import type { HqSnapshot } from './session.js';

export interface HqBrowserSnapshotMessage {
  type: 'hq.snapshot';
  snapshot: HqSnapshot;
}

export interface HqBrowserEventMessage<TPayload = unknown> {
  type: 'hq.event';
  event: HqEventEnvelope<TPayload>;
}

export type HqBrowserMessage =
  | HqBrowserSnapshotMessage
  | HqBrowserEventMessage
  | HqAlertMessage
  | HqHeartbeatMessage;
