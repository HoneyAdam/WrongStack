import type { WSServerMessage, WSClientMessage } from '../types';

type EventHandler = (msg: WSServerMessage) => void;

interface PendingConfirm {
  resolve: (decision: 'yes' | 'no' | 'always' | 'deny') => void;
}

export class WrongStackWebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private shouldReconnect = true;
  private messageQueue: WSClientMessage[] = [];
  private pendingConfirms: Map<string, PendingConfirm> = new Map();
  private sessionId: string | null = null;

  constructor(url?: string) {
    this.url = url ?? defaultWsUrl();
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      try {
        this.ws = new WebSocket(this.url);
        this.ws.binaryType = 'arraybuffer';

        const connectTimeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 10000);

        this.ws.onopen = () => {
          clearTimeout(connectTimeout);
          console.log('[WS Client] Connected');
          this.reconnectAttempts = 0;
          this.flushMessageQueue();
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data) as WSServerMessage;
            this.handleMessage(msg);
          } catch (err) {
            console.error('[WS Client] Failed to parse message', err);
          }
        };

        this.ws.onerror = (error) => {
          console.error('[WS Client] Error', error);
        };

        this.ws.onclose = () => {
          console.log('[WS Client] Disconnected');
          this.attemptReconnect();
        };
      } catch (err) {
        clearTimeout((globalThis as Record<string, unknown>).connectTimeout as number);
        reject(err);
      }
    });
  }

  private attemptReconnect() {
    if (!this.shouldReconnect || this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[WS Client] Not reconnecting');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * 2 ** (this.reconnectAttempts - 1), 30000);
    console.log(`[WS Client] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(async () => {
      if (this.shouldReconnect) {
        try {
          await this.connect();
        } catch (err) {
          console.error('[WS Client] Reconnect failed', err);
        }
      }
    }, delay);
  }

  private flushMessageQueue() {
    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift();
      if (msg) this.send(msg);
    }
  }

  private handleMessage(msg: WSServerMessage) {
    if (msg.type === 'tool.confirm_needed') {
      const payload = msg.payload as unknown as {
        id: string;
        toolName: string;
        input: unknown;
        suggestedPattern: string;
        resolve: (d: 'yes' | 'no' | 'always' | 'deny') => void;
      };
      
      this.pendingConfirms.set(payload.id, {
        resolve: payload.resolve,
      });

      const msgForHandler = {
        ...msg,
        payload: {
          ...payload,
          resolve: () => {},
        },
      };

      this.emit(msgForHandler as WSServerMessage);
      return;
    }

    if (msg.type === 'session.start') {
      const payload = msg.payload as { sessionId: string };
      this.sessionId = payload.sessionId;
    }

    this.emit(msg);
  }

  private emit(msg: WSServerMessage) {
    const handlers = this.handlers.get(msg.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(msg);
        } catch (err) {
          console.error(`[WS Client] Handler error for ${msg.type}`, err);
        }
      }
    }
  }

  send(message: WSClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      this.messageQueue.push(message);
    }
  }

  on(eventType: string, handler: EventHandler): () => void {
    let handlers = this.handlers.get(eventType);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(eventType, handlers);
    }
    handlers.add(handler);
    return () => handlers?.delete(handler);
  }

  off(eventType: string, handler: EventHandler) {
    this.handlers.get(eventType)?.delete(handler);
  }

  sendMessage(content: string): string {
    const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this.send({
      type: 'user_message',
      payload: {
        id,
        content,
        timestamp: Date.now(),
      },
    });
    return id;
  }

  sendAbort() {
    this.send({
      type: 'abort',
      payload: {},
    } as unknown as WSClientMessage);
  }

  sendConfirm(id: string, decision: 'yes' | 'no' | 'always' | 'deny') {
    const pending = this.pendingConfirms.get(id);
    if (pending) {
      pending.resolve(decision);
      this.pendingConfirms.delete(id);
    }
    this.send({
      type: 'tool.confirm_result',
      payload: { id, decision },
    });
  }

  switchModel(provider: string, model: string) {
    this.send({
      type: 'model.switch',
      payload: { provider, model },
    });
  }

  // ---- Provider/Model/Key management (mirrors TUI/CLI auth-menu) ----

  listProviders() {
    this.send({ type: 'providers.list' });
  }

  listProviderModels(providerId: string) {
    this.send({ type: 'provider.models', payload: { providerId } });
  }

  listSavedProviders() {
    this.send({ type: 'providers.saved' });
  }

  addKey(providerId: string, label: string, apiKey: string) {
    this.send({ type: 'key.add', payload: { providerId, label, apiKey } });
  }

  updateKey(providerId: string, label: string, apiKey: string) {
    this.send({ type: 'key.update', payload: { providerId, label, apiKey } });
  }

  deleteKey(providerId: string, label: string) {
    this.send({ type: 'key.delete', payload: { providerId, label } });
  }

  setActiveKey(providerId: string, label: string) {
    this.send({ type: 'key.set_active', payload: { providerId, label } });
  }

  addProvider(id: string, family: string, baseUrl?: string, apiKey?: string) {
    this.send({ type: 'provider.add', payload: { id, family, baseUrl, apiKey } });
  }

  removeProvider(providerId: string) {
    this.send({ type: 'provider.remove', payload: { providerId } });
  }

  newSession() {
    this.send({ type: 'session.new' });
  }

  clearContext() {
    this.send({ type: 'context.clear' });
  }

  compactContext(aggressive = false) {
    this.send({ type: 'context.compact', payload: { aggressive } });
  }

  debugContext() {
    this.send({ type: 'context.debug' });
  }

  // ---- Inspect commands (mirror TUI/CLI's /tools /memory /skill /diag /stats) ----

  listTools() {
    this.send({ type: 'tools.list' });
  }

  listMemory() {
    this.send({ type: 'memory.list' });
  }

  remember(text: string, scope?: 'project-agents' | 'project-memory' | 'user-memory') {
    this.send({ type: 'memory.remember', payload: { text, scope } });
  }

  forget(text: string, scope?: 'project-agents' | 'project-memory' | 'user-memory') {
    this.send({ type: 'memory.forget', payload: { text, scope } });
  }

  listSkills() {
    this.send({ type: 'skills.list' });
  }

  getDiag() {
    this.send({ type: 'diag.get' });
  }

  getStats() {
    this.send({ type: 'stats.get' });
  }

  saveSession() {
    this.send({ type: 'session.save' });
  }

  resumeSessionById(id: string) {
    this.send({ type: 'session.resume', payload: { id } });
  }

  listModes() {
    this.send({ type: 'modes.list' });
  }

  switchMode(id: string) {
    this.send({ type: 'mode.switch', payload: { id } });
  }

  listSessions(limit = 50) {
    this.send({ type: 'sessions.list', payload: { limit } });
  }

  deleteSession(id: string) {
    this.send({ type: 'session.delete', payload: { id } });
  }

  resumeSession(sessionId: string) {
    this.send({
      type: 'session.resume',
      payload: { id: sessionId },
    });
  }

  ping() {
    this.send({ type: 'ping' });
  }

  disconnect() {
    this.shouldReconnect = false;
    this.ws?.close();
    this.ws = null;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get currentSessionId(): string | null {
    return this.sessionId;
  }
}

let client: WrongStackWebSocketClient | null = null;

/**
 * Default WS URL derived from the page's host.
 *
 * Subtle gotcha on Windows: when the page is loaded from `http://localhost:3456`,
 * the browser resolves `localhost` *itself* and on Windows it tries IPv6 `[::1]`
 * before IPv4 `127.0.0.1`. If the backend listens only on `127.0.0.1`, every
 * connection attempt to `ws://localhost:3457` first hits the IPv6 socket
 * (refused) and then either gives up or flaps — symptom: "ws disconnect hep".
 *
 * Fix: when the page is on a loopback host (`localhost` / `127.0.0.1` / `::1`),
 * force the WS URL to use the literal IPv4 loopback address. That bypasses the
 * DNS dance entirely. For any other hostname (LAN IP, custom WS_HOST override)
 * we keep the page's hostname so things still "just work".
 */
function defaultWsUrl(): string {
  const port = 3457;
  if (typeof window === 'undefined' || !window.location?.hostname) {
    return `ws://127.0.0.1:${port}`;
  }
  const host = window.location.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') {
    return `ws://127.0.0.1:${port}`;
  }
  return `ws://${window.location.hostname}:${port}`;
}

export function getWSClient(url?: string): WrongStackWebSocketClient {
  if (!client) {
    client = new WrongStackWebSocketClient(url);
  }
  return client;
}
