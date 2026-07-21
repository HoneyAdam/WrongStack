import type { WebSocket } from 'ws';
import type { WSClientMessage } from './types.js';

export interface ClientTransportRouteHandlers {
  collaboration: (ws: WebSocket, msg: WSClientMessage) => Promise<void> | void;
  terminal: (ws: WebSocket, msg: WSClientMessage) => Promise<void> | void;
}

export async function handleClientTransportRoute(
  ws: WebSocket,
  msg: WSClientMessage,
  handlers: ClientTransportRouteHandlers,
): Promise<boolean> {
  switch (msg.type) {
    case 'collab.join':
    case 'collab.leave':
    case 'collab.annotate':
    case 'collab.resolve':
    case 'collab.request_pause':
    case 'collab.resume':
    case 'collab.grant_control':
    case 'collab.inject_tool':
      await handlers.collaboration(ws, msg);
      return true;
    case 'terminal.create':
    case 'terminal.input':
    case 'terminal.resize':
    case 'terminal.close':
      await handlers.terminal(ws, msg);
      return true;
    default:
      return false;
  }
}
