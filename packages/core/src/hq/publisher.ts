import { randomUUID } from 'node:crypto';
import type { Mailbox, MailboxAgentStatus, MailboxMessage } from '../coordination/mailbox-types.js';
import {
  createMailboxEventPayload,
  createMailboxSnapshotPayloadFromMailbox,
  type HqMailboxEventAction,
  type HqMailboxSnapshotOptions,
} from './mailbox-mapper.js';
import {
  createHqEventEnvelope,
  HQ_PROTOCOL_VERSION,
  type HqClientCapability,
  type HqClientCommandAckMessage,
  type HqClientCommandPollMessage,
  type HqClientEventMessage,
  type HqClientHelloMessage,
  type HqClientIdentity,
  type HqEventEnvelope,
  type HqEventType,
  type HqFleetSnapshotPayload,
  type HqMailboxEventPayload,
  type HqMailboxSnapshotPayload,
  type HqProjectIdentity,
  type HqQueuedCommand,
  type HqRedactionPolicy,
  type HqServerCommandBatchMessage,
  type HqSessionEndedPayload,
  type HqSessionSnapshotPayload,
  type HqTranscriptAppendPayload,
} from './protocol.js';

export interface HqSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener?(
    type: 'open' | 'close' | 'error' | 'message',
    listener: (event: unknown) => void,
  ): void;
  removeEventListener?(
    type: 'open' | 'close' | 'error' | 'message',
    listener: (event: unknown) => void,
  ): void;
  on?(type: 'open' | 'close' | 'error' | 'message', listener: (event: unknown) => void): void;
  off?(type: 'open' | 'close' | 'error' | 'message', listener: (event: unknown) => void): void;
}

export type HqSocketFactory = (url: string, init: { token?: string }) => HqSocketLike;

export interface HqPublisherCommandResult {
  commandId: string;
  status: 'accepted' | 'completed' | 'failed' | 'rejected';
  message?: string;
}

export type HqPublisherCommandHandler = (
  command: HqQueuedCommand,
) => void | HqPublisherCommandResult | Promise<void | HqPublisherCommandResult>;

export interface HqPublisherOptions {
  url: string;
  token?: string;
  client: HqClientIdentity;
  project: HqProjectIdentity;
  capabilities?: readonly HqClientCapability[];
  socketFactory?: HqSocketFactory;
  now?: () => string;
  idFactory?: () => string;
  reconnect?: boolean;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  maxQueuedMessages?: number;
  redactionPolicy?: Partial<HqRedactionPolicy>;
  commandPollIntervalMs?: number;
  commandPollLimit?: number;
  onCommand?: HqPublisherCommandHandler;
  /**
   * Local auto-discovery hook: re-resolve the HQ endpoint before EVERY
   * connect attempt (e.g. by reading `<hq dataDir>/runtime.json`). Returning
   * `undefined` means no HQ is currently discoverable — the publisher stays
   * dormant (events keep queueing, bounded) and re-checks every
   * {@link HqPublisherOptions.discoveryPollMs}. Because the endpoint is
   * re-resolved per attempt, an HQ started AFTER this client — or restarted
   * on a different port, or one that minted its first client token on boot —
   * is picked up automatically.
   */
  resolveEndpoint?: () => { url: string; token?: string | undefined } | undefined;
  /** Dormant re-check interval while `resolveEndpoint` yields nothing. Default 5s. */
  discoveryPollMs?: number;
  /**
   * Diagnostic sink for the one-time consecutive-connect-failure warning.
   * The publisher is otherwise deliberately silent (dormant queueing), which
   * made auth failures invisible: a token the server rejects — e.g. a wrong
   * `WRONGSTACK_HQ_TOKEN` against a remote HQ — looked exactly like "HQ not
   * running". Defaults to a single structured `console.warn` line.
   */
  warn?: (message: string) => void;
}

export interface HqPublishEventOptions {
  type: HqEventType | (string & {});
  payload: unknown;
  sessionId?: string;
  runId?: string;
  timestamp?: string;
}

