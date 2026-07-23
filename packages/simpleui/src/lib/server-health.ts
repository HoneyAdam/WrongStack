/**
 * Server-outage detection for the SimpleUI page.
 *
 * The WebSocket layer reconnects forever (see `SIMPLE_CONNECTION_CONFIG`),
 * which is correct behaviour but silent: when the server process is gone —
 * stopped, crashed, or restarted on an auto-advanced port — the only visible
 * signal was a tiny OFF dot while the console filled with reconnect errors.
 *
 * An HTTP probe against the page origin disambiguates the two failure modes
 * the WS state alone cannot tell apart:
 *
 *  - fetch throws (network error)  → nothing is listening on this port at
 *    all ('server-gone'). Typical causes: the instance was stopped, or a new
 *    instance auto-advanced to another port while this tab kept the old one.
 *  - fetch resolves (any status)   → the HTTP listener is alive but the
 *    WebSocket upgrade keeps failing ('ws-blocked'), which points at a
 *    proxy or browser extension interfering with ws:// traffic.
 */

export type OutageKind = 'none' | 'server-gone' | 'ws-blocked';

/** How long a non-open connection must persist before the first probe.
 *  Covers the normal connect + auth handshake and brief server restarts so
 *  the overlay never flashes during routine reconnects. */
export const OUTAGE_GRACE_MS = 4_000;

/** Re-probe cadence while the connection stays down. */
export const OUTAGE_PROBE_INTERVAL_MS = 5_000;

/**
 * Probe the HTTP origin the page was served from. Any HTTP response — even
 * an error status — proves a listener is present; only a network-level
 * failure means the port is dead.
 */
export async function probeServer(
  fetchFn: typeof fetch = fetch,
): Promise<'reachable' | 'unreachable'> {
  try {
    await fetchFn('/', { cache: 'no-store', credentials: 'same-origin' });
    return 'reachable';
  } catch {
    return 'unreachable';
  }
}

/** Map a probe result onto the outage classification shown to the user. */
export function classifyOutage(probe: 'reachable' | 'unreachable'): OutageKind {
  return probe === 'unreachable' ? 'server-gone' : 'ws-blocked';
}
