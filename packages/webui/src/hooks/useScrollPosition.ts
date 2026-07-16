import { type RefObject, useEffect, useRef } from 'react';
import { useUIStore } from '@/stores';

/**
 * Per-view scroll position persistence.
 *
 * Restores the scroll position of a scrollable element when its view mounts,
 * and saves the position back to the Zustand store when the view unmounts
 * (navigation away, F5 teardown).
 *
 * The save fires **on unmount**, not on every scroll event, to avoid
 * flooding the store with state writes.
 *
 * @param viewKey  Unique key for this scroll context (e.g. 'settings', 'sessions').
 * @param enabled  Skip restore/save when false (e.g. before data is loaded).
 */
export function useScrollPosition<T extends HTMLElement = HTMLElement>(
  viewKey: string,
  enabled: boolean = true,
): RefObject<T | null> {
  const ref = useRef<T>(null);

  // Restore on mount.
  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    // Defer one frame so the DOM has rendered content.
    const raf = requestAnimationFrame(() => {
      const saved = useUIStore.getState().scrollPositions[viewKey];
      if (typeof saved === 'number' && saved > 0) {
        el.scrollTop = saved;
      }
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save on unmount.
  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    const { setScrollPosition } = useUIStore.getState();
    return () => {
      setScrollPosition(viewKey, el.scrollTop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);

  return ref;
}
