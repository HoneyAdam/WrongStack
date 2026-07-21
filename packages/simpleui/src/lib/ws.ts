import type { ServerMessage } from '../types.js';

function pageToken(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('token');
  } catch {
    return null;
  }
}

function configuredWsUrl(): string | null {
  const raw = document
    .querySelector('meta[name="wrongstack-ws-url"]')
    ?.getAttribute('content')
    ?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return null;
    const token = pageToken();
    if (token && !url.searchParams.has('token')) url.searchParams.set('token', token);
    return url.toString();
  } catch {
    return null;
  }
}

export function defaultWsUrl(): URL {
  const configured = configuredWsUrl();
  if (configured) return new URL(configured);
  // Shared-port design: WS shares the HTTP port, so derive the WS URL
  // from the exact page origin. Preserving `location.host` matters: changing
  // localhost to 127.0.0.1 makes the socket cross-origin, so `connect-src
  // 'self'` blocks it and the host-scoped auth cookie is not sent.
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = new URL(`${protocol}//${window.location.host}`);
  const token = pageToken();
  if (token) url.searchParams.set('token', token);
  return url;
}

function scrubPageToken(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('token')) return;
    url.searchParams.delete('token');
    window.history.replaceState(window.history.state, document.title, url.toString());
  } catch {
    // Best-effort URL hygiene only.
  }
}

async function exchangeAuthCookie(url: URL): Promise<URL> {
  const token = url.searchParams.get('token') ?? pageToken();
  if (!token) return url;
  try {
    const response = await fetch(`/ws-auth?token=${encodeURIComponent(token)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) return url;
    const sameHost = url.hostname === window.location.hostname;
    if (sameHost) url.searchParams.delete('token');
    scrubPageToken();
  } catch {
    // The WS query-token path remains as a compatibility fallback.
  }
  return url;
}

export interface SimpleSocketOptions {
  onMessage: (message: ServerMessage) => void;
  onState: (state: 'connecting' | 'open' | 'closed') => void;
}

export class SimpleSocket {
  private socket: WebSocket | null = null;
  private stopped = false;
  private reconnectAttempt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private queue: string[] = [];
  private listeners: Set<(msg: ServerMessage) => void> = new Set();

  constructor(private readonly options: SimpleSocketOptions) {}

  /** Subscribe to all incoming messages. Returns an unsubscribe function. */
  onMessage(fn: (msg: ServerMessage) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  async connect(): Promise<void> {
    if (this.stopped) return;
    this.options.onState('connecting');
    const url = await exchangeAuthCookie(defaultWsUrl());
    if (this.stopped) return;

    const socket = new WebSocket(url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      this.reconnectAttempt = 0;
      this.options.onState('open');
      for (const message of this.queue.splice(0)) socket.send(message);
    });
    socket.addEventListener('message', (event) => {
      try {
        const parsed = JSON.parse(String(event.data)) as ServerMessage;
        if (parsed && typeof parsed.type === 'string') {
          this.options.onMessage(parsed);
          for (const fn of this.listeners) fn(parsed);
        }
      } catch {
        // Ignore malformed server frames; the next valid frame keeps the UI alive.
      }
    });
    socket.addEventListener('close', (event) => {
      if (this.socket === socket) this.socket = null;
      if (this.stopped) return;
      if (event.code === 1000) return; // intentional shutdown — don't reconnect
      this.options.onState('closed');
      const baseDelay = Math.min(15_000, 750 * 2 ** this.reconnectAttempt++);
      const jitter = Math.random() * 1000;
      const delay = baseDelay + jitter;
      this.timer = setTimeout(() => void this.connect(), delay);
    });
    socket.addEventListener('error', () => socket.close());
  }

  send(type: string, payload: Record<string, unknown> = {}): void {
    const serialized = JSON.stringify({ type, payload });
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(serialized);
      return;
    }
    if (this.queue.length >= 100) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'simple_socket.send_queue_overflow',
          message: 'Send queue reached 100 messages; dropping the oldest message',
          timestamp: new Date().toISOString(),
        }),
      );
      this.queue.shift();
    }
    this.queue.push(serialized);
  }

  close(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.socket?.close();
    this.socket = null;
  }
}
