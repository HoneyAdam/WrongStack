import type { WebSocket } from 'ws';
import type { WSClientMessage } from './types.js';

export interface GoalSnapshotRouteHandlers {
  getSnapshot: (ws: WebSocket, msg: WSClientMessage) => Promise<void> | void;
}

export async function handleGoalSnapshotRoute(
  ws: WebSocket,
  msg: WSClientMessage,
  handlers: GoalSnapshotRouteHandlers,
): Promise<boolean> {
  switch (msg.type) {
    case 'goal.get':
    case 'goal-state.get':
      await handlers.getSnapshot(ws, msg);
      return true;
    default:
      return false;
  }
}
