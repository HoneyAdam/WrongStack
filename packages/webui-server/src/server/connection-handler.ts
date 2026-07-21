import type { Context, Message, TokenCounter, Usage } from '@wrongstack/core';
import type { WebSocket } from 'ws';
import { decodeProtocolFrame, protocolAdvertisement } from '../protocol/index.js';
import type { CollaborationWebSocketHandler } from './collaboration-ws-handler.js';
import { createConnectionLifecycle } from './connection-lifecycle.js';
import type { GoalWebSocketHandler } from './goal-ws-handler.js';
import type { PendingConfirm } from './pending-confirms.js';
import type { SddBoardWebSocketHandler } from './sdd-board-ws-handler.js';
import type { SddWizardWebSocketHandler } from './sdd-wizard-ws-handler.js';
import type { SpecsWebSocketHandler } from './specs-ws-handler.js';
import type { TerminalWebSocketHandler } from './terminal-ws-handler.js';
import type { ConnectedClient, WSClientMessage } from './types.js';
import type { WorktreeWebSocketHandler } from './worktree-ws-handler.js';
import { send } from './ws-utils.js';

export interface ConnectionHandlerOptions {
  getSessionId(): string;
  sessionStartPayload(): Promise<Record<string, unknown>>;
  tokenCounter: TokenCounter;
  context: Context;
  loadReplay?:
    | (() => Promise<{ messages: Message[]; usage?: Usage | undefined } | null>)
    | undefined;
  clients: Map<WebSocket, ConnectedClient>;
  pendingConfirms: Map<string, PendingConfirm>;
  goalHandler: GoalWebSocketHandler;
  specsHandler: SpecsWebSocketHandler;
  sddBoardHandler: SddBoardWebSocketHandler;
  sddWizardHandler: SddWizardWebSocketHandler;
  worktreeHandler: WorktreeWebSocketHandler;
  collabHandler: CollaborationWebSocketHandler;
  terminalHandler: TerminalWebSocketHandler;
  handleMessage: (ws: WebSocket, client: ConnectedClient, msg: WSClientMessage) => Promise<void>;
}

const REPLAY_MESSAGE_CAP = 2_000;
const RATE_LIMIT_MESSAGES = Number.parseInt(process.env['WEBUI_RATE_LIMIT'] ?? '0', 10);

export function createConnectionHandler(
  options: ConnectionHandlerOptions,
): (ws: WebSocket) => void {
  const handlers = [
    options.goalHandler,
    options.specsHandler,
    options.sddBoardHandler,
    options.sddWizardHandler,
    options.worktreeHandler,
    options.collabHandler,
    options.terminalHandler,
  ];
  const lifecycle = createConnectionLifecycle<ConnectedClient, undefined, WSClientMessage>({
    clients: options.clients,
    pendingConfirms: options.pendingConfirms,
    createClient: (ws, connectionId) => ({
      ws,
      sessionId: options.getSessionId(),
      connectedAt: Date.now(),
      connId: connectionId,
    }),
    registerClient: (ws) => {
      for (const handler of handlers) handler.addClient(ws);
    },
    decode: (raw) => decodeProtocolFrame(raw, 'client') as never,
    dispatch: options.handleMessage,
    send,
    sessionPayload: (payload) => {
      const provided = payload['sessionId'];
      const sessionId =
        typeof provided === 'string' && provided.length > 0 ? provided : options.getSessionId();
      return { ...payload, sessionId };
    },
    rateLimitMax: RATE_LIMIT_MESSAGES,
    rateLimitMessage: 'Too many messages. Please wait before sending more.',
    buildInitialPayload: async () => {
      const payload = { ...(await options.sessionStartPayload()) };
      const advertisement = protocolAdvertisement();
      const priorCapabilities = Array.isArray(payload['protocolCapabilities'])
        ? payload['protocolCapabilities'].filter((item): item is string => typeof item === 'string')
        : [];
      payload['protocolVersion'] = advertisement.protocolVersion;
      payload['protocolCapabilities'] = [
        ...new Set([...priorCapabilities, ...advertisement.protocolCapabilities]),
      ];
      if (
        typeof options.context.lastRequestTokens === 'number' &&
        options.context.lastRequestTokens > 0
      ) {
        payload['lastInputTokens'] = options.context.lastRequestTokens;
      }
      try {
        const replay = await options.loadReplay?.();
        const messages = replay?.messages ?? options.context.messages ?? [];
        if (messages.length) {
          payload['replayMessages'] =
            messages.length > REPLAY_MESSAGE_CAP ? messages.slice(-REPLAY_MESSAGE_CAP) : messages;
        }
        const usage = replay?.usage ?? options.tokenCounter.total();
        if (usage.input + usage.output + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0) > 0) {
          payload['replayUsage'] = {
            input: usage.input,
            output: usage.output,
            cacheRead: usage.cacheRead ?? 0,
            cacheWrite: usage.cacheWrite ?? 0,
          };
        }
      } catch {
        // Replay is best-effort; the client may still hydrate local state.
      }
      return payload;
    },
  });
  return (ws) => {
    void lifecycle(ws, undefined);
  };
}
