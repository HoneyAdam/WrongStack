import { getWSClient } from '@/lib/ws-client';
import type { WrongStackWebSocketClient } from '@/lib/ws-client';
import type { WSServerMessage } from '@/types';
import { useEffect, useRef } from 'react';

/**
 * Register a map of `{ messageType: handler }` against the singleton WS
 * client for the lifetime of the component, tearing them all down on
 * unmount. Replaces the recurring boilerplate:
 *
 *   const off1 = client.on('a', ha);
 *   const off2 = client.on('b', hb);
 *   …
 *   return () => { off1?.(); off2?.(); … };
 *
 * The handlers map is captured once (stored in a ref) so identity changes
 * across renders don't churn the registrations; pass primitive deps in the
 * second argument to re-subscribe when they change (same contract as
 * useEffect). When no deps are given, the registration happens once on
 * mount.
 *
 * Note: this uses the WIDE WSServerMessage handler signature (not the
 * generic narrowing overload) because the map keys are dynamic at the
 * call site. Individual handlers still narrow via `msg.payload as …` —
 * that narrowing is a follow-up once the union is fully typed per branch.
 */
export function useWsHandlers(
  handlers: Partial<Record<WSServerMessage['type'], (msg: WSServerMessage) => void>>,
  deps: ReadonlyArray<unknown> = [],
): void {
  // Keep the latest handler map in a ref so the effect can stay stable.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const client: WrongStackWebSocketClient | null = getWSClient();
    if (!client) return;
    const offs: Array<() => void> = [];
    // Register stable WRAPPERS that read the ref at dispatch time — never the
    // concrete handler captured when the effect ran. Registering the captured
    // fn would freeze whatever props/state it closed over at mount (the ref
    // would be maintained but never consulted).
    for (const type of Object.keys(handlersRef.current)) {
      offs.push(
        client.on(type as WSServerMessage['type'], (msg: WSServerMessage) => {
          handlersRef.current[type as WSServerMessage['type']]?.(msg);
        }),
      );
    }
    return () => {
      for (const off of offs) {
        try {
          off();
        } catch {
          // best-effort — a stale off() after socket teardown is harmless
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
