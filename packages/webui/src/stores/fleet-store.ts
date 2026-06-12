import { create } from 'zustand';
import type { FleetTimelineEvent, SubagentView, SubagentEvent } from './types.js';

// ── Fleet store (live subagent roster; not persisted) ───────────────────────

const SPARKLINE_BINS = 12;
const MAX_TIMELINE = 20;

interface FleetState {
  agents: Map<string, SubagentView>;
  /** Current leader agent ID (set via leader_updated event). */
  leaderId: string | undefined;
  /** Fleet-wide aggregated tokens (sum of all agent tokens). */
  fleetTokensIn: number;
  fleetTokensOut: number;
  /** Current / max concurrency from server. */
  fleetConcurrency: number;
  fleetConcurrencyMax: number;
  /** Last 20 fleet events for the Fleet Monitor timeline. */
  eventTimeline: FleetTimelineEvent[];
  applyEvent: (e: SubagentEvent) => void;
  clear: () => void;
  /** Return all agents belonging to a session. Used for project-scoped filtering. */
  getAgentsBySession: (sessionId: string) => SubagentView[];
}

function blankAgent(id: string, name?: string, sessionId?: string): SubagentView {
  return {
    id,
    name: name?.trim() || id,
    sessionId,
    status: 'running',
    iteration: 0,
    toolCalls: 0,
    costUsd: 0,
    ctxPct: 0,
    ctxTokens: 0,
    maxContext: 0,
    extensions: 0,
    startedAt: Date.now(),
    toolLog: [],
    sparklineBins: Array(SPARKLINE_BINS).fill(0),
  };
}

let _timelineSeq = 0;
function makeTimelineId(): string {
  return `tl_${Date.now()}_${++_timelineSeq}`;
}

function pushTimeline(
  timeline: FleetTimelineEvent[],
  event: FleetTimelineEvent,
): FleetTimelineEvent[] {
  return [event, ...timeline].slice(0, MAX_TIMELINE);
}

/** Update sparkline bins for an agent — bump bin 0 and shift left.
 *  The bins array has index 0 as the most recent bucket.
 *  Each event bumps bin 0, then the array is truncated to SPARKLINE_BINS. */
function bumpSparkline(bins: number[]): number[] {
  return [bins[0] + 1, ...bins.slice(0, SPARKLINE_BINS - 1)];
}

