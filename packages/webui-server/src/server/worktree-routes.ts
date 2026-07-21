import type { WebSocket } from 'ws';
import type { WSClientMessage } from './types.js';

export interface WorktreeRouteHandlers {
  handleMessage: (msg: { type: string; payload?: Record<string, unknown> }) => Promise<boolean>;
}

export async function handleWorktreeRoute(
  _ws: WebSocket,
  msg: WSClientMessage,
  handlers: WorktreeRouteHandlers,
): Promise<boolean> {
  if (!msg.type.startsWith('worktree.')) return false;
  return handlers.handleMessage(msg as { type: string; payload?: Record<string, unknown> });
}
