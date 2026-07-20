/**
 * Retain recently-finished fleet agents so the office shows the outcome of a
 * completed worker (break-room seat or errored desk) even after the backend
 * reaps the agent from the live roster. The retention map is module-scoped to
 * a single useRef so its identity is stable across re-renders, which keeps the
 * caller-side `useMemo` cheap to recompute only when the fleet roster changes.
 */

import { useRef } from 'react';
import type { SubagentView } from '@/stores/types.js';
import {
  FINISHED_AGENT_GRACE_MS,
  type FinishedFleetAgent,
} from './resolve.js';

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'failed',
  'timeout',
  'stopped',
]);

export interface RecentlyFinishedFleetAgents {
  readonly map: Map<string, FinishedFleetAgent>;
  /**
   * Wall-clock instant captured at the same point in the render as the
   * retention prune below. Pass to {@link resolveClients} so the resolver's
   * `now - entry.finishedAt` arithmetic uses the same clock and not a fresh
   * `Date.now()` captured microseconds later inside the memo.
   */
  readonly now: number;
}

export function useRecentlyFinishedFleetAgents(
  fleetAgents: Map<string, SubagentView>,
): RecentlyFinishedFleetAgents {
  const retained = useRef<Map<string, FinishedFleetAgent>>(new Map()).current;
  const now = Date.now();

  // Track every agent the fleet store currently exposes. Terminal entries get
  // recorded; running entries evict any prior retention so a respawned agent
  // doesn't show as a stale break-room seat.
  const seen = new Set<string>();
  for (const agent of fleetAgents.values()) {
    seen.add(agent.id);
    if (TERMINAL_STATUSES.has(agent.status)) {
      const prev = retained.get(agent.id);
      if (prev) {
        prev.agent = agent;
      } else {
        retained.set(agent.id, {
          agent,
          finishedAt: agent.completedAt ?? now,
        });
      }
    } else {
      retained.delete(agent.id);
    }
  }

  // Record agents that vanished from the roster while we last saw them — they
  // were reaped (stopped) before reaching a terminal status. Session-stopped
  // ghosts are skipped later by `resolveClients` because no live client
  // matches their sessionId leaf.
  for (const [id, entry] of [...retained.entries()]) {
    if (!seen.has(id) && !TERMINAL_STATUSES.has(entry.agent.status)) {
      retained.set(id, {
        agent: { ...entry.agent, status: 'stopped' },
        finishedAt: entry.finishedAt,
      });
    }
  }

  // Prune expired entries — they're past the grace window and would just be
  // ignored by `resolveClients` anyway, but trimming keeps the map small.
  for (const [id, entry] of retained) {
    if (now - entry.finishedAt > FINISHED_AGENT_GRACE_MS) {
      retained.delete(id);
    }
  }

  return { map: retained, now };
}