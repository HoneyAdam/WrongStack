export const HQ_PROTOCOL_VERSION = 1 as const;

export type HqProtocolVersion = typeof HQ_PROTOCOL_VERSION;

export type HqClientKind = 'tui' | 'repl' | 'webui' | 'cli' | 'unknown';

export type HqWorkspaceKind = 'git' | 'directory' | 'unknown';

export type HqProjectStatus = 'active' | 'idle' | 'stale' | 'error';

export type HqClientCapability =
  | 'telemetry.publish'
  | 'session.summary'
  | 'fleet.summary'
  | 'mailbox.summary'
  | 'control.receive';

export type HqToolArgsPolicy = 'none' | 'summary' | 'redacted' | 'full';

export type HqPathPolicy = 'none' | 'project-relative' | 'redacted' | 'full';

export interface HqRedactionPolicy {
  rawContent: boolean;
  toolArgs: HqToolArgsPolicy;
  paths: HqPathPolicy;
}

export const DEFAULT_HQ_REDACTION_POLICY: HqRedactionPolicy = {
  rawContent: true,
  toolArgs: 'full',
  paths: 'full',
};

/**
 * Per-string cap applied when redacting chat-transcript events
 * (`session.transcript` / `agent.message`). The generic 500-char summary cap
 * is right for telemetry rollups but would mangle full chat-history rendering
 * in the HQ Console once `rawContent` is enabled — messages and tool outputs
 * routinely exceed it. Applied publisher-side AND at the server's re-redaction
 * so both hops agree.
 */
export const HQ_TRANSCRIPT_TEXT_CAP = 16_000;

export interface HqClientIdentity {
  clientId: string;
  kind: HqClientKind;
  version?: string;
  machineId: string;
  hostname?: string;
  pid?: number;
  startedAt: string;
}

export interface HqProjectIdentity {
  projectId: string;
  projectRoot: string;
  projectName: string;
  gitRemote?: string;
  gitBranch?: string;
  machineId: string;
  workspaceKind: HqWorkspaceKind;
}

export interface HqClientHelloPayload {
  protocolVersion: HqProtocolVersion;
  client: HqClientIdentity;
  project: HqProjectIdentity;
  capabilities: readonly HqClientCapability[];
  /** Publisher-side policy already applied before telemetry leaves the client. */
  redactionPolicy?: HqRedactionPolicy;
}

export interface HqWelcomePayload {
  type: 'hq.welcome';
  protocolVersion: HqProtocolVersion;
  serverTime: string;
  acceptedCapabilities: readonly HqClientCapability[];
  redactionPolicy: HqRedactionPolicy;
}

export interface HqEventEnvelope<TPayload = unknown> {
  id: string;
  type: HqEventType | (string & {});
  schemaVersion: HqProtocolVersion;
  timestamp: string;
  clientId: string;
  projectId: string;
  sessionId?: string;
  runId?: string;
  seq: number;
  payload: TPayload;
}

export type HqEventType =
  | 'client.hello'
  | 'client.heartbeat'
  | 'session.started'
  | 'session.status'
  | 'session.usage'
  | 'tool.started'
  | 'tool.completed'
  | 'fleet.snapshot'
  | 'fleet.event'
  | 'mailbox.snapshot'
  | 'mailbox.event'
  | 'worklist.snapshot'
  | 'git.snapshot'
  | 'agent.message'
  | 'agent.status'
  | 'session.snapshot'
  | 'session.transcript'
  | 'session.ended'
  | 'brain.event'
  | 'worktree.event'
  | 'mcp.health.snapshot'
  | 'mcp.operation';

export interface HqClientHeartbeatPayload {
  uptimeMs: number;
  activeSessionId?: string;
  activeRunId?: string;
  status: HqProjectStatus;
  activeSubagents?: number;
  queuedTasks?: number;
}

export type HqSessionStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';

export interface HqSessionStartedPayload {
  sessionId: string;
  provider?: string;
  model?: string;
  startedAt: string;
}

export interface HqSessionStatusPayload {
  status: HqSessionStatus;
  phase?: string;
  message?: string;
}

export interface HqUsagePayload {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  durationMs?: number;
}

export interface HqToolStartedPayload {
  toolName: string;
  capabilities?: readonly string[];
  risk?: string;
  inputSummary?: unknown;
}

export interface HqToolCompletedPayload {
  toolName: string;
  status: 'success' | 'error' | 'timeout' | 'cancelled';
  durationMs: number;
  outputSummary?: unknown;
  errorClass?: string;
}

export interface HqSubagentSummary {
  subagentId: string;
  role?: string;
  status: 'pending' | 'running' | 'idle' | 'completed' | 'failed' | 'stopped';
  task?: string;
  currentTool?: string;
  runtimeMs?: number;
  costUsd?: number;
  lastActivityAt?: string;
}

export interface HqFleetSnapshotPayload {
  runId: string;
  activeSubagents: number;
  queuedTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalCostUsd?: number;
  subagents: readonly HqSubagentSummary[];
}

/** Payload for `agent.message` events — a subagent's conversational output. */
export interface HqAgentMessagePayload {
  subagentId: string;
  agentName: string;
  content: string;
  kind: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'error' | 'status' | 'system';
  iteration: number;
  ts: string;
  toolName?: string;
  costUsd?: number;
}

