import { useEffect } from 'react';
import { useChatStore, useConfigStore, useSessionStore, useUIStore } from '@/stores';
import { showPanel } from '@/components/activity-bar/nav';

/**
 * F5 / tab-close resilience.
 *
 * Two concerns, both mounted once on app boot:
 *
 * 1. **Persist flush** — zustand's `persist` middleware writes asynchronously,
 *    so in-flight mutations can be lost on page teardown (F5, tab close,
 *    navigation). This effect hooks `pagehide` and `beforeunload` to force a
 *    synchronous flush of every persisted store before the page disappears.
 *
 * 2. **View fallback** — if the persisted `currentView` was an exotic overlay
 *    (debug, analytics, design-gallery, setup), auto-navigate to `chat` so
 *    the user lands on a usable surface instead of a stale debug screen.
 */
export function useF5Resilience(): void {
  // ── 1. Persist flush ─────────────────────────────────────────────────────
  useEffect(() => {
    const flush = (): void => {
      try {
        const stores = [useSessionStore, useChatStore, useUIStore, useConfigStore];
        for (const s of stores) {
          const persistApi = (
            s as unknown as {
              persist?: { flush?: () => void; getOptions?: () => { storage?: unknown } };
            }
          ).persist;
          if (persistApi && typeof persistApi.flush === 'function') {
            persistApi.flush();
          }
        }
      } catch {
        // ignore — best-effort flush.
      }
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
    };
  }, []);

  // ── 2. View fallback ─────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (
      window.location.pathname === '/debug' ||
      window.location.pathname === '/analytics' ||
      window.location.pathname === '/refresh-debug'
    ) {
      return;
    }
    const persistedView = useUIStore.getState().currentView;
    if (
      persistedView === 'debug' ||
      persistedView === 'analytics' ||
      persistedView === 'design-gallery' ||
      persistedView === 'setup'
    ) {
      showPanel('chat');
    }
  }, []);
}
