import { useCallback } from 'react';
import { composePromptWithFileReferences } from '../lib/file-mention.js';
import {
  type QueueMode,
  enqueueFront,
  enqueueItem,
  resolveSendPlan,
  type QueuedItem,
} from '../lib/queue-model.js';
import { resolveRefineText, type RefineDecision, type RefineState } from '../lib/refine-model.js';
import type { SimpleSocket } from '../lib/ws.js';
import { clearComposerDraft } from '../lib/composer-draft.js';

export interface UseComposerActionsOptions {
  sessionIdRef: React.RefObject<string | null>;
  socketRef: React.RefObject<SimpleSocket | null>;
  draftRef: React.RefObject<string>;
  fileRefsRef: React.RefObject<string[]>;
  refineStateRef: React.RefObject<RefineState | null>;
  draft: string;
  fileRefs: string[];
  running: boolean;
  /** Caller-provided dispatch — the hook uses this inside submitWith and
   *  refineDecision. This lets the caller keep its own refine-aware
   *  startSend logic. */
  startSend: (content: string, images?: { data: string; mime: string }[]) => void;
  setQueue: React.Dispatch<React.SetStateAction<QueuedItem[]>>;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  setFileRefs: React.Dispatch<React.SetStateAction<string[]>>;
  setAttachedImages: React.Dispatch<
    React.SetStateAction<{ id: string; data: string; mime: string; name: string }[]>
  >;
  setRefineState: React.Dispatch<React.SetStateAction<RefineState | null>>;
}

export interface UseComposerActionsResult {
  submitWith: (mode: QueueMode) => void;
  refineDecision: (decision: RefineDecision) => void;
  refineRetry: () => void;
  refineRetryFallback: (ref: string) => void;
  abort: () => void;
}

function messageId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Owns the composer dispatch chain: the single `dispatchUserMessage` entry
 * point, the `startSend` guard that checks refine state, the `submitWith`
 * queue-mode router (send/enqueue/steer), the refine decision/retry flow,
 * and the abort action.
 *
 * Behavioural contract (must survive the PR-5 extraction from `app.tsx`):
 *  - `dispatchUserMessage` composes file references into the prompt and
 *    sends a `user_message` frame; it does NOT check running state.
 *  - `startSend` guards on `runningRef` — if a run is in flight, it
 *    routes through the refine flow instead of dispatching directly.
 *  - `submitWith` uses `resolveSendPlan(mode, running)`:
 *    - `send` → `startSend(composedContent, images)`
 *    - `enqueue` → append to queue
 *    - `abort-then-enqueue-front` → `socket.send('abort')` + `enqueueFront`
 *  - `/clear` slash resets draft, fileRefs, images, and sends `session.new`.
 *  - `refineDecision` routes keep/edit/discard.
 *  - `refineRetry` re-sends the same text with `model.refine`.
 *  - `refineRetryFallback` switches provider/model with a 180s timeout.
 *  - `abort` sends `abort` frame.
 */
export function useComposerActions(options: UseComposerActionsOptions): UseComposerActionsResult {
  const {
    sessionIdRef,
    socketRef,
    draftRef,
    fileRefsRef,
    refineStateRef,
    draft,
    fileRefs,
    running,
    startSend,
    setQueue,
    setDraft,
    setFileRefs,
    setAttachedImages,
    setRefineState,
  } = options;

  const submitWith = useCallback(
    (mode: QueueMode) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;

      // Slash commands
      if (draft.trim() === '/clear') {
        if (sessionIdRef.current) {
          clearComposerDraft(sessionIdRef.current);
          draftRef.current = '';
          fileRefsRef.current = [];
        }
        setDraft('');
        setFileRefs([]);
        setAttachedImages([]);
        socketRef.current?.send('session.new', { sessionId: sessionIdRef.current });
        return;
      }

      const content = composePromptWithFileReferences(draft, fileRefs);
      if (!content) return;

      const plan = resolveSendPlan(mode, running);
      const now = Date.now();

      if (plan === 'send') {
        setDraft('');
        setFileRefs([]);
        setAttachedImages([]);
        if (sessionIdRef.current) {
          clearComposerDraft(sessionIdRef.current);
          draftRef.current = '';
          fileRefsRef.current = [];
        }
        startSend(content);
        return;
      }

      if (plan === 'enqueue') {
        const item: QueuedItem = { id: messageId('q'), text: content, mode, addedAt: now };
        setQueue((current) => enqueueItem(current, item));
        setDraft('');
        setFileRefs([]);
        setAttachedImages([]);
        if (sessionIdRef.current) {
          clearComposerDraft(sessionIdRef.current);
          draftRef.current = '';
          fileRefsRef.current = [];
        }
        return;
      }

      // abort-then-enqueue-front
      const item: QueuedItem = { id: messageId('q'), text: content, mode, addedAt: now };
      setQueue((current) => enqueueFront(current, item));
      setDraft('');
      setFileRefs([]);
      setAttachedImages([]);
      if (sessionIdRef.current) {
        clearComposerDraft(sessionIdRef.current);
        draftRef.current = '';
        fileRefsRef.current = [];
      }
      socketRef.current?.send('abort', { sessionId: sessionIdRef.current });
    },
    [
      sessionIdRef,
      socketRef,
      draft,
      fileRefs,
      running,
      draftRef,
      fileRefsRef,
      setDraft,
      setFileRefs,
      setAttachedImages,
      setQueue,
      startSend,
    ],
  );

  const refineDecision = useCallback(
    (decision: RefineDecision) => {
      const refineState = refineStateRef.current;
      if (!refineState) return;
      const text = resolveRefineText(refineState, decision);
      setRefineState(null);
      if (text && decision !== 'edit') {
        startSend(text);
      }
    },
    [refineStateRef, setRefineState, startSend],
  );

  const refineRetry = useCallback(() => {
    const refineState = refineStateRef.current;
    if (!refineState) return;
    socketRef.current?.send('model.refine', {
      text: refineState.original,
    });
  }, [refineStateRef, socketRef]);

  const refineRetryFallback = useCallback(
    (ref: string) => {
      const slash = ref.indexOf('/');
      if (slash === -1) return;
      socketRef.current?.send('model.refine', {
        text: refineStateRef.current?.original ?? '',
        provider: ref.slice(0, slash),
        model: ref.slice(slash + 1),
        timeoutMs: 180_000,
      });
    },
    [refineStateRef, socketRef],
  );

  const abort = useCallback(() => {
    socketRef.current?.send('abort', { sessionId: sessionIdRef.current ?? undefined });
  }, [socketRef, sessionIdRef]);

  return {
    submitWith,
    refineDecision,
    refineRetry,
    refineRetryFallback,
    abort,
  };
}