const OPEN_STATE = 1;
/**
 * After this many consecutive failed connects (never reaching `open`), emit
 * ONE diagnostic warning. The WS handshake gives the browser-style socket no
 * HTTP status, so a 401 (token mismatch) is indistinguishable from a dead
 * server at this layer — the warning names both possibilities.
 */
const CONNECT_WARN_AFTER_FAILURES = 5;
const DEFAULT_RECONNECT_BASE_MS = 1_000;
const DEFAULT_RECONNECT_MAX_MS = 30_000;
const DEFAULT_DISCOVERY_POLL_MS = 5_000;
const DEFAULT_MAX_QUEUED_MESSAGES = 2000;
const DEFAULT_COMMAND_POLL_INTERVAL_MS = 2_000;
const DEFAULT_COMMAND_POLL_LIMIT = 25;

function defaultSocketFactory(url: string): HqSocketLike {
  const WebSocketCtor = globalThis.WebSocket;
  if (WebSocketCtor === undefined) {
    throw new Error(
      'No global WebSocket implementation is available; provide HqPublisherOptions.socketFactory.',
    );
  }
  return new WebSocketCtor(url) as HqSocketLike;
}

function toClientUrl(baseUrl: string, token: string | undefined): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (url.pathname === '/' || url.pathname === '') url.pathname = '/ws/client';
  if (token !== undefined && token.length > 0) url.searchParams.set('token', token);
  return url.toString();
}

function addSocketListener(
  socket: HqSocketLike,
  type: 'open' | 'close' | 'error' | 'message',
  listener: (event: unknown) => void,
): void {
  if (socket.addEventListener !== undefined) {
    socket.addEventListener(type, listener);
    return;
  }
  socket.on?.(type, listener);
}

function removeSocketListener(
  socket: HqSocketLike,
  type: 'open' | 'close' | 'error' | 'message',
  listener: (event: unknown) => void,
): void {
  if (socket.removeEventListener !== undefined) {
    socket.removeEventListener(type, listener);
    return;
  }
  socket.off?.(type, listener);
}

export class HqPublisher {
  private readonly socketFactory: HqSocketFactory;
  private readonly now: () => string;
  private readonly idFactory: () => string;
  private readonly capabilities: readonly HqClientCapability[];
  private readonly reconnect: boolean;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly maxQueuedMessages: number;
  private socket: HqSocketLike | null = null;
  private seq = 0;
  private queue: string[] = [];
  private stopped = false;
  private reconnectAttempt = 0;
  private connectWarningEmitted = false;
  private lastAttempt: { url: string; hadToken: boolean } | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private commandPollTimer: ReturnType<typeof setInterval> | null = null;
  private lastCommandId: string | undefined;

  constructor(private readonly options: HqPublisherOptions) {
    this.socketFactory = options.socketFactory ?? defaultSocketFactory;
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? randomUUID;
    this.capabilities = options.capabilities ?? [
      'telemetry.publish',
      'mailbox.summary',
      'fleet.summary',
      'session.summary',
    ];
    this.reconnect = options.reconnect ?? true;
    this.reconnectBaseMs = options.reconnectBaseMs ?? DEFAULT_RECONNECT_BASE_MS;
    this.reconnectMaxMs = options.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS;
    this.maxQueuedMessages = options.maxQueuedMessages ?? DEFAULT_MAX_QUEUED_MESSAGES;
  }

