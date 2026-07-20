import { useEffect } from 'react';
import type { ComposerDraft } from '../lib/composer-draft.js';

export interface UseF5ResilienceOptions {
  /** Live preferences ref — the hook reads `confirmExit` off it so the
   *  listener never closes over a stale value. Passing the full prefs ref
   *  avoids forcing the consumer to maintain a derived boolean ref. */
  confirmExitRef: React.RefObject<{ confirmExit: boolean }>;
  /** Live "is a run in flight?" flag — same ref discipline as `confirmExitRef`. */
  runningRef: React.RefObject<boolean>;
  /** Live session id — the draft flush skips when this is null. */
  sessionIdRef: React.RefObject<string | null>;
  /** Live composer text — flushed on teardown. */
  draftRef: React.RefObject<string>;
  /** Live file references — flushed alongside the draft. */
  fileRefsRef: React.RefObject<string[]>;
  /** Persistence sink. The hook does not own storage; it calls through. */
  writeComposerDraft: (sessionId: string, draft: ComposerDraft) => void;
}

/**
 * F5 / tab-close resilience for SimpleUI.
 *
 * Behavioural contract (must survive the PR-2 extraction from `app.tsx`):
 *  - `beforeunload` calls `event.preventDefault()` (and sets `returnValue`)
 *    ONLY when both `confirmExitRef.current` and `runningRef.current` are
 *    truthy. This matches the pre-PR-2 inline effect that gated on
 *    `prefsRef.current.confirmExit && runningRef.current`.
 *  - `pagehide` flushes the composer draft synchronously via
 *    `writeComposerDraft`, but only when `sessionIdRef.current` is set.
 *  - The cleanup function (fires on unmount) ALSO calls `flushDraft()` once,
 *    so a React StrictMode remount or a route change still persists the draft.
 *  - Both effects read from refs, never from closure-captured state, so a
 *    long-lived listener stays correct across re-renders without needing the
 *    effect to re-run.
 */
export function useF5Resilience(options: UseF5ResilienceOptions): void {
  const { confirmExitRef, runningRef, sessionIdRef, draftRef, fileRefsRef, writeComposerDraft } =
    options;

  // ── Exit confirmation via browser beforeunload ─────────────────────────
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (confirmExitRef.current?.confirmExit && runningRef.current) {
        event.preventDefault();
        // Modern browsers show a generic "Leave site?" dialog; the
        // returnValue assignment is required by the spec even though
        // the string is ignored.
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [confirmExitRef, runningRef]);

  // ── Draft flush on pagehide + unmount ──────────────────────────────────
  useEffect(() => {
    const flushDraft = () => {
      if (!sessionIdRef.current) return;
      writeComposerDraft(sessionIdRef.current, {
        text: draftRef.current,
        fileRefs: fileRefsRef.current,
      });
    };
    window.addEventListener('pagehide', flushDraft);
    return () => {
      window.removeEventListener('pagehide', flushDraft);
      flushDraft();
    };
  }, [sessionIdRef, draftRef, fileRefsRef, writeComposerDraft]);
}
