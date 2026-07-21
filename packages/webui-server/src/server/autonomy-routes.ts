import type { WebSocket } from 'ws';
import { handleAutonomySwitch, type PrefsHandlerContext } from './prefs-handlers.js';
import type { WSClientMessage } from './types.js';
import { validateAutonomySwitchPayload } from './ws-payload-validation.js';
import { sendResult } from './ws-utils.js';

export interface AutonomyRouteHandlers {
  switchMode: (ws: WebSocket, msg: WSClientMessage) => Promise<void> | void;
}

export function createAutonomyRouteHandlers(ctx: PrefsHandlerContext): AutonomyRouteHandlers {
  return {
    switchMode: (ws, message) => {
      const parsed = validateAutonomySwitchPayload(message.payload);
      if (!parsed.ok) {
        sendResult(ws, false, parsed.message);
        return;
      }
      handleAutonomySwitch(ctx, ws, parsed.value.mode);
    },
  };
}

export async function handleAutonomyRoute(
  ws: WebSocket,
  msg: WSClientMessage,
  handlers: AutonomyRouteHandlers,
): Promise<boolean> {
  switch (msg.type) {
    case 'autonomy.switch':
      await handlers.switchMode(ws, msg);
      return true;
    default:
      return false;
  }
}
