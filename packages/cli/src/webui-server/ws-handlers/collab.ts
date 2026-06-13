import type { WebSocket } from 'ws';
import type { WsCommon } from './index.js';

/**
 * PR 5i of Issue #30: collaboration ws-handlers.
 *
 * The CLI webui-server doesn't run a full collaboration hub (presence,
 * shared annotations, conflict resolution), so the `collab.*` messages
 * (`collab.join`, `collab.leave`, `collab.annotate`, `collab.resolve`)
 * are silently acknowledged and ignored. Extracted to its own handler so
 * the intent ("known message, intentionally a no-op") is explicit rather
 * than buried as fall-through cases in the switch.
 */

export type CollabContext = WsCommon;

/**
 * No-op handler for every `collab.*` message. Returns without sending —
 * the client doesn't expect a reply for collaboration events on the
 * embedded server.
 */
export function handleCollabNoop(_ctx: CollabContext, _ws: WebSocket): void {
  // Intentionally empty: see module docstring.
}