export const useFleetStore = create<FleetState>()((set, get) => ({
  agents: new Map(),
  leaderId: undefined,
  fleetTokensIn: 0,
  fleetTokensOut: 0,
  fleetConcurrency: 0,
  fleetConcurrencyMax: 4,
  eventTimeline: [],
  clear: () =>
    set({
      agents: new Map(),
      leaderId: undefined,
      fleetTokensIn: 0,
      fleetTokensOut: 0,
      fleetConcurrency: 0,
      eventTimeline: [],
    }),
  getAgentsBySession: (sessionId) => {
    const result: SubagentView[] = [];
    for (const a of get().agents.values()) {
      if (a.sessionId === sessionId) result.push(a);
    }
    return result;
  },
  applyEvent: (e) =>
    set((state) => {
      const agents = new Map(state.agents);
      let timeline = state.eventTimeline;
      let leaderId = state.leaderId;
      let fleetTokensIn = state.fleetTokensIn;
      let fleetTokensOut = state.fleetTokensOut;

      // session_stopped carries a sessionId instead of subagentId —
      // remove ALL agents belonging to that session.
      if (e.kind === 'session_stopped' && e.sessionId) {
        for (const [id, agent] of agents) {
          if (agent.sessionId === e.sessionId) agents.delete(id);
        }
        return { agents, leaderId: undefined, fleetTokensIn: 0, fleetTokensOut: 0 };
      }

      // leader_updated: mark the new leader and demote the old one.
      if (e.kind === 'leader_updated' && e.subagentId) {
        const prevLeaderId = state.leaderId;
        if (prevLeaderId && prevLeaderId !== e.subagentId) {
          const prevLeader = agents.get(prevLeaderId);
          if (prevLeader) agents.set(prevLeaderId, { ...prevLeader, isLeader: false });
        }
        leaderId = e.subagentId;
        const leader = agents.get(e.subagentId) ?? blankAgent(e.subagentId, e.name, e.sessionId);
        agents.set(e.subagentId, { ...leader, isLeader: true, name: e.name?.trim() || leader.name });
        timeline = pushTimeline(timeline, {
          id: makeTimelineId(),
          kind: 'leader_updated',
          agentId: e.subagentId,
          agentName: e.name ?? leaderId,
          timestamp: Date.now(),
          message: `${e.name ?? e.subagentId} became leader`,
        });
        return { agents, leaderId, eventTimeline: timeline };
      }

      // Every other event kind addresses a single agent — without an id
      // there is nothing to upsert (malformed/partial payload).
      if (!e.subagentId) return state;

      const prev = agents.get(e.subagentId) ?? blankAgent(e.subagentId, e.name, e.sessionId);
      const next: SubagentView = { ...prev };
      const now = Date.now();

      switch (e.kind) {
        case 'spawned':
          next.name = e.name?.trim() || next.name;
          next.provider = e.provider ?? next.provider;
          next.model = e.model ?? next.model;
          next.description = e.description ?? next.description;
          next.taskId = e.taskId ?? next.taskId;
          next.sessionId = e.sessionId ?? next.sessionId;
          next.status = 'running';
          next.sparklineBins = Array(SPARKLINE_BINS).fill(0);
          timeline = pushTimeline(timeline, {
            id: makeTimelineId(),
            kind: 'spawned',
            agentId: e.subagentId,
            agentName: next.name,
            timestamp: now,
            message: `${next.name} spawned`,
          });
          break;
        case 'task_started':
          next.description = e.description ?? next.description;
          next.taskId = e.taskId ?? next.taskId;
          next.status = 'running';
          timeline = pushTimeline(timeline, {
            id: makeTimelineId(),
            kind: 'task_started',
            agentId: e.subagentId,
            agentName: next.name,
            timestamp: now,
            message: `${next.name} started: ${e.description ?? 'new task'}`,
          });
          break;
        case 'tool_executed': {
          const ok = typeof e.ok === 'boolean' ? e.ok : true;
          const dur = typeof e.durationMs === 'number' ? e.durationMs : 0;
          next.lastTool = e.toolName ?? next.lastTool;
          next.toolCalls = next.toolCalls + 1;
          // Prepend to tool log, cap at 50
          next.toolLog = [
            { name: e.toolName ?? 'unknown', ok, durationMs: dur, at: now },
            ...next.toolLog,
          ].slice(0, 50);
          // Bump sparkline
          next.sparklineBins = bumpSparkline(next.sparklineBins);
          timeline = pushTimeline(timeline, {
            id: makeTimelineId(),
            kind: 'tool_executed',
            agentId: e.subagentId,
            agentName: next.name,
            timestamp: now,
            message: `${next.name} ${ok ? '✓' : '✗'} ${e.toolName ?? 'tool'}`,
            value: dur,
          });
          break;
        }
        case 'iteration_summary':
          next.iteration = e.iteration ?? next.iteration;
          if (typeof e.toolCalls === 'number') next.toolCalls = e.toolCalls;
          if (typeof e.costUsd === 'number') next.costUsd = e.costUsd;
          next.currentTool = e.currentTool ?? next.currentTool;
          if (typeof e.partialText === 'string' && e.partialText) {
            next.partialText = e.partialText;
          }
          // Bump sparkline on iteration
          next.sparklineBins = bumpSparkline(next.sparklineBins);
          timeline = pushTimeline(timeline, {
            id: makeTimelineId(),
            kind: 'iteration_summary',
            agentId: e.subagentId,
            agentName: next.name,
            timestamp: now,
            message: `${next.name} iter ${e.iteration ?? next.iteration} · ${e.currentTool ? `${e.currentTool}` : ''}`,
            value: e.costUsd,
          });
          break;
        case 'budget_extended':
          next.extensions = e.totalExtensions ?? next.extensions + 1;
          // Clear any stale budget warning — the extension resolved it
          next.budgetWarning = undefined;
          timeline = pushTimeline(timeline, {
            id: makeTimelineId(),
            kind: 'budget_extended',
            agentId: e.subagentId,
            agentName: next.name,
            timestamp: now,
            message: `${next.name} extended budget ⚡×${next.extensions}`,
          });
          break;
        case 'ctx_pct':
          // Note: we do NOT cap load at 1.0 here — values > 100% are valid when the
          // agent is over context limit. The rendering side (ContextFillBar / visual bar)
          // clamps the visual fill independently so it doesn't overflow the viewport.
          next.ctxPct = Math.round(Math.max(0, e.load ?? 0) * 100);
          next.ctxTokens = e.tokens ?? next.ctxTokens;
          next.maxContext = e.maxContext ?? next.maxContext;

          // Derive a budget_warning when the agent crosses 80% context fill.
          // This matches the TUI's warn threshold behaviour. budget_extended
          // clears the warning, so it only fires once until the next extension.
          if (next.ctxPct >= 80 && !next.budgetWarning) {
            next.budgetWarning = next.ctxPct >= 100
              ? { kind: 'hard', used: next.ctxPct, limit: 100 }
              : { kind: 'soft', used: next.ctxPct, limit: 100 };
          }

          if (typeof e.costUsd === 'number') next.costUsd = e.costUsd;
          if (typeof e.tokensIn === 'number') {
            next.tokensIn = e.tokensIn;
            fleetTokensIn = fleetTokensIn - (prev.tokensIn ?? 0) + e.tokensIn;
          }
          if (typeof e.tokensOut === 'number') {
            next.tokensOut = e.tokensOut;
            fleetTokensOut = fleetTokensOut - (prev.tokensOut ?? 0) + e.tokensOut;
          }
          timeline = pushTimeline(timeline, {
            id: makeTimelineId(),
            kind: 'ctx_pct',
            agentId: e.subagentId,
            agentName: next.name,
            timestamp: now,
            message: `${next.name} ctx ${next.ctxPct}%`,
            value: next.ctxPct,
          });
          break;
        case 'task_completed': {
          const finalStatus = e.status === 'success' ? 'completed' : (e.status ?? 'completed');
          next.status = finalStatus;
          if (typeof e.iterations === 'number') next.iteration = e.iterations;
          if (typeof e.toolCalls === 'number') next.toolCalls = e.toolCalls;
          next.error = e.error;
          next.currentTool = undefined;
          next.completedAt = now;
          next.failureReason = e.failureReason ?? next.failureReason;
          if (typeof e.finalText === 'string' && e.finalText) {
            next.finalText = e.finalText;
          }
          const statusLabel = e.status === 'success'
            ? '✓ completed'
            : e.status === 'failed'
              ? `✗ failed${e.failureReason ? ` (${e.failureReason})` : ''}`
              : e.status === 'timeout'
                ? `⏱ timeout${e.failureReason ? ` (${e.failureReason})` : ''}`
                : 'stopped';
          timeline = pushTimeline(timeline, {
            id: makeTimelineId(),
            kind: 'task_completed',
            agentId: e.subagentId,
            agentName: next.name,
            timestamp: now,
            message: `${next.name} ${statusLabel}`,
            value: next.costUsd,
          });
          break;
        }
      }
      agents.set(e.subagentId, next);
      return { agents, leaderId, fleetTokensIn, fleetTokensOut, eventTimeline: timeline };
    }),
}));