/** Payload for `agent.status` events — a subagent's lifecycle transition. */
export interface HqAgentStatusPayload {
  subagentId: string;
  agentName: string;
  status:
    | 'spawned'
    | 'running'
    | 'completed'
    | 'failed'
    | 'timeout'
    | 'stopped'
    | 'budget_exhausted';
  ts: string;
  summary?: string;
  task?: string;
}

export interface HqFleetEventPayload {
  runId: string;
  subagentId?: string;
  event: string;
  summary?: string;
  data?: unknown;
}

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
  interventionKind?: 'tool_failure_streak' | 'error_storm';
  /** For `intervention`: true when a steer was actually delivered to the agent. */
  intervened?: boolean;
  /** Epoch milliseconds at which the event occurred. */
  at: number;
}

// ── Worktree lifecycle telemetry ────────────────────────────────────────────
//
// AutoPhase allocates one git worktree per phase so parallelizable phases run
// isolated, then merges them back sequentially. These envelopes let HQ render
// live build phase swim-lanes / DAG across every connected machine. All fields
// are plain serializable data (the EventBus `worktree.*` payloads forwarded
// with the type tag added).

export type HqWorktreeEventKind =
  | 'allocated'
  | 'committed'
  | 'merged'
  | 'conflict'
  | 'released'
  | 'failed';

export interface HqWorktreeEventPayload {
  /** Which worktree lifecycle event this is (mirrors `worktree.<kind>`). */
  kind: HqWorktreeEventKind;
  handleId: string;
  ownerId: string;
  ownerLabel?: string;
  slug?: string;
  branch?: string;
  baseBranch?: string;
  /** For `committed`: diff stats. */
  insertions?: number;
  deletions?: number;
  files?: number;
  sha?: string;
  /** For `merged`: whether the merge was a squash. */
  squash?: boolean;
  /** For `conflict`: the list of conflicting files. */
  conflictFiles?: readonly string[];
  /** For `released`: whether the worktree was kept (true) or pruned (false). */
  kept?: boolean;
  /** For `failed`: the error message. */
  error?: string;
}

// ── Session telemetry (live terminals + full chat transcript) ──────────────
//
// Every surface (tui / repl / webui / cli) streams its own live session state
// and conversation transcript to HQ so the command center can render a true
// machine → project → terminal → agent → full-history tree across every
// connected machine — not just the one HQ happens to run on.

export type HqSessionLiveStatus = 'active' | 'idle' | 'closing' | 'stale';

export type HqSessionAgentLiveStatus = 'idle' | 'running' | 'streaming' | 'waiting_user' | 'error';

/** A single live agent inside a session snapshot (mirrors SessionRegistry's AgentEntry). */
export interface HqSessionAgentSummary {
  id: string;
  name: string;
  /** UTC ISO timestamp when this agent/run started, when known. */
  startedAt?: string;
  status: HqSessionAgentLiveStatus;
  currentTool?: string;
  iterations: number;
  toolCalls: number;
  costUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
  ctxPct?: number;
  model?: string;
  /** Throttled tail of the response currently streaming, when known. */
  partialText?: string;
  lastActivityAt: string;
}

/** Payload for `session.snapshot` — one connected terminal's live state. */
export interface HqSessionSnapshotPayload {
  sessionId: string;
  clientKind: HqClientKind;
  machineId: string;
  hostname?: string;
  pid?: number;
  projectId: string;
  projectName: string;
  projectRoot: string;
  gitBranch?: string;
  status: HqSessionLiveStatus;
  startedAt: string;
  lastActivityAt: string;
  agentCount: number;
  agents: readonly HqSessionAgentSummary[];
}

export type HqTranscriptRole = 'user' | 'assistant' | 'thinking' | 'tool' | 'system' | 'error';

/** One rendered conversation turn. Canonical shape shared by client streaming
 * and server-side JSONL replay so both planes agree. */
export interface HqTranscriptEntry {
  ts: string;
  role: HqTranscriptRole;
  text: string;
  tool?: string;
  /** Stringified tool input/arguments, for tool calls (shown alongside the result). */
  toolInput?: string;
  durationMs?: number;
  isError?: boolean;
  toolUseId?: string;
  /** Which agent/subagent produced this turn, when attribution is known. */
  agentId?: string;
}

/** Payload for `session.transcript` — an incremental batch of new turns. */
export interface HqTranscriptAppendPayload {
  sessionId: string;
  /** Monotonic sequence index of the FIRST entry in this batch within the session. */
  fromSeq: number;
  entries: readonly HqTranscriptEntry[];
}

/** Payload for `session.ended` — a terminal closed. */
export interface HqSessionEndedPayload {
  sessionId: string;
  endedAt: string;
}

/** A physical machine, aggregated by HQ from connected clients' machineId. */
export interface HqMachineRecord {
  machineId: string;
  hostname?: string;
  clientCount: number;
  sessionCount: number;
  agentCount: number;
  projectIds: readonly string[];
  lastActivityAt: string;
}

export type HqMailboxMessageType =
  | 'note'
  | 'ask'
  | 'assign'
  | 'steer'
  | 'btw'
  | 'broadcast'
  | 'status'
  | 'result'
  | 'review'
  | 'control';

export type HqMailboxPriority = 'low' | 'normal' | 'high';

export type HqMailboxAgentStatus =
  | 'idle'
  | 'running'
  | 'streaming'
  | 'waiting_user'
  | 'error'
  | 'offline';

