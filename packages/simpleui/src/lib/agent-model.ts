import type { AgentSessionReplay, AgentTranscriptEntry, SimpleSubagent } from '../types.js';

export const LEADER_AGENT_ID = 'leader';
const MAX_AGENT_TRANSCRIPT_ENTRIES = 500;

export interface AgentTab {
  id: string;
  name: string;
  status: string;
  task?: string | undefined;
  isLeader: boolean;
}

/** The leader is always first; workers retain their stable discovery order. */
export function buildAgentTabs(subagents: SimpleSubagent[], leaderRunning: boolean): AgentTab[] {
  return [
    {
      id: LEADER_AGENT_ID,
      name: 'LEADER',
      status: leaderRunning ? 'running' : 'idle',
      isLeader: true,
    },
    ...subagents.map((agent) => ({ ...agent, isLeader: false })),
  ];
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

export function parseAgentSessionReplays(value: unknown): AgentSessionReplay[] {
  if (!Array.isArray(value)) return [];
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
    const transcript = Array.isArray(session['transcript'])
      ? session['transcript'].flatMap((entry, entryIndex) => {
          const parsed = parseTranscriptEntry(entry, `replay-${sessionIndex}-${entryIndex}`);
          return parsed ? [{ ...parsed, subagentId, agentName }] : [];
        })
      : [];
    return [
      {
        subagentId,
        agentName,
        status: typeof session['status'] === 'string' ? session['status'] : 'idle',
        task: typeof session['task'] === 'string' ? session['task'] : undefined,
        transcript,
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
