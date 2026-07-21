import type { WebSocket } from 'ws';
import type { WSClientMessage } from './types.js';

export interface CompletionRouteHandlers {
  request: (ws: WebSocket, msg: WSClientMessage) => Promise<void> | void;
}

export async function handleCompletionRoute(
  ws: WebSocket,
  msg: WSClientMessage,
  handlers: CompletionRouteHandlers,
): Promise<boolean> {
  switch (msg.type) {
    case 'completion.request':
      await handlers.request(ws, msg);
      return true;
    default:
      return false;
  }
}