export interface HqMailboxMessageSummary {
  mailId: string; // unique UUID per message record, used for deduplication
  messageId: string;
  from: string;
  to: string;
  type: HqMailboxMessageType;
  subject: string;
  priority: HqMailboxPriority;
  timestamp: string;
  replyTo?: string;
  senderSessionId?: string;
  completed: boolean;
  completedBy?: string;
  completedAt?: string;
  unreadCount?: number;
  readCount?: number;
  hasBody: boolean;
  bodyPreview?: string;
  outcomePreview?: string;
  task?: {
    taskId?: string;
    agentRole?: string;
    agentName?: string;
    status?: 'pending' | 'in_progress' | 'completed' | 'failed';
  };
}

export interface HqMailboxAgentSummary {
  agentId: string;
  name: string;
  role?: string;
  sessionId: string;
  status: HqMailboxAgentStatus;
  currentTool?: string;
  currentTask?: string;
  iterations: number;
  toolCalls: number;
  lastActivityAt: string;
  lastSeenAt: string;
  online: boolean;
  source?: 'cli' | 'webui' | 'mcp' | 'acp' | 'http';
}

export interface HqMailboxSnapshotPayload {
  mailboxId: string;
  scope: 'project' | 'global';
  messages: readonly HqMailboxMessageSummary[];
  agents: readonly HqMailboxAgentSummary[];
  totals: {
    messages: number;
    unread: number;
    incomplete: number;
    highPriority: number;
    onlineAgents: number;
  };
}

export interface HqMailboxEventPayload {
  mailboxId: string;
  action:
    | 'message.sent'
    | 'message.read'
    | 'message.completed'
    | 'message.updated'
    | 'agent.registered'
    | 'agent.heartbeat'
    | 'agent.offline'
    | 'agent.deregistered';
  message?: HqMailboxMessageSummary;
  agent?: HqMailboxAgentSummary;
  summary?: string;
}

export interface HqWorklistSnapshotPayload {
  todos?: HqWorklistCounts;
  tasks?: HqWorklistCounts;
  plans?: HqWorklistCounts;
  activeItem?: string;
}

export interface HqWorklistCounts {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  failed?: number;
}

export interface HqGitSnapshotPayload {
  branch?: string;
  dirtyFiles?: number;
  stagedFiles?: number;
  ahead?: number;
  behind?: number;
}

export interface HqClientRecord {
  clientId: string;
  kind: HqClientKind;
  machineId: string;
  hostname?: string;
  pid?: number;
  version?: string;
  connected: boolean;
  connectedAt?: string;
  lastSeenAt: string;
  projectId: string;
  sessionId?: string;
  capabilities: readonly HqClientCapability[];
}

export interface HqProjectRecord {
  projectId: string;
  projectName: string;
  projectRootDisplay: string;
  machineIds: readonly string[];
  gitBranch?: string;
  activeClients: number;
  activeSessions: number;
  activeSubagents: number;
  totalCostUsd: number;
  lastActivityAt: string;
  status: HqProjectStatus;
}

export interface HqSessionSummary {
  sessionId: string;
  projectId: string;
  clientId: string;
  status: HqSessionStatus;
  provider?: string;
  model?: string;
  startedAt?: string;
  lastActivityAt: string;
  costUsd?: number;
}

export interface HqFleetSummary {
  runId: string;
  projectId: string;
  clientId: string;
  activeSubagents: number;
  queuedTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalCostUsd?: number;
  lastActivityAt: string;
}

export interface HqMailboxSummary {
  mailboxId: string;
  projectId: string;
  scope: 'project' | 'global';
  messageCount: number;
  unreadCount: number;
  incompleteCount: number;
  highPriorityCount: number;
  onlineAgentCount: number;
  lastActivityAt: string;
}

export interface HqMcpLatencySummary {
  count: number;
  lastMs?: number | undefined;
  minMs?: number | undefined;
  maxMs?: number | undefined;
  p50Ms?: number | undefined;
  p95Ms?: number | undefined;
}

export interface HqMcpFailureCounts {
  transport: number;
  protocol: number;
  tool: number;
}

export interface HqMcpHealthCheck {
  name: string;
  passed: boolean;
  value?: number | undefined;
  threshold?: number | undefined;
}

export type HqMcpHealthState =
  | 'disabled'
  | 'dormant'
  | 'connecting'
  | 'healthy'
  | 'degraded'
  | 'failed';

export type HqMcpConnectionState =
  | 'idle'
  | 'dormant'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'failed';

export interface HqMcpServerHealth {
  name: string;
  projectId: string;
  clientId: string;
  connectionState: HqMcpConnectionState;
  healthState: HqMcpHealthState;
  lastSuccessAt?: string | undefined;
  lastFailureAt?: string | undefined;
  lastFailureKind?: 'transport' | 'protocol' | 'tool' | undefined;
  consecutiveFailures: number;
  failures: HqMcpFailureCounts;
  reconnectCount: number;
  wakeCount: number;
  sleepCount: number;
  restartCount: number;
  connectionLatency: HqMcpLatencySummary;
  discoveryLatency: HqMcpLatencySummary;
  callLatency: HqMcpLatencySummary;
  inFlightCalls: number;
  peakInFlightCalls: number;
  healthChecks: HqMcpHealthCheck[];
}

export interface HqMcpHealthSnapshotPayload {
  servers: HqMcpServerHealth[];
}

export interface HqMcpOperationPayload {
  operation: Record<string, unknown>;
  servers: HqMcpServerHealth[];
}

