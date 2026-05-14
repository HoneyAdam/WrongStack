import type { EventBus } from '../kernel/events.js';

export interface RequestLimitExtensionOptions {
  events: EventBus;
  currentIterations: number;
  currentLimit: number;
  /** When true (default), auto-grant 100 extra after giving listeners a tick to deny. */
  autoExtend: boolean;
  /** Timeout in ms before falling back to "0 extra" if no listener responds. */
  timeoutMs?: number;
}

/**
 * Emit `iteration.limit_reached` and wait for a listener to grant or
 * deny. Resolves with the number of extra iterations to grant (0 = stop).
 * When `autoExtend` is true the listener gets a microtask window to call
 * `deny()`; otherwise we resolve to 100.
 */
export function requestLimitExtension(opts: RequestLimitExtensionOptions): Promise<number> {
  const { events, currentIterations, currentLimit, autoExtend, timeoutMs = 30_000 } = opts;
  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(0);
      }
    }, timeoutMs);
    const deny = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(0);
      }
    };
    const grant = (extra: number) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(Math.max(0, extra));
      }
    };
    events.emit('iteration.limit_reached', {
      currentIterations,
      currentLimit,
      grant,
      deny,
    });
    if (autoExtend) {
      // Give listeners a tick to deny synchronously; otherwise auto-grant 100.
      setImmediate(() => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve(100);
        }
      });
    }
  });
}
