import type { WebSocket } from 'ws';
import { createModeOperations, type ModeOperationsContext } from './mode-operations.js';
import type { WSClientMessage } from './types.js';
import { validateModeSwitchPayload } from './ws-payload-validation.js';

export interface ModeRouteHandlers {
  listModes: (ws: WebSocket) => Promise<void>;
  switchMode: (ws: WebSocket, msg: WSClientMessage) => Promise<void>;
}

export function createModeRouteHandlers(context: ModeOperationsContext): ModeRouteHandlers {
  const operations = createModeOperations(context);
  return {
    listModes: operations.listModes,
    switchMode: async (ws, message) => {
      const parsed = validateModeSwitchPayload(message.payload);
      if (!parsed.ok) {
        context.send(ws, {
          type: 'key.operation_result',
          payload: { success: false, message: parsed.message },
        });
        return;
      }
      await operations.switchMode(ws, parsed.value.id);
    },
  };
}

export async function handleModeRoute(
  ws: WebSocket,
  msg: WSClientMessage,
  handlers: ModeRouteHandlers,
): Promise<boolean> {
  switch (msg.type) {
    case 'modes.list':
      await handlers.listModes(ws);
      return true;
    case 'mode.switch':
      await handlers.switchMode(ws, msg);
      return true;
    default:
      return false;
  }
}
