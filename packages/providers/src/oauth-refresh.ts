/**
 * Shared single-flight wrapper for OAuth token refresh.
 *
 * OAuth providers all share the same race: when N concurrent requests arrive
 * near expiry (or after a 401), each requester runs its own full refresh path
 * — token endpoint call, in-memory state mutation, and `onRefresh` callback
 * for persistence. With N concurrent callers, the upstream endpoint is hit N
 * times, `onRefresh` fires N times, and state mutations race with stale-wins.
 *
 * `createSingleFlightRefresh` collapses concurrent callers onto one in-flight
 * promise. After the refresh resolves (or rejects), the slot is cleared so
 * the next refresh can fire normally. The work function passed in must
 * include every side effect (state mutation + persistence callback), because
 * it is the boundary the helper enforces single-flight across.
 *
 * Contract:
 * - `refresh()` called while no refresh is in flight → starts one.
 * - `refresh()` called while a refresh IS in flight → awaits the same promise.
 * - On rejection, every awaiter sees the same error; the slot is cleared so
 *   a later refresh can be retried.
 * - The first caller's `signal` is used by the in-flight refresh. Signals
 *   from later callers are ignored (cancelling the in-flight refresh would
 *   break the other awaiters).
 */
export interface SingleFlightRefresh<T> {
  /**
   * Trigger (or join) a refresh. Returns the new value once complete.
   * `signal` from the first caller is used; concurrent callers' signals are
   * ignored so cancellation cannot break another awaiter's refresh.
   */
  refresh(signal?: AbortSignal): Promise<T>;
  /** True iff a refresh is currently in flight. */
  get inFlight(): boolean;
}

export function createSingleFlightRefresh<T>(
  refreshFn: (signal: AbortSignal | undefined) => Promise<T>,
): SingleFlightRefresh<T> {
  let inFlight: Promise<T> | null = null;

  const refresh = (signal?: AbortSignal): Promise<T> => {
    if (inFlight) return inFlight;
    inFlight = refreshFn(signal).finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  return {
    refresh,
    get inFlight() {
      return inFlight !== null;
    },
  };
}