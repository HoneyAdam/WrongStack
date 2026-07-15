import { type Agent, loadGoal, resolveWstackPaths } from '@wrongstack/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Action, State } from '../app-reducer.js';
import { startHeapWatchdog } from '../heap-watchdog.js';
import { isRandomTuiThinkingWord, pickRandomTuiThinkingWord } from '../thinking-word.js';

export interface UseTuiActivityOptions {
  status: State['status'];
  fleet: State['fleet'];
  enhanceBusy: boolean;
  thinkingWord: string;
  projectRoot: string;
  stateRef: React.RefObject<State>;
  agentContext: Agent['ctx'];
  dispatch: React.Dispatch<Action>;
}

/**
 * Own the clocks and lightweight activity animation state used by the TUI
 * shell. Keeping these related timers together prevents the app component
 * from accumulating another cluster of lifecycle bookkeeping.
 */
export function useTuiActivity({
  status,
  fleet,
  enhanceBusy,
  thinkingWord,
  projectRoot,
  stateRef,
  agentContext,
  dispatch,
}: UseTuiActivityOptions) {
  const [rolledThinkingWord, setRolledThinkingWord] = useState(() => pickRandomTuiThinkingWord());
  const thinkingWorking = status === 'running' || status === 'streaming';
  const prevThinkingWorkingRef = useRef(false);
  useEffect(() => {
    if (thinkingWorking && !prevThinkingWorkingRef.current) {
      setRolledThinkingWord((previous) => pickRandomTuiThinkingWord(previous));
    }
    prevThinkingWorkingRef.current = thinkingWorking;
  }, [thinkingWorking]);

  const displayThinkingWord = isRandomTuiThinkingWord(thinkingWord)
    ? rolledThinkingWord
    : thinkingWord;
  const displayThinkingWordRef = useRef(displayThinkingWord);
  displayThinkingWordRef.current = displayThinkingWord;

  // Global clock tick. Deliberately slow (10s). Detail panels own their
  // faster clocks; this tick feeds monitor overlays and todo snapshots.
  const startedAtRef = useRef(Date.now());
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

  // Track foreground agent working time across running/streaming spells.
  const [workingTimeBase, setWorkingTimeBase] = useState(0);
  const workingStartRef = useRef<number | null>(null);
  const prevStatusRef = useRef(status);
  if (prevStatusRef.current !== status) {
    const wasWorking = prevStatusRef.current === 'running' || prevStatusRef.current === 'streaming';
    const isWorking = status === 'running' || status === 'streaming';
    if (wasWorking && !isWorking) {
      const delta = Date.now() - (workingStartRef.current ?? Date.now());
      workingStartRef.current = null;
      setWorkingTimeBase((base) => base + delta);
    } else if (!wasWorking && isWorking) {
      workingStartRef.current = Date.now();
    }
    prevStatusRef.current = status;
  }

  const [workingTimeMs, setWorkingTimeMs] = useState(0);
  useEffect(() => {
    const isWorking = status === 'running' || status === 'streaming';
    if (!isWorking) return;
    const tick = () => {
      const elapsed =
        workingStartRef.current === null
          ? workingTimeBase
          : workingTimeBase + (Date.now() - workingStartRef.current);
      setWorkingTimeMs(elapsed);
    };
    tick();
    const timer = setInterval(tick, 1_000);
    return () => clearInterval(timer);
  }, [status, workingTimeBase]);

  // Track the time during which at least one background fleet entry is active.
  const [fleetWorkingBase, setFleetWorkingBase] = useState(0);
  const fleetWorkingStartRef = useRef<number | null>(null);
  const prevFleetRunningRef = useRef(0);
  useEffect(() => {
    const running = Object.values(fleet).filter((entry) => entry.status === 'running').length;
    if (prevFleetRunningRef.current === running) return;

    const wasRunning = prevFleetRunningRef.current > 0;
    const isRunning = running > 0;
    if (wasRunning && !isRunning) {
      const delta = Date.now() - (fleetWorkingStartRef.current ?? Date.now());
      fleetWorkingStartRef.current = null;
      setFleetWorkingBase((base) => base + delta);
    } else if (!wasRunning && isRunning) {
      fleetWorkingStartRef.current = Date.now();
    }
    prevFleetRunningRef.current = running;
  }, [fleet]);

  const [fleetWorkingTimeMs, setFleetWorkingTimeMs] = useState(0);
  useEffect(() => {
    const running = Object.values(fleet).some((entry) => entry.status === 'running');
    if (!running) return;
    const tick = () => {
      const elapsed =
        fleetWorkingStartRef.current === null
          ? fleetWorkingBase
          : fleetWorkingBase + (Date.now() - fleetWorkingStartRef.current);
      setFleetWorkingTimeMs(elapsed);
    };
    tick();
    const timer = setInterval(tick, 1_000);
    return () => clearInterval(timer);
  }, [fleet, fleetWorkingBase]);

  // Attribute long-session heap growth before V8 reaches its hard limit.
  useEffect(() => {
    const approxChars = (value: unknown): number => {
      try {
        return JSON.stringify(value)?.length ?? 0;
      } catch {
        return -1;
      }
    };
    return startHeapWatchdog({
      collectStats: () => ({
        historyEntries: stateRef.current.entries.length,
        historyChars: approxChars(stateRef.current.entries),
        messages: agentContext.state.messages.length,
        messagesChars: approxChars(agentContext.state.messages),
        runningTools: stateRef.current.runningTools.size,
        stdoutQueued: process.stdout.writableLength ?? 0,
      }),
      onWarn: (level, message) => {
        dispatch({
          type: 'addEntry',
          entry: { kind: level === 'critical' ? 'error' : 'warn', text: message },
        });
      },
    });
  }, [agentContext, dispatch, stateRef]);

  const refreshGoalSummary = useCallback(() => {
    if (!projectRoot) return;
    const goalPath = resolveWstackPaths({ projectRoot }).projectGoal;
    loadGoal(goalPath)
      .then((goal) => {
        if (!goal) {
          dispatch({ type: 'goalSummary', summary: null });
          return;
        }
        const lastEntry = goal.journal?.[goal.journal.length - 1];
        dispatch({
          type: 'goalSummary',
          summary: {
            goal: goal.goal,
            refinedGoal: goal.refinedGoal,
            goalState: goal.goalState ?? 'active',
            iterations: goal.iterations,
            progress: goal.progress,
            progressNote: goal.progressNote,
            progressTrend: goal.progressTrend,
            deliverables: goal.deliverables,
            lastTask: lastEntry?.task,
            lastStatus: lastEntry?.status,
          },
        });
      })
      .catch(() => {
        // Unreadable or partially written goal files leave the prior summary intact.
      });
  }, [dispatch, projectRoot]);

  useEffect(() => {
    refreshGoalSummary();
  }, [nowTick, refreshGoalSummary]);

  const [enhanceDots, setEnhanceDots] = useState(0);
  useEffect(() => {
    if (!enhanceBusy) return;
    const timer = setInterval(() => setEnhanceDots((value) => (value + 1) % 36), 400);
    return () => clearInterval(timer);
  }, [enhanceBusy]);

  return {
    displayThinkingWord,
    displayThinkingWordRef,
    startedAt: startedAtRef.current,
    nowTick,
    setNowTick,
    workingTimeMs,
    fleetWorkingTimeMs,
    enhanceDots,
    refreshGoalSummary,
  };
}
