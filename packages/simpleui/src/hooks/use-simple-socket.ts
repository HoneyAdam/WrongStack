import { useEffect, useState } from 'react';
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

  useEffect(() => {
    const socket = new SimpleSocket({
      onMessage,
      onState: (state) => {
        setConnection(state);
        onConnectionChange?.(state);
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
          onDisconnect?.();
        }
      },
    });
    socketRef.current = socket;
    void socket.connect();
    return () => {
      socketRef.current = null;
      socket.close();
    };
  }, [onMessage, sessionIdRef, onConnectionChange, onDisconnect]);

  return { connection };
}