export interface HqSnapshot {
  generatedAt: string;
  clients: readonly HqClientRecord[];
  projects: readonly HqProjectRecord[];
  sessions: readonly HqSessionSummary[];
  fleets: readonly HqFleetSummary[];
  mailboxes: readonly HqMailboxSummary[];
  /** Physical machines aggregated from connected clients (optional, additive). */
  machines?: readonly HqMachineRecord[];
  /** Live terminal sessions with their agents — the spine of the fleet tree. */
  liveSessions?: readonly HqSessionSnapshotPayload[];
  /** Latest operational health for each MCP server reported by any connected client. */
  mcpServers?: readonly HqMcpServerHealth[];
  totals: {
    activeProjects: number;
    activeClients: number;
    activeSessions: number;
    activeSubagents: number;
    unreadMailboxMessages: number;
    incompleteMailboxMessages: number;
    totalCostUsd: number;
    /** Distinct physical machines currently connected. */
    activeMachines?: number;
    /** Total live agents across all sessions. */
    activeAgents?: number;
  };
}

export interface HqBrowserSnapshotMessage {
  type: 'hq.snapshot';
  snapshot: HqSnapshot;
}

export interface HqBrowserEventMessage<TPayload = unknown> {
  type: 'hq.event';
  event: HqEventEnvelope<TPayload>;
}

export interface HqAlertMessage {
  type: 'hq.alert';
  severity: 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
}

export interface HqHeartbeatMessage {
  type: 'hq.heartbeat';
  serverTime: string;
}

export type HqBrowserMessage =
  | HqBrowserSnapshotMessage
  | HqBrowserEventMessage
  | HqAlertMessage
  | HqHeartbeatMessage;

export interface HqClientHelloMessage {
  type: 'client.hello';
  payload: HqClientHelloPayload;
}

export interface HqClientEventMessage<TPayload = unknown> {
  type: 'client.event';
  event: HqEventEnvelope<TPayload>;
}

export interface HqClientCommandPollMessage {
  type: 'client.command_poll';
  clientId: string;
  projectId: string;
  afterCommandId?: string;
  limit?: number;
}

export interface HqClientCommandAckMessage {
  type: 'client.command_ack';
  clientId: string;
  projectId: string;
  commandId: string;
  status: 'accepted' | 'completed' | 'failed' | 'rejected';
  message?: string;
}

export interface HqQueuedCommand {
  commandId: string;
  type: string;
  createdAt: string;
  payload: unknown;
  requiresAck?: boolean;
}

export interface HqServerCommandBatchMessage {
  type: 'hq.command_batch';
  commands: readonly HqQueuedCommand[];
}

export type HqClientMessage =
  | HqClientHelloMessage
  | HqClientEventMessage
  | HqClientCommandPollMessage
  | HqClientCommandAckMessage;

export type HqServerMessage = HqServerCommandBatchMessage | HqWelcomePayload;

/**
 * Discriminated parse result for {@link parseHqFrame}. The `reason` field
 * is only present when `ok` is `false`; consumers should narrow on `ok`
 * before accessing `frame` or `reason`.
 */
export type HqParseResult =
  | { ok: true; frame: HqClientMessage }
  | { ok: false; reason: 'invalid-json' | 'unknown-type' | 'malformed' };

/** Known client → server frame `type` discriminators. */
const KNOWN_HQ_CLIENT_FRAME_TYPES = new Set<HqClientMessage['type']>([
  'client.hello',
  'client.event',
  'client.command_poll',
  'client.command_ack',
]);

const HQ_CLIENT_KINDS = new Set<HqClientKind>(['tui', 'repl', 'webui', 'cli', 'unknown']);
const HQ_WORKSPACE_KINDS = new Set<HqWorkspaceKind>(['git', 'directory', 'unknown']);
const HQ_CLIENT_CAPABILITIES = new Set<HqClientCapability>([
  'telemetry.publish',
  'session.summary',
  'fleet.summary',
  'mailbox.summary',
  'control.receive',
]);
const HQ_COMMAND_ACK_STATUSES = new Set<HqClientCommandAckMessage['status']>([
  'accepted',
  'completed',
  'failed',
  'rejected',
]);

/** Top-level object + string `type` guard. */
function hasStringType(x: unknown): x is { type: string } {
  return typeof x === 'object' && x !== null && typeof (x as { type?: unknown }).type === 'string';
}

function isHqClientIdentity(x: unknown): x is HqClientIdentity {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  return (
    typeof v.clientId === 'string' &&
    typeof v.kind === 'string' &&
    HQ_CLIENT_KINDS.has(v.kind as HqClientKind) &&
    typeof v.machineId === 'string' &&
    typeof v.startedAt === 'string'
  );
}

function isHqProjectIdentity(x: unknown): x is HqProjectIdentity {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  return (
    typeof v.projectId === 'string' &&
    typeof v.projectRoot === 'string' &&
    typeof v.projectName === 'string' &&
    typeof v.machineId === 'string' &&
    typeof v.workspaceKind === 'string' &&
    HQ_WORKSPACE_KINDS.has(v.workspaceKind as HqWorkspaceKind)
  );
}

function isHqRedactionPolicy(x: unknown): x is HqRedactionPolicy {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  return (
    typeof v.rawContent === 'boolean' &&
    (v.toolArgs === 'none' || v.toolArgs === 'summary' || v.toolArgs === 'redacted' || v.toolArgs === 'full') &&
    (v.paths === 'none' ||
      v.paths === 'project-relative' ||
      v.paths === 'redacted' ||
      v.paths === 'full')
  );
}

