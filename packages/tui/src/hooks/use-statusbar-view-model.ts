import * as fs from 'node:fs/promises';
import { type ContextBreakdown, getContextBreakdown } from '@wrongstack/core/utils';
import { useEffect, useMemo, useState } from 'react';
import type { AppProps } from '../app-props.js';
import type { FleetEntry, State } from '../app-state.js';

interface StatusbarViewModelOptions {
  agent: AppProps['agent'];
  tokenCounter: AppProps['tokenCounter'];
  activeMaxContext: number | undefined;
  effectiveMaxContext: number | undefined;
  liveProvider: string;
  liveModel: string;
  liveTodos: readonly { status: string }[];
  state: State;
}

interface PlanCounts {
  open: number;
  inProgress: number;
  done: number;
}

interface TaskCounts {
  pending: number;
  inProgress: number;
  completed: number;
  blocked: number;
  failed: number;
}

/** Builds status-bar projections without coupling them to the root App render. */
export function useStatusbarViewModel({
  agent,
  tokenCounter,
  activeMaxContext,
  effectiveMaxContext,
  liveProvider,
  liveModel,
  liveTodos,
  state,
}: StatusbarViewModelOptions): {
  contextBreakdown: ContextBreakdown | undefined;
  currentContextTokens: number;
  contextWindow: { used: number; max: number } | undefined;
  todos: { pending: number; inProgress: number; completed: number };
  fleetCounts: { running: number; idle: number; pending: number; completed: number } | undefined;
  visibleSubagentCount: number;
  hasVisibleFleetPanel: boolean;
  entriesWithLeader: Record<string, FleetEntry>;
  planCounts: PlanCounts | null;
  taskCounts: TaskCounts | null;
} {
  const maxContext = activeMaxContext ?? agent.ctx.provider.capabilities.maxContext;
  const perRequest = tokenCounter?.currentRequestTokens();
  const perRequestTokens =
    (perRequest?.input ?? 0) +
    (perRequest?.cacheRead ?? 0) +
    (perRequest?.cacheWrite ?? 0);
  const cumulative = tokenCounter?.total();
  const cumulativeTokens =
    (cumulative?.input ?? 0) +
    (cumulative?.cacheRead ?? 0) +
    (cumulative?.cacheWrite ?? 0);
  const providerReportedTokens = perRequestTokens > 0 ? perRequestTokens : cumulativeTokens;
  const needLocalEstimate = providerReportedTokens <= 0;

  const contextBreakdown = useMemo<ContextBreakdown | undefined>(() => {
    if (!state.contextPanelOpen && !needLocalEstimate) return undefined;
    try {
      return getContextBreakdown(agent.ctx);
    } catch {
      return undefined;
    }
  }, [agent.ctx, state.contextPanelOpen, needLocalEstimate, state.contextChipVersion]);

  const currentContextTokens = Math.min(
    providerReportedTokens > 0 ? providerReportedTokens : (contextBreakdown?.total ?? 0),
    maxContext,
  );
  const contextWindow = useMemo(() => {
    void state.contextChipVersion;
    return maxContext > 0 ? { used: currentContextTokens, max: maxContext } : undefined;
  }, [currentContextTokens, maxContext, state.contextChipVersion]);

  const todos = useMemo(() => {
    const counts = { pending: 0, inProgress: 0, completed: 0 };
    for (const todo of liveTodos) {
      if (todo.status === 'pending') counts.pending++;
      else if (todo.status === 'in_progress') counts.inProgress++;
      else if (todo.status === 'completed') counts.completed++;
    }
    return counts;
  }, [liveTodos]);

  const fleetCounts = useMemo(() => {
    const entries = Object.values(state.fleet);
    if (entries.length === 0) return undefined;
    const running = entries.filter((entry) => entry.status === 'running').length;
    return running > 0 ? { running, idle: 0, pending: 0, completed: 0 } : undefined;
  }, [state.fleet]);
  const visibleSubagentCount = fleetCounts?.running ?? 0;
  const hasVisibleFleetPanel = useMemo(
    () => Object.values(state.fleet).some((entry) => entry.status === 'running'),
    [state.fleet],
  );

  const entriesWithLeader = useMemo<Record<string, FleetEntry>>(() => {
    const leaderEntry: FleetEntry = {
      id: 'leader',
      name: 'LEADER',
      provider: liveProvider,
      model: liveModel,
      status:
        state.status === 'running' || state.status === 'streaming' || state.leader.iterating
          ? 'running'
          : 'idle',
      streamingText: '',
      iterations: state.leader.iterations,
      toolCalls: state.leader.toolCalls,
      recentTools: state.leader.recentTools,
      recentMessages: [],
      cost: tokenCounter?.estimateCost().total ?? 0,
      startedAt: state.leader.startedAt,
      lastEventAt: state.leader.lastEventAt,
      currentTool: state.leader.currentTool,
      ctxPct: state.leader.ctxPct,
      ctxTokens: state.leader.ctxTokens,
      ctxMaxTokens: state.leader.ctxMaxTokens ?? effectiveMaxContext,
    };
    return { leader: leaderEntry, ...state.fleet };
  }, [
    state.fleet,
    state.leader,
    state.status,
    liveProvider,
    liveModel,
    effectiveMaxContext,
    tokenCounter,
  ]);

  const [planCounts, setPlanCounts] = useState<PlanCounts | null>(null);
  useEffect(() => {
    const planPath = (agent.ctx.meta as Record<string, unknown>)['plan.path'];
    if (typeof planPath !== 'string' || !planPath) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await fs.readFile(planPath, 'utf8');
        const parsed = JSON.parse(data) as { items?: Array<{ status?: string | undefined }> };
        if (cancelled) return;
        if (!Array.isArray(parsed.items)) {
          setPlanCounts(null);
          return;
        }
        let open = 0;
        let inProgress = 0;
        let done = 0;
        for (const item of parsed.items) {
          if (item?.status === 'done') done++;
          else if (item?.status === 'in_progress') inProgress++;
          else open++;
        }
        setPlanCounts(open + inProgress + done > 0 ? { open, inProgress, done } : null);
      } catch {
        if (!cancelled) setPlanCounts(null);
      }
    };
    void poll();
    const id = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [agent.ctx.meta]);

  const [taskCounts, setTaskCounts] = useState<TaskCounts | null>(null);
  useEffect(() => {
    const taskPath = (agent.ctx.meta as Record<string, unknown>)['task.path'];
    if (typeof taskPath !== 'string' || !taskPath) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await fs.readFile(taskPath, 'utf8');
        const parsed = JSON.parse(data) as { tasks?: Array<{ status?: string | undefined }> };
        if (cancelled) return;
        if (!Array.isArray(parsed.tasks)) {
          setTaskCounts(null);
          return;
        }
        const counts: TaskCounts = {
          pending: 0,
          inProgress: 0,
          completed: 0,
          blocked: 0,
          failed: 0,
        };
        for (const task of parsed.tasks) {
          if (task?.status === 'completed') counts.completed++;
          else if (task?.status === 'in_progress') counts.inProgress++;
          else if (task?.status === 'blocked') counts.blocked++;
          else if (task?.status === 'failed') counts.failed++;
          else counts.pending++;
        }
        const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
        setTaskCounts(total > 0 ? counts : null);
      } catch {
        if (!cancelled) setTaskCounts(null);
      }
    };
    void poll();
    const id = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [agent.ctx.meta]);

  return {
    contextBreakdown,
    currentContextTokens,
    contextWindow,
    todos,
    fleetCounts,
    visibleSubagentCount,
    hasVisibleFleetPanel,
    entriesWithLeader,
    planCounts,
    taskCounts,
  };
}