  connect(): void {
    if (this.socket !== null || this.stopped) return;
    // A retry / discovery poll is already scheduled — let it fire instead of
    // dialing (and re-resolving the endpoint) on every publish while offline.
    if (this.reconnectTimer !== null) return;

    let url = this.options.url;
    let token = this.options.token;
    if (this.options.resolveEndpoint !== undefined) {
      const endpoint = this.options.resolveEndpoint();
      if (endpoint === undefined) {
        this.scheduleDiscoveryPoll();
        return;
      }
      url = endpoint.url;
      token = endpoint.token ?? token;
    }
    this.lastAttempt = { url, hadToken: token !== undefined };

    let socket: HqSocketLike;
    try {
      socket = this.socketFactory(toClientUrl(url, token), {
        ...(token !== undefined ? { token } : {}),
      });
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    const onOpen = () => {
      this.reconnectAttempt = 0;
      this.sendHelloNow();
      this.flushQueue();
      if (this.options.onCommand !== undefined) {
        this.startCommandPolling();
        this.pollCommands();
      }
    };
    const onMessage = (event: unknown) => {
      void this.handleServerMessage(event);
    };
    const onCloseOrError = () => {
      removeSocketListener(socket, 'open', onOpen);
      removeSocketListener(socket, 'message', onMessage);
      removeSocketListener(socket, 'close', onCloseOrError);
      removeSocketListener(socket, 'error', onCloseOrError);
      this.stopCommandPolling();
      if (this.socket === socket) this.socket = null;
      this.scheduleReconnect();
    };

    addSocketListener(socket, 'open', onOpen);
    addSocketListener(socket, 'message', onMessage);
    addSocketListener(socket, 'close', onCloseOrError);
    addSocketListener(socket, 'error', onCloseOrError);

    if (socket.readyState === OPEN_STATE) onOpen();
  }

  close(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopCommandPolling();
    this.queue = [];
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, 'hq publisher closed');
  }

  publishEvent<TPayload>(
    options: HqPublishEventOptions & { payload: TPayload },
  ): HqEventEnvelope<TPayload> {
    const event = createHqEventEnvelope({
      id: this.idFactory(),
      type: options.type,
      timestamp: options.timestamp ?? this.now(),
      clientId: this.options.client.clientId,
      projectId: this.options.project.projectId,
      seq: ++this.seq,
      payload: options.payload,
      ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
      ...(options.runId !== undefined ? { runId: options.runId } : {}),
    });
    this.sendFrame({ type: 'client.event', event });
    return event;
  }

  async publishMailboxSnapshot(
    mailbox: Pick<Mailbox, 'query' | 'getAgentStatuses'>,
    options: Omit<HqMailboxSnapshotOptions, 'redactionPolicy'> & {
      sessionId?: string;
      timestamp?: string;
    },
  ): Promise<HqEventEnvelope<HqMailboxSnapshotPayload>> {
    const payload = await createMailboxSnapshotPayloadFromMailbox(mailbox, {
      ...options,
      ...(this.options.redactionPolicy !== undefined
        ? { redactionPolicy: this.options.redactionPolicy }
        : {}),
    });
    return this.publishEvent({
      type: 'mailbox.snapshot',
      payload,
      ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
      ...(options.timestamp !== undefined ? { timestamp: options.timestamp } : {}),
    });
  }