function isHqClientHelloPayload(x: unknown): x is HqClientHelloPayload {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  return (
    typeof v.protocolVersion === 'number' &&
    isHqClientIdentity(v.client) &&
    isHqProjectIdentity(v.project) &&
    Array.isArray(v.capabilities) &&
    v.capabilities.every(
      (capability) =>
        typeof capability === 'string' &&
        HQ_CLIENT_CAPABILITIES.has(capability as HqClientCapability),
    ) &&
    (v.redactionPolicy === undefined || isHqRedactionPolicy(v.redactionPolicy))
  );
}

function isHqEventEnvelope(x: unknown): x is HqEventEnvelope {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.type === 'string' &&
    v.schemaVersion === HQ_PROTOCOL_VERSION &&
    typeof v.timestamp === 'string' &&
    typeof v.clientId === 'string' &&
    typeof v.projectId === 'string' &&
    Number.isSafeInteger(v.seq) &&
    (v.seq as number) >= 0 &&
    Object.hasOwn(v, 'payload')
  );
}

function isHqClientCommandPollMessage(x: unknown): x is HqClientCommandPollMessage {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  return (
    typeof v.clientId === 'string' &&
    typeof v.projectId === 'string' &&
    (v.afterCommandId === undefined || typeof v.afterCommandId === 'string') &&
    (v.limit === undefined ||
      (Number.isSafeInteger(v.limit) && (v.limit as number) > 0 && (v.limit as number) <= 200))
  );
}

function isHqClientCommandAckMessage(x: unknown): x is HqClientCommandAckMessage {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  return (
    typeof v.clientId === 'string' &&
    typeof v.projectId === 'string' &&
    typeof v.commandId === 'string' &&
    typeof v.status === 'string' &&
    HQ_COMMAND_ACK_STATUSES.has(v.status as HqClientCommandAckMessage['status']) &&
    (v.message === undefined || typeof v.message === 'string')
  );
}

/**
 * Strictly parse a raw client → server frame into a {@link HqParseResult}.
 *
 * Validates, in order:
 *  1. JSON syntax (`invalid-json` on failure)
 *  2. Top-level object with string `type` discriminator
 *  3. `type` is one of {@link HqClientMessage} union members (`unknown-type`)
 *  4. Per-type field-shape presence checks (`malformed` on failure)
 *
 * On success, `frame` is narrowed to {@link HqClientMessage} and consumers
 * can switch on `frame.type` for type-safe access to per-union-member
 * fields without `as` casts.
 */
export function parseHqFrame(raw: string | Buffer): HqParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }

  if (!hasStringType(parsed)) {
    return { ok: false, reason: 'malformed' };
  }
  const obj = parsed as { type: string } & Record<string, unknown>;

  if (!KNOWN_HQ_CLIENT_FRAME_TYPES.has(obj.type as HqClientMessage['type'])) {
    return { ok: false, reason: 'unknown-type' };
  }

  switch (obj.type as HqClientMessage['type']) {
    case 'client.hello':
      if (!isHqClientHelloPayload(obj.payload)) {
        return { ok: false, reason: 'malformed' };
      }
      return { ok: true, frame: { type: 'client.hello', payload: obj.payload } };
    case 'client.event':
      if (!isHqEventEnvelope(obj.event)) {
        return { ok: false, reason: 'malformed' };
      }
      return { ok: true, frame: { type: 'client.event', event: obj.event } };
    case 'client.command_poll':
      if (!isHqClientCommandPollMessage(obj)) {
        return { ok: false, reason: 'malformed' };
      }
      return {
        ok: true,
        frame: {
          type: 'client.command_poll',
          clientId: obj.clientId,
          projectId: obj.projectId,
          ...(typeof obj.afterCommandId === 'string'
            ? { afterCommandId: obj.afterCommandId }
            : {}),
          ...(typeof obj.limit === 'number' ? { limit: obj.limit } : {}),
        },
      };
    case 'client.command_ack':
      if (!isHqClientCommandAckMessage(obj)) {
        return { ok: false, reason: 'malformed' };
      }
      return {
        ok: true,
        frame: {
          type: 'client.command_ack',
          clientId: obj.clientId,
          projectId: obj.projectId,
          commandId: obj.commandId,
          status: obj.status as HqClientCommandAckMessage['status'],
          ...(typeof obj.message === 'string' ? { message: obj.message } : {}),
        },
      };
    default: {
      // Unreachable: KNOWN_HQ_CLIENT_FRAME_TYPES membership guarantees
      // `obj.type` is one of the cases above. Return `unknown-type` defensively
      // to satisfy the return type if a future HqClientMessage union member
      // is added without updating this switch.
      const _exhaustive: never = obj.type as never;
      return _exhaustive;
    }
  }
}

/** Known `client.event` envelope event types whose payload shape we validate. */
const KNOWN_HQ_EVENT_PAYLOAD_TYPES = new Set<string>([
  'mailbox.snapshot',
  'mailbox.event',
  'session.snapshot',
  'session.transcript',
  'session.ended',
  'fleet.snapshot',
  'fleet.event',
  'brain.event',
  'worktree.event',
  'tool.started',
  'tool.completed',
  'session.usage',
  'client.heartbeat',
  'mcp.health.snapshot',
  'mcp.operation',
]);

function isHqMcpLatencySummary(x: unknown): x is HqMcpLatencySummary {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  return (
    typeof v.count === 'number' &&
    (v.lastMs === undefined || typeof v.lastMs === 'number') &&
    (v.minMs === undefined || typeof v.minMs === 'number') &&
    (v.maxMs === undefined || typeof v.maxMs === 'number') &&
    (v.p50Ms === undefined || typeof v.p50Ms === 'number') &&
    (v.p95Ms === undefined || typeof v.p95Ms === 'number')
  );
}

