import type { Agent } from '@wrongstack/core/agent';
import { loadGoal } from '@wrongstack/core/storage';
import { resolveWstackPaths } from '@wrongstack/core/utils';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as os from 'node:os';
import type { Action, State } from '../app-reducer.js';
import { type HeapSample, startHeapWatchdog, takeHeapSample } from '../heap-watchdog.js';
import { useAnimation } from '../ink.js';
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
  const fleetRunningCount = useMemo(
    () => Object.values(fleet).filter((entry) => entry.status === 'running').length,
    [fleet],
  );

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

  // Track the time during which at least one background fleet entry is active.
  const [fleetWorkingBase, setFleetWorkingBase] = useState(0);
  const fleetWorkingStartRef = useRef<number | null>(null);
  const prevFleetRunningRef = useRef(0);
  useEffect(() => {
    const running = fleetRunningCount;
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
  }, [fleetRunningCount]);

  // Foreground and fleet elapsed clocks used to own independent 1s intervals,
  // causing two root renders per second whenever both were active. One shared
  // Ink animation tick is sufficient to derive both values.
  const timingActive = thinkingWorking || fleetRunningCount > 0;
  const { frame: timingFrame } = useAnimation({ interval: 1_000, isActive: timingActive });
  void timingFrame;
  const timingNow = Date.now();
  const workingTimeMs =
    workingStartRef.current === null
      ? workingTimeBase
      : workingTimeBase + (timingNow - workingStartRef.current);
  const fleetWorkingTimeMs =
    fleetWorkingStartRef.current === null
      ? fleetWorkingBase
      : fleetWorkingBase + (timingNow - fleetWorkingStartRef.current);

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
    const stopHeapWatchdog = startHeapWatchdog({
      collectStats: () => ({
        // Keep this slice to shallow cardinalities: serializing the full
        // retained graphs created a second allocation spike precisely when
        // the heap was already high.
        historyEntries: stateRef.current.entries.length,
        messages: agentContext.state.messages.length,
        runningTools: stateRef.current.runningTools.size,
        stdoutQueued: process.stdout.writableLength ?? 0,
        fleetSize: Object.keys(stateRef.current.fleet ?? {}).length,
        queued: stateRef.current.queue?.length ?? 0,
        inputHistory: stateRef.current.inputHistory?.length ?? 0,
      }),
      onWarn: (level, message) => {
        dispatch({
          type: 'addEntry',
          entry: { kind: level === 'critical' ? 'error' : 'warn', text: message },
        });
      },
    });
    return () => {
      void stopHeapWatchdog();
    };
  }, [agentContext, dispatch, stateRef]);

  const goalSummaryFingerprintRef = useRef<string | undefined>(undefined);
  const goalSummaryGenerationRef = useRef(0);
  const refreshGoalSummary = useCallback(() => {
    const generation = ++goalSummaryGenerationRef.current;
    if (!projectRoot) return;
    const goalPath = resolveWstackPaths({ projectRoot }).projectGoal;
    loadGoal(goalPath)
      .then((goal) => {
        if (generation !== goalSummaryGenerationRef.current) return;
        if (!goal) {
          if (goalSummaryFingerprintRef.current === 'null') return;
          goalSummaryFingerprintRef.current = 'null';
          dispatch({ type: 'goalSummary', summary: null });
          return;
        }
        const lastEntry = goal.journal?.[goal.journal.length - 1];
        const summary = {
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
        };
        const fingerprint = JSON.stringify(summary);
        if (goalSummaryFingerprintRef.current === fingerprint) return;
        goalSummaryFingerprintRef.current = fingerprint;
        dispatch({
          type: 'goalSummary',
          summary,
        });
      })
      .catch(() => {
        // Unreadable or partially written goal files leave the prior summary intact.
      });
  }, [dispatch, projectRoot]);

  useEffect(() => {
    refreshGoalSummary();
  }, [nowTick, refreshGoalSummary]);

  const { frame: enhanceFrame } = useAnimation({ interval: 1_000, isActive: enhanceBusy });
  const enhanceDots = enhanceFrame % 36;

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
