import { type Agent, loadGoal, resolveWstackPaths } from '@wrongstack/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as os from 'node:os';
import type { Action, State } from '../app-reducer.js';
import { type HeapSample, startHeapWatchdog, takeHeapSample } from '../heap-watchdog.js';
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
  useEffect(() => {
    if (prevStatusRef.current === status) return;

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
  }, [status]);

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
  // Reuse the existing 10s shell clock so diagnostics do not add another
  // timer or idle render loop just to refresh the status-line chip.
  const processMemory = useMemo<HeapSample>(() => takeHeapSample(), [nowTick]);
  // CPU usage percentage (0-100) for this Node.js process. Uses process.cpuUsage()
  // delta between ticks, normalized by elapsed wall-clock time and core count.
  // Works on all platforms (including Windows where os.loadavg() returns 0).
  // Reuse nowTick (10s clock) for refresh cadence.
  const cpuPrevRef = useRef<{ cpu: NodeJS.CpuUsage; time: bigint } | null>(null);
  const cpuPercent = useMemo<number | undefined>(() => {
    const now = process.hrtime.bigint();
    const cpuNow = process.cpuUsage();
    const prev = cpuPrevRef.current;
    cpuPrevRef.current = { cpu: cpuNow, time: now };
    if (!prev) return undefined; // First tick — no baseline yet
    const cpuDeltaUsec = (cpuNow.user - prev.cpu.user) + (cpuNow.system - prev.cpu.system);
    const wallMs = Number(now - prev.time) / 1e6;
    if (wallMs <= 0) return undefined;
    // cpuDeltaUsec is in microseconds; wall time in ms. Ratio gives core-utilization.
    const cores = os.cpus().length || 1;
    return Math.min(100, Math.round((cpuDeltaUsec / 1000) / wallMs / cores * 100));
  }, [nowTick]);
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
    startedAt: startedAtRef.current,
    nowTick,
    setNowTick,
    workingTimeMs,
    fleetWorkingTimeMs,
    processMemory,
    cpuPercent,
    enhanceDots,
    refreshGoalSummary,
  };
}
