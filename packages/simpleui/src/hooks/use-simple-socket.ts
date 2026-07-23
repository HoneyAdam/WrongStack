import { useEffect, useRef, useState } from 'react';
import { SimpleSocket } from '../lib/ws.js';
import type { ConnectionState, ServerMessage } from '../types.js';

/**
 * Callback fired when the WebSocket reaches a new connection state.
 * Mirrors the pre-PR-2 `setConnection` setter, so consumers can pass their
 * `useState` setter directly.
 */
export interface UseSimpleSocketOptions {
  /** Stable message handler — when its identity changes, the socket recreates. */
  onMessage: (message: ServerMessage) => void;
  /** Read live session id without re-running the socket effect. */
  sessionIdRef: React.RefObject<string | null>;
  /** Socket ref owned by the consumer; the hook writes its socket here so
   *  other parts of the component tree (dispatch, file mention debounce,
   *  panels that send frames) can reach the live socket. The ref must be
   *  stable across renders. */
  socketRef: React.RefObject<SimpleSocket | null>;
  /** Called with the new connection state on every transition. */
  onConnectionChange?: (state: ConnectionState) => void;
  /** Called when the socket announces any non-`'open'` state (i.e.
   *  `'connecting'` or `'closed'`) so the consumer can clear the session
   *  menu and file-search surface. */
  onDisconnect?: () => void;
}

export interface UseSimpleSocketResult {
  /** Current connection state. Starts at `'connecting'` (SimpleSocket
   *  announces `'connecting'` synchronously inside `connect()`). */
  connection: ConnectionState;
}

/**
 * Owns the SimpleUI WebSocket lifecycle: construction, bootstrap frames on
 * open, disconnect side-effects, and cleanup on unmount or handler change.
 *
 * Behavioural contract (must survive the PR-2 extraction from `app.tsx`):
 *  - On mount, a fresh `SimpleSocket` is created and `connect()` is awaited.
 *  - When the socket announces `'open'`, the bootstrap frame sequence fires
 *    exactly once per open transition: `providers.saved`, `providers.list`,
 *    `prefs.get`, `modes.list`, and (only when a session is known)
 *    `sessions.list`.
 *  - When the socket announces any state other than `'open'` (i.e.
 *    `'connecting'` or `'closed'`), `onDisconnect` fires so the consumer
 *    can clear the session menu and file-search surface. This matches the
 *    pre-PR-2 inline effect's `else` branch, which fired on every non-open
 *    transition — the initial `'connecting'` announcement (fired before the
 *    first `'open'`) also clears the surface, which is harmless because
 *    those surfaces are already empty on a fresh mount.
 *  - On unmount or `onMessage` identity change, cleanup runs in the exact
 *    pre-PR-2 order: `socketRef.current = null` first, then `socket.close()`.
 *    Setting the ref to `null` before closing prevents any in-flight
 *    `send(...)` call from re-entering a closing socket.
 *  - `sessionIdRef.current` is read at open-time, not at mount-time, so a
 *    session that arrives between mount and the first open transition is
 *    still seeded with `sessions.list`.
 */
export function useSimpleSocket(options: UseSimpleSocketOptions): UseSimpleSocketResult {
  const { onMessage, sessionIdRef, socketRef, onConnectionChange, onDisconnect } = options;
  const [connection, setConnection] = useState<ConnectionState>('connecting');

  // Latest-ref pattern: the state callbacks are read through refs so an
  // inline arrow at the call site cannot enter the effect's dependency list.
  // Otherwise every consumer render would tear the socket down and reconnect,
  // and each reconnect's bootstrap responses would trigger the next render —
  // a self-sustaining drop/reconnect loop. Only an `onMessage` identity
  // change may recreate the socket (pinned by tests).
  const onConnectionChangeRef = useRef(onConnectionChange);
  onConnectionChangeRef.current = onConnectionChange;
  const onDisconnectRef = useRef(onDisconnect);
  onDisconnectRef.current = onDisconnect;

  useEffect(() => {
    let closed = false;
    const socket = new SimpleSocket({
      onMessage,
      onState: (state) => {
        if (closed) return;
        setConnection(state);
        onConnectionChangeRef.current?.(state);
        if (state === 'open') {
          socket.send('providers.saved');
          socket.send('providers.list');
          // The server owns preference truth; seed from it rather than
          // trusting whatever this tab last rendered.
          socket.send('prefs.get');
          socket.send('modes.list');
          const sessionId = sessionIdRef.current;
          if (sessionId) {
            socket.send('sessions.list', { sessionId, limit: 12 });
          }
        } else {
          onDisconnectRef.current?.();
        }
      },
    });
    socketRef.current = socket;
    socket.connect().catch((err) => {
      // The SimpleSocket contract is to call onState('closed') on every
      // failure path, so this catch should never fire in practice. If it
      // does (e.g. a synchronous throw before the WebSocket is constructed),
      // surface the unexpected failure so consumers can debug it.
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'use_simple_socket.connect_unhandled_rejection',
          message: 'Socket connect rejected without onState transition',
          error: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        }),
      );
    });
    return () => {
      closed = true;
      socketRef.current = null;
      socket.close();
    };
  }, [onMessage, sessionIdRef]);

  return { connection };
}
