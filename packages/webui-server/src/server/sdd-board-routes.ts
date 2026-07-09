import type { WebSocket } from 'ws';
import type { WSClientMessage } from './types.js';

export interface SddBoardRouteHandlers {
  handleMessage: (msg: { type: string; payload?: Record<string, unknown> }) => Promise<void>;
}

/** Forward any `sdd.board.*` message to the SddBoardWebSocketHandler. */
export async function handleSddBoardRoute(
  _ws: WebSocket,
  msg: WSClientMessage,
  handlers: SddBoardRouteHandlers,
): Promise<boolean> {
  if (!msg.type.startsWith('sdd.board.')) return false;
  await handlers.handleMessage(msg as { type: string; payload?: Record<string, unknown> });
  return true;
}
