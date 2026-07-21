import type { WebSocket } from 'ws';
import type { PendingConfirm } from './pending-confirms.js';
import { resolveAllPendingConfirms } from './pending-confirms.js';

type OutboundMessage = { type: string; payload: unknown };
type ProtocolIssue = { code: string; message: string };
type DecodeResult<Message> = { ok: true; message: Message } | { ok: false; issue: ProtocolIssue };

export interface ConnectionLifecycleOptions<Client, Request, Message> {
  clients: Map<WebSocket, Client>;
  pendingConfirms: Map<string, PendingConfirm>;
  authenticate?: (ws: WebSocket, request: Request) => boolean | Promise<boolean>;
  createClient: (ws: WebSocket, connectionId: string) => Client;
  registerClient: (ws: WebSocket) => void;
  unregisterClient?: (ws: WebSocket) => void;
  onClose?: (ws: WebSocket, client: Client | undefined) => void;
  decode: (raw: string) => DecodeResult<Message>;
  dispatch: (ws: WebSocket, client: Client, message: Message) => Promise<void>;
  send: (ws: WebSocket, message: OutboundMessage) => void;
  sessionPayload: (payload: Record<string, unknown>) => Record<string, unknown>;
  buildInitialPayload: () => Promise<Record<string, unknown>>;
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
  confirmDrainGraceMs?: number;
  rateLimitMessage?: string;
  log?: (level: 'warn' | 'error', event: string, error: unknown) => void;
}

/**
 * Canonical WebSocket lifecycle: protection, auth, registration, protocol
 * decode, rate limiting, initial replay, and disconnect cleanup.
 */
export function createConnectionLifecycle<Client, Request, Message>(
  options: ConnectionLifecycleOptions<Client, Request, Message>,
): (ws: WebSocket, request: Request) => Promise<void> {
  const rateLimitMax = options.rateLimitMax ?? 0;
  const rateLimitWindowMs = options.rateLimitWindowMs ?? 60_000;
  const confirmDrainGraceMs = options.confirmDrainGraceMs ?? 30_000;
  let connectionSequence = 0;
  let confirmDrainTimer: ReturnType<typeof setTimeout> | null = null;

  const log = (level: 'warn' | 'error', event: string, error: unknown): void => {
    if (options.log) {
      options.log(level, event, error);
      return;
    }
    const output = JSON.stringify({
      level,
      event,
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
    if (level === 'warn') console.warn(output);
    else console.error(output);
  };

  return async (ws, request) => {
    ws.on('error', (error) => log('warn', 'webui_server.client_socket_error', error));
    if (options.authenticate && !(await options.authenticate(ws, request))) return;

    const client = options.createClient(ws, `c${++connectionSequence}`);
    options.clients.set(ws, client);
    options.registerClient(ws);

    if (confirmDrainTimer) {
      clearTimeout(confirmDrainTimer);
      confirmDrainTimer = null;
    }
    for (const confirm of options.pendingConfirms.values()) {
      if (confirm.payload) {
        options.send(ws, { type: 'tool.confirm_needed', payload: confirm.payload });
      }
    }

    let messageCount = 0;
    let rateWindowResetAt = Date.now() + rateLimitWindowMs;
    ws.on('message', async (data) => {
      if (rateLimitMax > 0) {
        const now = Date.now();
        if (now > rateWindowResetAt) {
          messageCount = 0;
          rateWindowResetAt = now + rateLimitWindowMs;
        }
        if (++messageCount > rateLimitMax) {
          options.send(ws, {
            type: 'error',
            payload: options.sessionPayload({
              phase: 'rate_limit',
              message: options.rateLimitMessage ?? 'Too many messages. Please wait.',
            }),
          });
          return;
        }
      }

      const decoded = options.decode(data.toString());
      if (!decoded.ok) {
        log(
          'error',
          decoded.issue.message === 'Protocol frame is not valid JSON'
            ? 'webui_server.message_parse_failed'
            : 'webui_server.message_rejected',
          decoded.issue.message,
        );
        options.send(ws, {
          type: 'error',
          payload: options.sessionPayload({
            phase: 'parse',
            code: decoded.issue.code,
            message: decoded.issue.message,
          }),
        });
        return;
      }
      try {
        await options.dispatch(ws, client, decoded.message);
      } catch (error) {
        log('error', 'webui_server.message_handler_failed', error);
      }
    });

    ws.on('close', () => {
      const closing = options.clients.get(ws);
      options.clients.delete(ws);
      options.unregisterClient?.(ws);
      options.onClose?.(ws, closing);
      if (options.clients.size === 0 && options.pendingConfirms.size > 0 && !confirmDrainTimer) {
        confirmDrainTimer = setTimeout(() => {
          confirmDrainTimer = null;
          if (options.clients.size === 0) {
            resolveAllPendingConfirms(options.pendingConfirms, 'no');
          }
        }, confirmDrainGraceMs);
        confirmDrainTimer.unref?.();
      }
    });

    try {
      options.send(ws, { type: 'session.start', payload: await options.buildInitialPayload() });
    } catch (error) {
      log('warn', 'webui.session_start_payload_failed', error);
    }
  };
}