function isHqMcpFailureCounts(x: unknown): x is HqMcpFailureCounts {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  return (
    typeof v.transport === 'number' &&
    typeof v.protocol === 'number' &&
    typeof v.tool === 'number'
  );
}

function isHqMcpHealthCheck(x: unknown): x is HqMcpHealthCheck {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  return (
    typeof v.name === 'string' &&
    typeof v.passed === 'boolean' &&
    (v.value === undefined || typeof v.value === 'number') &&
    (v.threshold === undefined || typeof v.threshold === 'number')
  );
}

const HQ_MCP_HEALTH_STATES = new Set<string>([
  'disabled',
  'dormant',
  'connecting',
  'healthy',
  'degraded',
  'failed',
]);

const HQ_MCP_CONNECTION_STATES = new Set<string>([
  'idle',
  'dormant',
  'connecting',
  'connected',
  'reconnecting',
  'disconnected',
  'failed',
]);

function isHqMcpServerHealth(x: unknown): x is HqMcpServerHealth {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  return (
    typeof v.name === 'string' &&
    typeof v.projectId === 'string' &&
    typeof v.clientId === 'string' &&
    typeof v.connectionState === 'string' &&
    HQ_MCP_CONNECTION_STATES.has(v.connectionState) &&
    typeof v.healthState === 'string' &&
    HQ_MCP_HEALTH_STATES.has(v.healthState) &&
    (v.lastSuccessAt === undefined || typeof v.lastSuccessAt === 'string') &&
    (v.lastFailureAt === undefined || typeof v.lastFailureAt === 'string') &&
    (v.lastFailureKind === undefined ||
      v.lastFailureKind === 'transport' ||
      v.lastFailureKind === 'protocol' ||
      v.lastFailureKind === 'tool') &&
    typeof v.consecutiveFailures === 'number' &&
    isHqMcpFailureCounts(v.failures) &&
    typeof v.reconnectCount === 'number' &&
    typeof v.wakeCount === 'number' &&
    typeof v.sleepCount === 'number' &&
    typeof v.restartCount === 'number' &&
    isHqMcpLatencySummary(v.connectionLatency) &&
    isHqMcpLatencySummary(v.discoveryLatency) &&
    isHqMcpLatencySummary(v.callLatency) &&
    typeof v.inFlightCalls === 'number' &&
    typeof v.peakInFlightCalls === 'number' &&
    Array.isArray(v.healthChecks) &&
    v.healthChecks.every(isHqMcpHealthCheck)
  );
}

function isHqMcpHealthSnapshotPayload(x: unknown): x is HqMcpHealthSnapshotPayload {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  return Array.isArray(v.servers) && v.servers.every(isHqMcpServerHealth);
}

function isHqMcpOperationPayload(x: unknown): x is HqMcpOperationPayload {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  return (
    typeof v.operation === 'object' &&
    v.operation !== null &&
    Array.isArray(v.servers) &&
    v.servers.every(isHqMcpServerHealth)
  );
}

function isHqMailboxMessageSummary(x: unknown): x is HqMailboxMessageSummary {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  return (
    typeof v.messageId === 'string' &&
    typeof v.from === 'string' &&
    typeof v.to === 'string' &&
    typeof v.subject === 'string' &&
    typeof v.priority === 'string' &&
    typeof v.timestamp === 'string' &&
    typeof v.completed === 'boolean' &&
    typeof v.hasBody === 'boolean'
  );
}

function isHqMailboxAgentSummary(x: unknown): x is HqMailboxAgentSummary {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  return (
    typeof v.agentId === 'string' &&
    typeof v.name === 'string' &&
    typeof v.sessionId === 'string' &&
    typeof v.status === 'string' &&
    typeof v.iterations === 'number' &&
    typeof v.toolCalls === 'number' &&
    typeof v.lastActivityAt === 'string' &&
    typeof v.lastSeenAt === 'string' &&
    typeof v.online === 'boolean'
  );
}

function isHqMailboxSnapshotPayload(x: unknown): x is HqMailboxSnapshotPayload {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  if (
    typeof v.mailboxId !== 'string' ||
    (v.scope !== 'project' && v.scope !== 'global') ||
    !Array.isArray(v.messages) ||
    !Array.isArray(v.agents) ||
    typeof v.totals !== 'object' ||
    v.totals === null
  ) {
    return false;
  }
  const totals = v.totals as Record<string, unknown>;
  if (
    typeof totals.messages !== 'number' ||
    typeof totals.unread !== 'number' ||
    typeof totals.incomplete !== 'number' ||
    typeof totals.highPriority !== 'number' ||
    typeof totals.onlineAgents !== 'number'
  ) {
    return false;
  }
  for (const message of v.messages) {
    if (!isHqMailboxMessageSummary(message)) return false;
  }
  for (const agent of v.agents) {
    if (!isHqMailboxAgentSummary(agent)) return false;
  }
  return true;
}

const HQ_MAILBOX_EVENT_ACTIONS = new Set<string>([
  'message.sent',
  'message.read',
  'message.completed',
  'message.updated',
  'agent.registered',
  'agent.heartbeat',
  'agent.offline',
  'agent.deregistered',
]);

