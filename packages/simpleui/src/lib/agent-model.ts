import type { AgentSessionReplay, AgentTranscriptEntry, SimpleSubagent } from '../types.js';

export const LEADER_AGENT_ID = 'leader';
const MAX_AGENT_TRANSCRIPT_ENTRIES = 500;

/**
 * How long an idle/offline worker stays visible before it is pruned from the
 * UI. Active (running/busy) agents are never pruned regardless of age.
 */
export const IDLE_AGENT_TTL_MS = 60_000;

/** Statuses that mean the agent is still doing work and must stay a live tab. */
const ACTIVE_STATUSES: ReadonlySet<string> = new Set(['running', 'busy', 'working', 'active']);

/** Statuses that mean the agent is gone and should be pruned once it ages out. */
const REMOVABLE_STATUSES: ReadonlySet<string> = new Set([
  'idle',
  'offline',
  'off',
  'stopped',
  'cancelled',
  'canceled',
]);

export function isActiveStatus(status: string): boolean {
  return ACTIVE_STATUSES.has(status.toLowerCase());
}

export interface AgentTab {
  id: string;
  name: string;
  status: string;
  task?: string | undefined;
  isLeader: boolean;
  /** true when running/busy — kept as a strip tab rather than in the dropdown. */
  isActive: boolean;
  /** Epoch ms of the last update, when known. */
  updatedAt?: number | undefined;
}

/** The leader is always first; workers retain their stable discovery order. */
export function buildAgentTabs(subagents: SimpleSubagent[], leaderRunning: boolean): AgentTab[] {
  return [
    {
      id: LEADER_AGENT_ID,
      name: 'LEADER',
      status: leaderRunning ? 'running' : 'idle',
      isLeader: true,
      isActive: true,
    },
    ...subagents.map((agent) => ({
      ...agent,
      isLeader: false,
      isActive: isActiveStatus(agent.status),
    })),
  ];
}

/**
 * Refresh `updatedAt` on agents whose identity is new or whose status changed
 * versus the previous list, leaving unchanged agents untouched so the idle TTL
 * measures time since the last *real* update, not every re-render.
 */
export function stampAgentUpdates(
  previous: SimpleSubagent[],
  next: SimpleSubagent[],
  now: number = Date.now(),
): SimpleSubagent[] {
  const before = new Map(previous.map((agent) => [agent.id, agent]));
  return next.map((agent) => {
    const prior = before.get(agent.id);
    if (prior && prior.status === agent.status && typeof prior.updatedAt === 'number') {
      return agent.updatedAt === prior.updatedAt ? agent : { ...agent, updatedAt: prior.updatedAt };
    }
    return { ...agent, updatedAt: now };
  });
}

/** Split worker tabs into live (strip) and finished (dropdown) groups. */
export function partitionAgentTabs(tabs: AgentTab[]): {
  active: AgentTab[];
  finished: AgentTab[];
} {
  const active: AgentTab[] = [];
  const finished: AgentTab[] = [];
  for (const tab of tabs) {
    if (tab.isLeader || tab.isActive) active.push(tab);
    else finished.push(tab);
  }
  return { active, finished };
}

/**
 * Drop idle/offline workers that haven't updated within the TTL so the strip
 * and dropdown don't accumulate agents no longer worth viewing. Agents without
 * a known `updatedAt` are treated as freshly seen (kept) to avoid pruning a
 * worker before its first timestamped update lands.
 */
export function pruneAgents(
  subagents: SimpleSubagent[],
  now: number,
  ttlMs: number = IDLE_AGENT_TTL_MS,
): SimpleSubagent[] {
  return subagents.filter((agent) => {
    if (isActiveStatus(agent.status)) return true;
    if (!REMOVABLE_STATUSES.has(agent.status.toLowerCase())) return true;
    if (typeof agent.updatedAt !== 'number') return true;
    return now - agent.updatedAt < ttlMs;
  });
}

/** Keep the current tab when it still exists, otherwise fall back to the leader. */
export function resolveSelectedAgentId(selectedId: string, tabs: AgentTab[]): string {
  return tabs.some((tab) => tab.id === selectedId) ? selectedId : LEADER_AGENT_ID;
}

export function canComposeForAgent(selectedId: string): boolean {
  return selectedId === LEADER_AGENT_ID;
}

/**
 * Coordinator snapshots describe what is live now, not the complete UI history.
 * Merge them so completed/retired agent tabs and their transcripts stay reachable.
 */
export function mergeSubagentSnapshot(
  current: SimpleSubagent[],
  snapshot: SimpleSubagent[],
): SimpleSubagent[] {
  const incoming = new Map(snapshot.map((agent) => [agent.id, agent]));
  const merged = current.map((agent) => {
    const update = incoming.get(agent.id);
    if (!update) return agent;
    incoming.delete(agent.id);
    return { ...agent, ...update };
  });
  return [...merged, ...incoming.values()];
}

