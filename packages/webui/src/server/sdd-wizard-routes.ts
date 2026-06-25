import type { WebSocket } from 'ws';
import type { WSClientMessage } from './types.js';

export interface SddWizardRouteHandlers {
  handleMessage: (msg: { type: string; payload?: Record<string, unknown> }) => Promise<void>;
}

/**
 * Forward the SDD wizard messages (`sdd.spec.*` and `sdd.run.start`) to the
 * SddWizardWebSocketHandler. Note `sdd.board.*` is handled separately by the
 * board route — the wizard owns spec-building + run kickoff, the board owns
 * live observation/control.
 */
export async function handleSddWizardRoute(
  _ws: WebSocket,
  msg: WSClientMessage,
  handlers: SddWizardRouteHandlers,
): Promise<boolean> {
  if (!(msg.type.startsWith('sdd.spec.') || msg.type.startsWith('sdd.run.'))) return false;
  await handlers.handleMessage(msg as { type: string; payload?: Record<string, unknown> });
  return true;
}