function isHqMailboxEventPayload(x: unknown): x is HqMailboxEventPayload {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  if (typeof v.mailboxId !== 'string') return false;
  if (typeof v.action !== 'string' || !HQ_MAILBOX_EVENT_ACTIONS.has(v.action)) return false;
  // `message` and `agent` are optional but, when present, must satisfy
  // their respective shape guard so a downstream consumer can rely on
  // the typed fields.
  if (v.message !== undefined && !isHqMailboxMessageSummary(v.message)) return false;
  if (v.agent !== undefined && !isHqMailboxAgentSummary(v.agent)) return false;
  return true;
}

const HQ_SESSION_AGENT_STATUSES = new Set<string>([
  'idle',
  'running',
  'streaming',
  'waiting_user',
  'error',
]);

function isHqSessionAgentSummary(x: unknown): x is HqSessionAgentSummary {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.status === 'string' &&
    HQ_SESSION_AGENT_STATUSES.has(v.status) &&
    typeof v.iterations === 'number' &&
    typeof v.toolCalls === 'number' &&
    typeof v.lastActivityAt === 'string'
  );
}

const HQ_SESSION_STATUSES = new Set<string>(['active', 'idle', 'closing', 'stale']);

function isHqSessionSnapshotPayload(x: unknown): x is HqSessionSnapshotPayload {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  if (
    typeof v.sessionId !== 'string' ||
    typeof v.clientKind !== 'string' ||
    typeof v.machineId !== 'string' ||
    typeof v.projectId !== 'string' ||
    typeof v.projectName !== 'string' ||
    typeof v.projectRoot !== 'string' ||
    typeof v.status !== 'string' ||
    !HQ_SESSION_STATUSES.has(v.status) ||
    typeof v.startedAt !== 'string' ||
    typeof v.lastActivityAt !== 'string' ||
    typeof v.agentCount !== 'number' ||
    !Array.isArray(v.agents)
  ) {
    return false;
  }
  for (const agent of v.agents) {
    if (!isHqSessionAgentSummary(agent)) return false;
  }
  return true;
}

const HQ_TRANSCRIPT_ROLES = new Set<string>([
  'user',
  'assistant',
  'thinking',
  'tool',
  'system',
  'error',
]);

function isHqTranscriptEntry(x: unknown): x is HqTranscriptEntry {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  return (
    typeof v.ts === 'string' &&
    typeof v.role === 'string' &&
    HQ_TRANSCRIPT_ROLES.has(v.role) &&
    typeof v.text === 'string'
  );
}

function isHqTranscriptAppendPayload(x: unknown): x is HqTranscriptAppendPayload {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  if (
    typeof v.sessionId !== 'string' ||
    typeof v.fromSeq !== 'number' ||
    !Array.isArray(v.entries)
  ) {
    return false;
  }
  for (const entry of v.entries) {
    if (!isHqTranscriptEntry(entry)) return false;
  }
  return true;
}

function isHqSessionEndedPayload(x: unknown): x is HqSessionEndedPayload {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  return typeof v.sessionId === 'string' && typeof v.endedAt === 'string';
}

const HQ_FLEET_SUBAGENT_STATUS = new Set<string>([
  'pending',
  'running',
  'idle',
  'completed',
  'failed',
  'stopped',
]);

function isHqSubagentSummary(x: unknown): x is HqSubagentSummary {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  return (
    typeof v.subagentId === 'string' &&
    typeof v.status === 'string' &&
    HQ_FLEET_SUBAGENT_STATUS.has(v.status)
  );
}

function isHqFleetSnapshotPayload(x: unknown): x is HqFleetSnapshotPayload {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  if (
    typeof v.runId !== 'string' ||
    typeof v.activeSubagents !== 'number' ||
    typeof v.queuedTasks !== 'number' ||
    typeof v.completedTasks !== 'number' ||
    typeof v.failedTasks !== 'number' ||
    !Array.isArray(v.subagents)
  ) {
    return false;
  }
  for (const s of v.subagents) {
    if (!isHqSubagentSummary(s)) return false;
  }
  return true;
}

function isHqFleetEventPayload(x: unknown): x is HqFleetEventPayload {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  return typeof v.runId === 'string' && typeof v.event === 'string';
}

const HQ_BRAIN_EVENT_KINDS = new Set<string>([
  'decision_requested',
  'decision_answered',
  'decision_ask_human',
  'human_answered',
  'decision_denied',
  'intervention',
]);

function isHqBrainEventPayload(x: unknown): x is HqBrainEventPayload {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  if (typeof v.kind !== 'string' || !HQ_BRAIN_EVENT_KINDS.has(v.kind)) return false;
  if (typeof v.at !== 'number') return false;
  return true;
}

const HQ_WORKTREE_EVENT_KINDS = new Set<string>([
  'allocated',
  'committed',
  'merged',
  'conflict',
  'released',
  'failed',
]);

function isHqWorktreeEventPayload(x: unknown): x is HqWorktreeEventPayload {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  if (typeof v.kind !== 'string' || !HQ_WORKTREE_EVENT_KINDS.has(v.kind)) return false;
  if (typeof v.handleId !== 'string' || typeof v.ownerId !== 'string') return false;
  return true;
}

function isHqToolStartedPayload(x: unknown): x is HqToolStartedPayload {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  return typeof v.toolName === 'string';
}

function isHqToolCompletedPayload(x: unknown): x is HqToolCompletedPayload {
  if (typeof x !== 'object' || x === null) return false;
  const v = x as Record<string, unknown>;
  return (
    typeof v.toolName === 'string' &&
    typeof v.status === 'string' &&
    typeof v.durationMs === 'number'
  );
}

