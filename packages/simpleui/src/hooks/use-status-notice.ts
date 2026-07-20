import { useCallback, useEffect, useState } from 'react';
import type { StatusNoticeProjection } from '../lib/status-notice.js';

/**
 * Auto-dismiss window for a notice, in milliseconds. Mirrors the pre-PR-1
 * `app.tsx` value exactly; changing it is a UX decision, not a refactor one.
 */
const NOTICE_TIMEOUT_MS = 5_000;

export interface StatusNotice extends StatusNoticeProjection {
  /** Unique per-notice id so a fresh notice can replace a pending one and the
   *  timeout reset doesn't accidentally clear a newer sibling. */
  id: string;
}

export interface UseStatusNoticeResult {
  notice: StatusNotice | null;
  /** Replace the current notice. Accepts either a `StatusNotice` value, `null`
   *  to clear, or a `prev => next` updater — the same shape React's
   *  `Dispatch<SetStateAction<...>>` exposes. This keeps the hook drop-in
   *  compatible with consumers that previously stored the notice in a
   *  `useState` slot (e.g. SimpleUI's `MessageHandlerDeps.setNotice`). */
  showNotice: (
    value: StatusNotice | null | ((prev: StatusNotice | null) => StatusNotice | null),
  ) => void;
  /** Clear the current notice immediately. Safe to call when nothing is shown. */
  clearNotice: () => void;
}

/**
 * Owns the transient composer notice lifecycle.
 *
 * Behavioural contract (must survive the PR-1 extraction from `app.tsx`):
 *  - A notice auto-clears after `NOTICE_TIMEOUT_MS`.
 *  - Showing a different notice replaces the current one and restarts the timer.
 *  - Showing a notice with the same `id` as the currently displayed one also
 *    restarts the timer (this was the pre-PR-1 invariant: the timeout effect
 *    keyed on the notice object identity, and React re-runs the effect when
 *    the identity changes).
 *  - Cleanup cancels any pending timer on unmount or replacement.
 */
export function useStatusNotice(): UseStatusNoticeResult {
  const [notice, setNotice] = useState<StatusNotice | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => {
      // Only clear if this is still the same notice — a newer push may have
      // landed between the timer being scheduled and firing.
      setNotice((current) => (current?.id === notice.id ? null : current));
    }, NOTICE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const showNotice = useCallback(
    (value: StatusNotice | null | ((prev: StatusNotice | null) => StatusNotice | null)) => {
      setNotice(value);
    },
    [],
  );

  const clearNotice = useCallback(() => {
    setNotice(null);
  }, []);

  return { notice, showNotice, clearNotice };
}