  publishMailboxEvent(input: {
    mailboxId: string;
    action: HqMailboxEventAction;
    message?: MailboxMessage;
    agent?: MailboxAgentStatus;
    summary?: string;
    previewLength?: number;
    sessionId?: string;
    timestamp?: string;
  }): HqEventEnvelope<HqMailboxEventPayload> {
    const payload = createMailboxEventPayload({
      mailboxId: input.mailboxId,
      action: input.action,
      ...(input.message !== undefined ? { message: input.message } : {}),
      ...(input.agent !== undefined ? { agent: input.agent } : {}),
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      ...(input.previewLength !== undefined ? { previewLength: input.previewLength } : {}),
      ...(this.options.redactionPolicy !== undefined
        ? { redactionPolicy: this.options.redactionPolicy }
        : {}),
    });
    return this.publishEvent({
      type: 'mailbox.event',
      payload,
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.timestamp !== undefined ? { timestamp: input.timestamp } : {}),
    });
  }

  /** The client identity this publisher announced (clientId, kind, machineId, …). */
  get identity(): HqClientIdentity {
    return this.options.client;
  }

  /** The project identity this publisher is bound to. */
  get project(): HqProjectIdentity {
    return this.options.project;
  }

  /** Publish a live session/terminal snapshot (state + agents). */
  publishSessionSnapshot(
    payload: HqSessionSnapshotPayload,
    opts?: { timestamp?: string },
  ): HqEventEnvelope<HqSessionSnapshotPayload> {
    return this.publishEvent({
      type: 'session.snapshot',
      payload,
      sessionId: payload.sessionId,
      ...(opts?.timestamp !== undefined ? { timestamp: opts.timestamp } : {}),
    });
  }

  /** Publish an incremental batch of transcript turns for a session. */
  publishTranscriptAppend(
    payload: HqTranscriptAppendPayload,
    opts?: { timestamp?: string },
  ): HqEventEnvelope<HqTranscriptAppendPayload> {
    return this.publishEvent({
      type: 'session.transcript',
      payload,
      sessionId: payload.sessionId,
      ...(opts?.timestamp !== undefined ? { timestamp: opts.timestamp } : {}),
    });
  }

  /** Mark a session/terminal as ended. */
  publishSessionEnded(
    payload: HqSessionEndedPayload,
    opts?: { timestamp?: string },
  ): HqEventEnvelope<HqSessionEndedPayload> {
    return this.publishEvent({
      type: 'session.ended',
      payload,
      sessionId: payload.sessionId,
      ...(opts?.timestamp !== undefined ? { timestamp: opts.timestamp } : {}),
    });
  }

  /** Publish a fleet (multi-agent coordinator) snapshot. */
  publishFleetSnapshot(
    payload: HqFleetSnapshotPayload,
    opts?: { sessionId?: string; timestamp?: string },
  ): HqEventEnvelope<HqFleetSnapshotPayload> {
    return this.publishEvent({
      type: 'fleet.snapshot',
      payload,
      runId: payload.runId,
      ...(opts?.sessionId !== undefined ? { sessionId: opts.sessionId } : {}),
      ...(opts?.timestamp !== undefined ? { timestamp: opts.timestamp } : {}),
    });
  }

  pollCommands(): void {
    this.sendFrame({
      type: 'client.command_poll',
      clientId: this.options.client.clientId,
      projectId: this.options.project.projectId,
      ...(this.lastCommandId !== undefined ? { afterCommandId: this.lastCommandId } : {}),
      limit: this.options.commandPollLimit ?? DEFAULT_COMMAND_POLL_LIMIT,
    });
  }

  ackCommand(result: HqPublisherCommandResult): void {
    this.sendFrame({
      type: 'client.command_ack',
      clientId: this.options.client.clientId,
      projectId: this.options.project.projectId,
      commandId: result.commandId,
      status: result.status,
      ...(result.message !== undefined ? { message: result.message } : {}),
    });
  }

  private createHelloFrame(): HqClientHelloMessage {
    return {
      type: 'client.hello',
      payload: {
        protocolVersion: HQ_PROTOCOL_VERSION,
        client: this.options.client,
        project: this.options.project,
        capabilities: this.capabilities,
      },
    };
  }

  private sendHelloNow(): void {
    const socket = this.socket;
    if (socket?.readyState !== OPEN_STATE) {
      this.sendFrame(this.createHelloFrame());
      return;
    }
    socket.send(JSON.stringify(this.createHelloFrame()));
  }

  private sendFrame(
    frame:
      | HqClientHelloMessage
      | HqClientEventMessage
      | HqClientCommandPollMessage
      | HqClientCommandAckMessage,
  ): void {
    const serialized = JSON.stringify(frame);
    const socket = this.socket;
    // Fast path: socket is open and nothing queued — send immediately.
    if (socket?.readyState === OPEN_STATE && this.queue.length === 0) {
      socket.send(serialized);
      return;
    }
    // Slow path: socket offline or queue already has pending frames — enqueue.
    this.enqueue(serialized);
    this.connect();
  }

  private enqueue(serialized: string): void {
    if (this.queue.length >= this.maxQueuedMessages) this.queue.shift();
    this.queue.push(serialized);
  }

  /** Batch-dequeue up to 50 frames at a time, yielding to the microtask
   *  queue between batches so we don't starve the event loop on reconnect. */
  private flushQueue(): void {
    const socket = this.socket;
    if (socket?.readyState !== OPEN_STATE || this.queue.length === 0) return;
    const batch = this.queue.splice(0, 50);
    for (const frame of batch) socket.send(frame);
    if (this.queue.length > 0) setImmediate(() => this.flushQueue());
  }

  private startCommandPolling(): void {
    if (this.options.onCommand === undefined || this.commandPollTimer !== null) return;
    this.commandPollTimer = setInterval(
      () => this.pollCommands(),
      this.options.commandPollIntervalMs ?? DEFAULT_COMMAND_POLL_INTERVAL_MS,
    );
    this.commandPollTimer.unref?.();
  }

  private stopCommandPolling(): void {
    if (this.commandPollTimer === null) return;
    clearInterval(this.commandPollTimer);
    this.commandPollTimer = null;
  }

  private async handleServerMessage(event: unknown): Promise<void> {
    const message = this.parseServerMessage(event);
    if (message?.type !== 'hq.command_batch') return;
    await this.handleCommandBatch(message);
  }

  private parseServerMessage(event: unknown): HqServerCommandBatchMessage | null {
    const data = this.extractMessageData(event);
    if (data === null) return null;
    try {
      const parsed = JSON.parse(data) as Partial<HqServerCommandBatchMessage>;
      if (parsed.type !== 'hq.command_batch' || !Array.isArray(parsed.commands)) return null;
      return parsed as HqServerCommandBatchMessage;
    } catch {
      return null;
    }
  }

  private extractMessageData(event: unknown): string | null {
    const value =
      typeof event === 'object' && event !== null && 'data' in event
        ? (event as { data?: unknown }).data
        : event;
    if (typeof value === 'string') return value;
    if (value instanceof ArrayBuffer) return new TextDecoder().decode(value);
    if (ArrayBuffer.isView(value)) {
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      return new TextDecoder().decode(bytes);
    }
    return null;
  }

  private async handleCommandBatch(message: HqServerCommandBatchMessage): Promise<void> {
    const handler = this.options.onCommand;
    if (handler === undefined) return;

    for (const command of message.commands) {
      this.lastCommandId = command.commandId;
      try {
        const result = await handler(command);
        if (result !== undefined) this.ackCommand(result);
        else if (command.requiresAck)
          this.ackCommand({ commandId: command.commandId, status: 'accepted' });
      } catch (err) {
        this.ackCommand({
          commandId: command.commandId,
          status: 'failed',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || !this.reconnect || this.reconnectTimer !== null) return;
    const delay = Math.min(this.reconnectMaxMs, this.reconnectBaseMs * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    // One-time visibility for persistent failures. `reconnectAttempt` resets
    // on every successful open, so reaching the threshold means the endpoint
    // has NEVER accepted us in this streak — dead server or rejected token.
    if (!this.connectWarningEmitted && this.reconnectAttempt >= CONNECT_WARN_AFTER_FAILURES) {
      this.connectWarningEmitted = true;
      this.emitConnectWarning();
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private emitConnectWarning(): void {
    const attempt = this.lastAttempt;
    const message =
      `WrongStack HQ publisher: ${this.reconnectAttempt} consecutive connection failures` +
      `${attempt !== null ? ` to ${attempt.url} (client token ${attempt.hadToken ? 'present' : 'absent'})` : ''}. ` +
      'Either the HQ server is unreachable or it rejected the token (401). ' +
      'If HQ runs in client-token mode, verify WRONGSTACK_HQ_TOKEN / auth.json. Retries continue with backoff.';
    const warn =
      this.options.warn ??
      ((msg: string) =>
        console.warn(
          JSON.stringify({
            level: 'warn',
            event: 'hq.publisher.connect_failed',
            message: msg,
            timestamp: this.now(),
          }),
        ));
    try {
      warn(message);
    } catch {
      /* diagnostics must never break publishing */
    }
  }

  /**
   * Dormant re-check while no HQ endpoint is discoverable. Uses a FIXED
   * interval (not the exponential reconnect backoff): the check is a cheap
   * local file read, and backing off would delay attaching to an HQ the
   * user just started — the whole point of auto-discovery.
   */
  private scheduleDiscoveryPoll(): void {
    if (this.stopped || !this.reconnect || this.reconnectTimer !== null) return;
    this.reconnectAttempt = 0;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.options.discoveryPollMs ?? DEFAULT_DISCOVERY_POLL_MS);
    this.reconnectTimer.unref?.();
  }
}
