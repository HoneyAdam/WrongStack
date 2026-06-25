import type { WebSocket } from 'ws';
import type { WSClientMessage } from './types.js';

export interface SpecsRouteHandlers {
  handleMessage: (msg: { type: string; payload?: Record<string, unknown> }) => Promise<void>;
}

/** Forward any `specs.*` message to the SpecsWebSocketHandler. */
export async function handleSpecsRoute(
  _ws: WebSocket,
  msg: WSClientMessage,
  handlers: SpecsRouteHandlers,
): Promise<boolean> {
  if (!msg.type.startsWith('specs.')) return false;
  await handlers.handleMessage(msg as { type: string; payload?: Record<string, unknown> });
  return true;
}