/** Append one event without letting duplicate delivery or long runs grow unbounded. */
export function appendAgentTranscriptEntry(
  current: AgentTranscriptEntry[],
  entry: AgentTranscriptEntry,
): AgentTranscriptEntry[] {
  const previous = current.at(-1);
  if (
    previous?.content === entry.content &&
    previous.kind === entry.kind &&
    previous.toolName === entry.toolName
  ) {
    return [...current.slice(0, -1), { ...previous, ts: entry.ts }];
  }
  return [...current, entry].slice(-MAX_AGENT_TRANSCRIPT_ENTRIES);
}

function parseTranscriptEntry(value: unknown, fallbackId: string): AgentTranscriptEntry | null {
  if (!value || typeof value !== 'object') return null;
  return projectAgentTimelineEntry(value as Record<string, unknown>, fallbackId);
}

/**
 * Which timeline entry kinds are worth showing the user on a fresh page load.
 * Tool calls, debug status updates, and system/error spam from a long-ago
 * worker make a chat history noisy without adding comprehension; keep only the
 * conversational surface and surface errors as plain messages.
 */
const REPLAY_VISIBLE_KINDS: ReadonlySet<AgentTranscriptEntry['kind']> = new Set([
  'text',
  'thinking',
  'error',
]);

/** Maximum curated entries retained per agent on F5/reconnect. */
const REPLAY_ENTRIES_PER_AGENT = 64;

export function parseAgentSessionReplays(value: unknown): AgentSessionReplay[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  return value.flatMap((rawSession, sessionIndex) => {
    if (!rawSession || typeof rawSession !== 'object') return [];
    const session = rawSession as Record<string, unknown>;
    const subagentId =
      typeof session['subagentId'] === 'string' ? session['subagentId'].trim() : '';
    if (!subagentId || subagentId === LEADER_AGENT_ID) return [];
    const agentName =
      typeof session['agentName'] === 'string' && session['agentName'].trim()
        ? session['agentName'].trim()
        : subagentId;
    if (!Array.isArray(session['transcript'])) return [];
    const transcript: AgentTranscriptEntry[] = [];
    for (let index = 0; index < session['transcript'].length; index++) {
      const parsed = parseTranscriptEntry(
        (session['transcript'] as unknown[])[index],
        `replay-${sessionIndex}-${index}`,
      );
      if (!parsed || !REPLAY_VISIBLE_KINDS.has(parsed.kind)) continue;
      transcript.push({ ...parsed, subagentId, agentName });
    }
    if (transcript.length === 0) return [];
    const trimmed = transcript.slice(-REPLAY_ENTRIES_PER_AGENT);
    return [
      {
        subagentId,
        agentName,
        status: typeof session['status'] === 'string' ? session['status'] : 'idle',
        task: typeof session['task'] === 'string' ? session['task'] : undefined,
        transcript: trimmed,
      } satisfies AgentSessionReplay,
    ];
  });
}

export function projectAgentTimelineEntry(
  payload: Record<string, unknown>,
  fallbackId: string,
): AgentTranscriptEntry | null {
  const subagentId = typeof payload['subagentId'] === 'string' ? payload['subagentId'].trim() : '';
  const content = typeof payload['content'] === 'string' ? payload['content'].trim() : '';
  if (!subagentId || subagentId === LEADER_AGENT_ID || !content) return null;

  const rawKind = typeof payload['kind'] === 'string' ? payload['kind'] : 'status';
  const kind: AgentTranscriptEntry['kind'] = [
    'text',
    'thinking',
    'tool_use',
    'tool_result',
    'error',
    'status',
    'system',
  ].includes(rawKind)
    ? (rawKind as AgentTranscriptEntry['kind'])
    : 'status';

  return {
    id: fallbackId,
    subagentId,
    agentName:
      typeof payload['agentName'] === 'string' && payload['agentName'].trim()
        ? payload['agentName'].trim()
        : subagentId,
    content,
    kind,
    iteration:
      typeof payload['iteration'] === 'number' && Number.isFinite(payload['iteration'])
        ? payload['iteration']
        : 0,
    ts:
      typeof payload['ts'] === 'string' && payload['ts'] ? payload['ts'] : new Date().toISOString(),
    toolName: typeof payload['toolName'] === 'string' ? payload['toolName'] : undefined,
    toolOk: typeof payload['toolOk'] === 'boolean' ? payload['toolOk'] : undefined,
  };
}

/** Recover the final answer even when the richer timeline monitor is unavailable. */
export function projectCompletedAgentText(
  payload: Record<string, unknown>,
  fallbackId: string,
  agentName: string,
): AgentTranscriptEntry | null {
  const subagentId = typeof payload['subagentId'] === 'string' ? payload['subagentId'].trim() : '';
  const content = typeof payload['finalText'] === 'string' ? payload['finalText'].trim() : '';
  if (!subagentId || subagentId === LEADER_AGENT_ID || !content) return null;
  return {
    id: fallbackId,
    subagentId,
    agentName,
    content,
    kind: 'text',
    iteration:
      typeof payload['iterations'] === 'number' && Number.isFinite(payload['iterations'])
        ? payload['iterations']
        : 0,
    ts: new Date().toISOString(),
  };
}