function isHqUsagePayload(x: unknown): x is HqUsagePayload {
  if (typeof x !== 'object' || x === null) return false;
  // HqUsagePayload has all-optional numeric fields; accept any object so the
  // cost signal is never dropped on a partial payload, but require it be a
  // plain object (not array/null) to keep the downstream typed.
  return !Array.isArray(x);
}

function isHqClientHeartbeatPayload(x: unknown): x is HqClientHeartbeatPayload {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const v = x as Record<string, unknown>;
  return (
    typeof v.uptimeMs === 'number' &&
    (v.activeSessionId === undefined || typeof v.activeSessionId === 'string') &&
    (v.activeRunId === undefined || typeof v.activeRunId === 'string') &&
    typeof v.status === 'string' &&
    (v.status === 'active' ||
      v.status === 'idle' ||
      v.status === 'stale' ||
      v.status === 'error') &&
    (v.activeSubagents === undefined || typeof v.activeSubagents === 'number') &&
    (v.queuedTasks === undefined || typeof v.queuedTasks === 'number')
  );
}

/**
 * Validate the `payload` field of a {@link HqEventEnvelope} for known
 * event types. Returns `{ ok: true, payload }` with a narrowed payload
 * type when the event type has a registered shape guard and the payload
 * matches it; `{ ok: true, payload: unknown }` for event types that the
 * server does not yet validate; or `{ ok: false, reason }` when the
 * payload fails the registered guard.
 *
 * Use this after {@link parseHqFrame} has produced a valid frame, when
 * the frame is `client.event` and the server is about to consume the
 * event payload.
 */
export type HqEventPayloadResult<T> =
  | { ok: true; payload: T }
  | { ok: false; reason: 'unknown-event-type' | 'malformed-payload' };

export function parseHqEventPayload(
  eventType: string,
  payload: unknown,
): HqEventPayloadResult<unknown> {
  if (!KNOWN_HQ_EVENT_PAYLOAD_TYPES.has(eventType)) {
    // Server does not validate this event type yet — pass it through
    // untyped so the publish pipeline is not blocked. Future events
    // can opt-in by adding their type + guard here.
    return { ok: true, payload };
  }
  switch (eventType) {
    case 'mailbox.snapshot':
      return isHqMailboxSnapshotPayload(payload)
        ? { ok: true, payload }
        : { ok: false, reason: 'malformed-payload' };
    case 'mailbox.event':
      return isHqMailboxEventPayload(payload)
        ? { ok: true, payload }
        : { ok: false, reason: 'malformed-payload' };
    case 'session.snapshot':
      return isHqSessionSnapshotPayload(payload)
        ? { ok: true, payload }
        : { ok: false, reason: 'malformed-payload' };
    case 'session.transcript':
      return isHqTranscriptAppendPayload(payload)
        ? { ok: true, payload }
        : { ok: false, reason: 'malformed-payload' };
    case 'session.ended':
      return isHqSessionEndedPayload(payload)
        ? { ok: true, payload }
        : { ok: false, reason: 'malformed-payload' };
    case 'fleet.snapshot':
      return isHqFleetSnapshotPayload(payload)
        ? { ok: true, payload }
        : { ok: false, reason: 'malformed-payload' };
    case 'fleet.event':
      return isHqFleetEventPayload(payload)
        ? { ok: true, payload }
        : { ok: false, reason: 'malformed-payload' };
    case 'brain.event':
      return isHqBrainEventPayload(payload)
        ? { ok: true, payload }
        : { ok: false, reason: 'malformed-payload' };
    case 'worktree.event':
      return isHqWorktreeEventPayload(payload)
        ? { ok: true, payload }
        : { ok: false, reason: 'malformed-payload' };
    case 'tool.started':
      return isHqToolStartedPayload(payload)
        ? { ok: true, payload }
        : { ok: false, reason: 'malformed-payload' };
    case 'tool.completed':
      return isHqToolCompletedPayload(payload)
        ? { ok: true, payload }
        : { ok: false, reason: 'malformed-payload' };
    case 'session.usage':
      return isHqUsagePayload(payload)
        ? { ok: true, payload }
        : { ok: false, reason: 'malformed-payload' };
    case 'client.heartbeat':
      return isHqClientHeartbeatPayload(payload)
        ? { ok: true, payload }
        : { ok: false, reason: 'malformed-payload' };
    case 'mcp.health.snapshot':
      return isHqMcpHealthSnapshotPayload(payload)
        ? { ok: true, payload }
        : { ok: false, reason: 'malformed-payload' };
    case 'mcp.operation':
      return isHqMcpOperationPayload(payload)
        ? { ok: true, payload }
        : { ok: false, reason: 'malformed-payload' };
    default: {
      const _exhaustive: never = eventType as never;
      return _exhaustive;
    }
  }
}

export function createHqEventEnvelope<TPayload>(input: {
  id: string;
  type: HqEventType | (string & {});
  timestamp: string;
  clientId: string;
  projectId: string;
  seq: number;
  payload: TPayload;
  sessionId?: string;
  runId?: string;
}): HqEventEnvelope<TPayload> {
  return {
    id: input.id,
    type: input.type,
    schemaVersion: HQ_PROTOCOL_VERSION,
    timestamp: input.timestamp,
    clientId: input.clientId,
    projectId: input.projectId,
    seq: input.seq,
    payload: input.payload,
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
  };
}
