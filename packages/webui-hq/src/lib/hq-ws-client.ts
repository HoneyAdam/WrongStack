/**
 * HQ dashboard WebSocket client — connects to `/ws/browser` on the HQ server
 * and dispatches `hq.snapshot` / `hq.event` / `hq.alert` frames to registered
 * handlers. Reconnects with exponential backoff; offline-queues nothing (the
 * snapshot-on-connect gives full state, so a dropped frame is recovered on
 * the next snapshot).
 *
 * Browser token is read from the `?token=` query param (the HQ server passes
 * it when serving the dashboard HTML).
 */
import type { HqBrowserMessage, HqEventEnvelope, HqSnapshot } from '@wrongstack/core';

type Handler = (msg: HqBrowserMessage) => void;

export class HqWsClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly url: string;

  constructor(baseUrl?: string) {
    // Derive the WS URL from the current page location so the dashboard
    // works regardless of which host/port HQ is bound to.
    const loc = typeof window !== 'undefined' ? window.location : { host: '127.0.0.1:3499', protocol: 'http:' };
    const wsProto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').get('token');
    const base = baseUrl ?? `${wsProto}//${loc.host}/ws/browser`;
    this.url = token ? `${base}?token=${encodeURIComponent(token)}` : base;
  }

  connect(): void {
    if (this.stopped || this.ws !== null) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(typeof event.data === 'string' ? event.data : '') as HqBrowserMessage;
        for (const h of this.handlers) {
          try {
            h(msg);
          } catch {
            /* handler errors must not kill the client */
          }
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => this.handleClose();
    ws.onerror = () => this.handleClose();
  }

  private handleClose(): void {
    this.ws = null;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== null) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.reconnectAttempt, 4));
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  on(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close(1000, 'client closed');
    this.ws = null;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

/** Singleton client for the app. */
let client: HqWsClient | null = null;
export function getHqClient(): HqWsClient {
  if (client === null) {
    client = new HqWsClient();
    client.connect();
  }
  return client;
}

// Re-export the HQ types the dashboard consumes.
export type { HqBrowserMessage, HqEventEnvelope, HqSnapshot };
