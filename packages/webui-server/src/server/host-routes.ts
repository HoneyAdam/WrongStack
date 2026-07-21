import type { WebSocket } from 'ws';
import type { WSClientMessage } from './types.js';

export interface HostRouteHandlers {
  shutdown: (ws: WebSocket, msg: WSClientMessage) => Promise<void> | void;
}

export async function handleHostRoute(
  ws: WebSocket,
  msg: WSClientMessage,
  handlers: HostRouteHandlers,
): Promise<boolean> {
  switch (msg.type) {
    case 'webui.shutdown':
      await handlers.shutdown(ws, msg);
      return true;
    default:
      return false;
  }
}
