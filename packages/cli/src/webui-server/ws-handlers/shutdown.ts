import type { WebSocket } from 'ws';
import type { WsCommon } from './index.js';

/**
 * PR 5i of Issue #30: shutdown ws-handler.
 *
 * Extracted from the inline `handleMessage` switch in webui-server.ts.
 * `webui.shutdown` simply invokes the host-supplied `shutdown()` closure
 * (which unregisters the client, closes the HTTP server, and fires
 * `opts.onExit`). No shared state is needed beyond that callback.
 */

export interface ShutdownContext extends WsCommon {
  /** Host-supplied shutdown routine (closes the server, fires onExit). */
  shutdown: () => void;
}

export function handleWebuiShutdown(ctx: ShutdownContext, _ws: WebSocket): void {
  ctx.log('[WebUI] Shutdown requested from client');
  ctx.shutdown();
}
