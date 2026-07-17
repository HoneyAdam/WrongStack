import type { EternalAutonomyEngine, ParallelEternalEngine } from '@wrongstack/core';
import type { SddRunControl } from '@wrongstack/sdd';
import { useEffect } from 'react';
import type { Action, State } from '../app-reducer.js';

interface MutableRef<T> {
  current: T;
}

interface StreamSegment {
  kind: 'assistant' | 'thinking';
  text: string;
}

export interface SessionInterruptController {
  abortLeader: () => boolean;
  /**
   * True while a leader run, autonomy loop, or SDD run is in flight. Read by
   * `/clear` to confirm before wiping a session that still has active work.
   */
  isRunning?: (() => boolean) | undefined;
  resetSession?: (() => void) | undefined;
  waitForIdle?: (() => Promise<void>) | undefined;
}

interface UseSessionInterruptControllerOptions {
  interruptController: SessionInterruptController | undefined;
  dispatch: (action: Action) => void;
  stateRef: MutableRef<State>;
  activeCtrlRef: MutableRef<AbortController | null>;
  activeRunSettledRef: MutableRef<Promise<void>>;
  sessionGenerationRef: MutableRef<number>;
  streamingTextRef: MutableRef<string>;
  streamSegmentsRef: MutableRef<StreamSegment[]>;
  pendingDeltaRef: MutableRef<string>;
  assistantCommittedThisRunRef: MutableRef<boolean>;
  flushTimerRef: MutableRef<ReturnType<typeof setTimeout> | null>;
  eternalLoopRunningRef: MutableRef<boolean>;
  parallelLoopRunningRef: MutableRef<boolean>;
  clearPendingConfirms: () => void;
  getEternalEngine: (() => EternalAutonomyEngine | null) | undefined;
  getParallelEngine: (() => ParallelEternalEngine | null) | undefined;
  getSddRun: (() => SddRunControl | null) | undefined;
  switchAutonomy:
    | ((mode: 'off' | 'suggest' | 'auto' | 'eternal' | 'eternal-parallel') => string | null)
    | undefined;
}

/** Connect `/interrupt` and `/clear` to the live TUI run lifecycle. */
export function useSessionInterruptController({
  interruptController,
  dispatch,
  stateRef,
  activeCtrlRef,
  activeRunSettledRef,
  sessionGenerationRef,
  streamingTextRef,
  streamSegmentsRef,
  pendingDeltaRef,
  assistantCommittedThisRunRef,
  flushTimerRef,
  eternalLoopRunningRef,
  parallelLoopRunningRef,
  clearPendingConfirms,
  getEternalEngine,
  getParallelEngine,
  getSddRun,
  switchAutonomy,
}: UseSessionInterruptControllerOptions): void {
  useEffect(() => {
    if (!interruptController) return;

    // Shared predicate: is any producer (leader run, autonomy loop, or SDD
    // run) still able to mutate the current session? `abortLeader` uses this
    // to decide what to stop; `isRunning` exposes it read-only so `/clear` can
    // confirm before wiping an active session.
    const isRunning = (): boolean => {
      const eternalEngine = getEternalEngine?.();
      const parallelEngine = getParallelEngine?.();
      const autonomyRunning =
        eternalLoopRunningRef.current ||
        parallelLoopRunningRef.current ||
        eternalEngine?.currentState === 'running' ||
        parallelEngine?.currentState === 'running';
      return (
        autonomyRunning ||
        (getSddRun?.()?.isRunning() ?? false) ||
        stateRef.current.status !== 'idle'
      );
    };

    const abortLeader = (): boolean => {
      let interrupted = false;
      const eternalEngine = getEternalEngine?.();
      const parallelEngine = getParallelEngine?.();
      const autonomyRunning =
        eternalLoopRunningRef.current ||
        parallelLoopRunningRef.current ||
        eternalEngine?.currentState === 'running' ||
        parallelEngine?.currentState === 'running';
      if (autonomyRunning) {
        eternalEngine?.stop();
        parallelEngine?.stop();
        switchAutonomy?.('off');
        interrupted = true;
      }

      const sddRun = getSddRun?.();
      if (sddRun?.isRunning()) {
        sddRun.stop();
        interrupted = true;
      }
      if (stateRef.current.status !== 'idle') {
        activeCtrlRef.current?.abort('user interrupt (/interrupt)');
        clearPendingConfirms();
        dispatch({ type: 'status', status: 'aborting' });
        interrupted = true;
      }
      return interrupted;
    };

    const resetSession = (): void => {
      sessionGenerationRef.current += 1;
      streamingTextRef.current = '';
      streamSegmentsRef.current = [];
      pendingDeltaRef.current = '';
      assistantCommittedThisRunRef.current = false;
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      dispatch({ type: 'streamReset' });
      dispatch({ type: 'toolStreamClear' });
      dispatch({ type: 'queueClear' });
      clearPendingConfirms();
    };

    interruptController.abortLeader = abortLeader;
    interruptController.isRunning = isRunning;
    interruptController.resetSession = resetSession;
    interruptController.waitForIdle = () => activeRunSettledRef.current;
    return () => {
      if (interruptController.abortLeader !== abortLeader) return;
      interruptController.abortLeader = () => false;
      interruptController.isRunning = () => false;
      interruptController.resetSession = () => {};
      interruptController.waitForIdle = async () => {};
    };
  }, [
    interruptController,
    dispatch,
    stateRef,
    clearPendingConfirms,
    getEternalEngine,
    getParallelEngine,
    getSddRun,
    switchAutonomy,
  ]);
}
