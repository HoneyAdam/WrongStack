/**
 * Shared types for the HQ server modules.
 *
 * @module hq-server/types
 */

import type { WebSocket } from 'ws';
import type {
  HqClientCapability,
  HqClientRecord,
  HqEventEnvelope,
  HqFleetSnapshotPayload,
  HqMailboxSnapshotPayload,
  HqMcpServerHealth,
  HqPersistence,
  HqProjectIdentity,
  HqProjectRecord,
  HqQueuedCommand,
  HqRedactionPolicy,
  HqSessionSnapshotPayload,
  HqToken,
  HqTranscriptEntry,
} from '@wrongstack/core';
import type { HqBrowserMessage } from '@wrongstack/core';

export type {
  HqClientCapability,
  HqClientRecord,
  HqEventEnvelope,
  HqFleetSnapshotPayload,
  HqMailboxSnapshotPayload,
  HqMcpServerHealth,
  HqPersistence,
  HqProjectIdentity,
  HqProjectRecord,
  HqQueuedCommand,
  HqRedactionPolicy,
  HqSessionSnapshotPayload,
  HqToken,
  HqTranscriptEntry,
  HqBrowserMessage,
};

// ── In-memory data structures ──────────────────────────────────────────────

export interface TrackedSessionSnapshot {
  payload: HqSessionSnapshotPayload;
  /** Epoch ms of the last `session.snapshot` refresh — freshness authority for the cleanup timer. */
  receivedAt: number;
}

export interface ConnectedClient {
  ws: WebSocket;
  clientId: string;
  projectId: string;
  project: HqProjectIdentity;
  kind: string;
  connectedAt: string;
  lastSeenAt: string;
  hostname?: string;
  pid?: number;
  version?: string;
  capabilities: readonly string[];
  /** Auth token used for this socket; absent only in explicit open mode. */
  authToken?: HqToken;
  /** Client-declared privacy policy; operator overrides are clamped dynamically. */
  declaredRedactionPolicy: HqRedactionPolicy;
  /** Highest accepted event sequence for replay/duplicate protection. */
  lastEventSeq: number;
  /** Per-client mailbox snapshots, keyed by projectId:mailboxId. */
  mailboxes: Map<string, HqMailboxSnapshotPayload>;
  /** Stable machine identifier — used for machine-level aggregation. */
  machineId?: string;
  /** Per-client session snapshots (the spine of the fleet tree). */
  sessions: Map<string, TrackedSessionSnapshot>;
  /** Per-client coordinator fleet snapshots, keyed by runId. */
  fleets: Map<string, HqFleetSnapshotPayload>;
  /** Per-session MCP health snapshots, keyed by sessionId. */
  mcpSnapshots: Map<string, HqMcpServerHealth[]>;
  /** Pending outbound commands (Phase 3 — control plane). */
  commandQueue: HqQueuedCommand[];
}

// ── Transcript ring buffer ─────────────────────────────────────────────────

export interface TranscriptRing {
  entries: HqTranscriptEntry[];
  machineId?: string;
}

// ── Snapshot broadcaster ───────────────────────────────────────────────────

export interface HqSnapshotBroadcaster {
  currentSerialized(): string;
  broadcast(): void;
  close(): void;
}

// ── Project detail ─────────────────────────────────────────────────────────

export interface ProjectDetail {
  generatedAt: string;
  project: HqProjectRecord;
  clients: readonly HqClientRecord[];
  mailboxes: readonly HqMailboxSnapshotPayload[];
}
