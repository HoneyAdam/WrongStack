import type { WebSocket } from 'ws';
import type { WSClientMessage } from './types.js';

export interface GoalRouteHandlers {
  handleMessage: (msg: { type: string; payload?: Record<string, unknown> }) => Promise<void>;
}

export async function handleGoalRoute(
  _ws: WebSocket,
  msg: WSClientMessage,
  handlers: GoalRouteHandlers,
): Promise<boolean> {
  if (!msg.type.startsWith('goal.')) return false;
  await handlers.handleMessage(msg as { type: string; payload?: Record<string, unknown> });
  return true;
}
