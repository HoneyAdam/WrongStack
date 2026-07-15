import { describe, expect, it } from 'vitest';
import {
  appendAgentTranscriptEntry,
  buildAgentTabs,
  canComposeForAgent,
  mergeSubagentSnapshot,
  parseAgentSessionReplays,
  projectAgentTimelineEntry,
  projectCompletedAgentText,
  resolveSelectedAgentId,
} from '../src/lib/agent-model.js';
import type { AgentTranscriptEntry, SimpleSubagent } from '../src/types.js';

const workers: SimpleSubagent[] = [
  { id: 'spawn-1', name: 'BUG HUNTER', status: 'running', task: 'Find the bug' },
  { id: 'delegate-1', name: 'REVIEWER', status: 'idle', task: 'Review the patch' },
];

function entry(overrides: Partial<AgentTranscriptEntry> = {}): AgentTranscriptEntry {
  return {
    id: 'entry-1',
    subagentId: 'spawn-1',
    agentName: 'BUG HUNTER',
    content: 'Found it',
    kind: 'text',
    iteration: 2,
    ts: '2026-07-15T12:00:00.000Z',
    ...overrides,
  };
}

describe('SimpleUI agent tabs', () => {
  it('always includes the main leader before concurrent spawned and delegated agents', () => {
    expect(buildAgentTabs(workers, true)).toEqual([
      expect.objectContaining({ id: 'leader', name: 'LEADER', status: 'running', isLeader: true }),
      expect.objectContaining({ id: 'spawn-1', name: 'BUG HUNTER', isLeader: false }),
      expect.objectContaining({ id: 'delegate-1', name: 'REVIEWER', isLeader: false }),
    ]);
  });

  it('keeps a valid selected worker and falls back to leader only when it disappears', () => {
    const tabs = buildAgentTabs(workers, false);
    expect(resolveSelectedAgentId('delegate-1', tabs)).toBe('delegate-1');
    expect(resolveSelectedAgentId('retired-agent', tabs)).toBe('leader');
  });

  it('allows composing only on the leader tab', () => {
    expect(canComposeForAgent('leader')).toBe(true);
    expect(canComposeForAgent('spawn-1')).toBe(false);
    expect(canComposeForAgent('delegate-1')).toBe(false);
  });

  it('merges live snapshots without dropping completed tab metadata or changing order', () => {
    const previous = [...workers, { id: 'finished-1', name: 'OLD REVIEWER', status: 'completed' }];
    const next = mergeSubagentSnapshot(previous, [
      { id: 'delegate-1', name: 'REVIEWER', status: 'running', task: 'Second pass' },
      { id: 'spawn-2', name: 'SECURITY', status: 'running' },
    ]);

    expect(next.map((agent) => agent.id)).toEqual([
      'spawn-1',
      'delegate-1',
      'finished-1',
      'spawn-2',
    ]);
    expect(next.find((agent) => agent.id === 'delegate-1')).toEqual(
      expect.objectContaining({ status: 'running', task: 'Second pass' }),
    );
  });
});

describe('SimpleUI per-agent histories', () => {
  it('hydrates a curated, meaningful history and drops noisy entries', () => {
    // A long-running worker has accumulated a noisy transcript. On F5 we want
    // the assistant/user-facing surface only — no tool_use/tool_result noise,
    // no debug status spam — and bounded to the most recent slice.
    const transcript = [
      {
        subagentId: 'worker-1',
        agentName: 'WORKER',
        kind: 'status',
        content: 'AGENT RUNNING',
        iteration: 0,
        ts: '2026-07-15T12:00:00.000Z',
      },
      {
        subagentId: 'worker-1',
        agentName: 'WORKER',
        kind: 'tool_use',
        content: 'read({"path":"a.ts"})',
        iteration: 0,
        ts: '2026-07-15T12:00:01.000Z',
        toolName: 'read',
      },
      {
        subagentId: 'worker-1',
        agentName: 'WORKER',
        kind: 'thinking',
        content: 'Inspecting the auth handler.',
        iteration: 1,
        ts: '2026-07-15T12:00:02.000Z',
      },
      {
        subagentId: 'worker-1',
        agentName: 'WORKER',
        kind: 'text',
        content: 'Found the bug.',
        iteration: 1,
        ts: '2026-07-15T12:00:03.000Z',
      },
      {
        subagentId: 'worker-1',
        agentName: 'WORKER',
        kind: 'system',
        content: 'agent loop tick',
        iteration: 1,
        ts: '2026-07-15T12:00:04.000Z',
      },
      {
        subagentId: 'worker-1',
        agentName: 'WORKER',
        kind: 'tool_result',
        content: 'Completed read',
        iteration: 1,
        ts: '2026-07-15T12:00:05.000Z',
        toolName: 'read',
        toolOk: true,
      },
      {
        subagentId: 'worker-1',
        agentName: 'WORKER',
        kind: 'status',
        content: 'tool ok',
        iteration: 2,
        ts: '2026-07-15T12:00:06.000Z',
      },
      {
        subagentId: 'worker-1',
        agentName: 'WORKER',
        kind: 'text',
        content: 'Fix landed.',
        iteration: 2,
        ts: '2026-07-15T12:00:07.000Z',
      },
      {
        subagentId: 'worker-1',
        agentName: 'WORKER',
        kind: 'error',
        content: 'retry budget soft warning',
        iteration: 2,
        ts: '2026-07-15T12:00:08.000Z',
      },
    ];
    const replays = parseAgentSessionReplays([
      {
        subagentId: 'worker-1',
        agentName: 'WORKER',
        status: 'completed',
        task: 'Review auth',
        transcript,
      },
      { nope: true },
    ]);
    expect(replays).toHaveLength(1);
    const session = replays[0]!;
    expect(session.subagentId).toBe('worker-1');
    expect(session.transcript.map((entry) => entry.kind)).toEqual([
      'thinking',
      'text',
      'text',
      'error',
    ]);
    expect(session.transcript.map((entry) => entry.content)).toEqual([
      'Inspecting the auth handler.',
      'Found the bug.',
      'Fix landed.',
      'retry budget soft warning',
    ]);
    // Leader snapshot is never rehydrated into the worker store.
    expect(parseAgentSessionReplays({ invalid: true })).toEqual([]);
    expect(
      parseAgentSessionReplays([
        {
          subagentId: 'leader',
          agentName: 'LEADER',
          status: 'running',
          transcript: [
            {
              subagentId: 'leader',
              agentName: 'LEADER',
              kind: 'text',
              content: 'should be ignored',
              iteration: 0,
              ts: '2026-07-15T12:00:00.000Z',
            },
          ],
        },
      ]),
    ).toEqual([]);
  });

  it('returns empty when the snapshot has no visible entries, even with a huge noisy history', () => {
    const noisy = Array.from({ length: 5000 }, (_, index) => ({
      subagentId: 'worker-2',
      agentName: 'NOISY',
      kind: 'tool_use' as const,
      content: `bash({"cmd":"echo ${index}"})`,
      toolName: 'bash',
      iteration: index,
      ts: '2026-07-15T12:00:00.000Z',
    }));
    expect(
      parseAgentSessionReplays([
        {
          subagentId: 'worker-2',
          agentName: 'NOISY',
          status: 'completed',
          transcript: noisy,
        },
      ]),
    ).toEqual([]);
  });

  it('caps each agent replay at the curated tail and keeps order', () => {
    // 80 thinking entries — only the last 64 should survive, in order.
    const transcript = Array.from({ length: 80 }, (_, index) => ({
      subagentId: 'worker-3',
      agentName: 'THINKER',
      kind: 'thinking' as const,
      content: `thought #${index}`,
      iteration: index,
      ts: '2026-07-15T12:00:00.000Z',
    }));
    const replays = parseAgentSessionReplays([
      {
        subagentId: 'worker-3',
        agentName: 'THINKER',
        status: 'completed',
        transcript,
      },
    ]);
    expect(replays).toHaveLength(1);
    const session = replays[0]!;
    expect(session.transcript).toHaveLength(64);
    expect(session.transcript[0]?.content).toBe('thought #16');
    expect(session.transcript.at(-1)?.content).toBe('thought #79');
  });

  it('projects rich timeline events only for worker agents', () => {
    expect(
      projectAgentTimelineEntry(
        {
          subagentId: 'spawn-1',
          agentName: 'BUG HUNTER',
          content: 'Inspecting `auth.ts`',
          kind: 'thinking',
          iteration: 3,
          ts: '2026-07-15T12:01:00.000Z',
        },
        'timeline-1',
      ),
    ).toEqual({
      id: 'timeline-1',
      subagentId: 'spawn-1',
      agentName: 'BUG HUNTER',
      content: 'Inspecting `auth.ts`',
      kind: 'thinking',
      iteration: 3,
      ts: '2026-07-15T12:01:00.000Z',
      toolName: undefined,
    });
    expect(
      projectAgentTimelineEntry(
        { subagentId: 'leader', content: 'Leader content', kind: 'text' },
        'leader-event',
      ),
    ).toBeNull();
  });

  it('falls back to a completion event when no rich transcript event is available', () => {
    expect(
      projectCompletedAgentText(
        { subagentId: 'delegate-1', finalText: 'Review complete', iterations: 8 },
        'result-1',
        'REVIEWER',
      ),
    ).toEqual(
      expect.objectContaining({
        id: 'result-1',
        subagentId: 'delegate-1',
        agentName: 'REVIEWER',
        content: 'Review complete',
        kind: 'text',
        iteration: 8,
      }),
    );
  });

  it('deduplicates mirrored final output while preserving distinct history entries', () => {
    const first = entry();
    const duplicate = entry({ id: 'entry-2', ts: '2026-07-15T12:00:01.000Z' });
    const distinct = entry({ id: 'entry-3', content: 'A second finding', iteration: 3 });

    const history = appendAgentTranscriptEntry(
      appendAgentTranscriptEntry(appendAgentTranscriptEntry([], first), duplicate),
      distinct,
    );
    expect(history).toHaveLength(2);
    expect(history.map((item) => item.content)).toEqual(['Found it', 'A second finding']);
  });

  it('bounds long-running agent histories to the latest 500 entries', () => {
    let history: AgentTranscriptEntry[] = [];
    for (let index = 0; index < 505; index++) {
      history = appendAgentTranscriptEntry(
        history,
        entry({ id: `entry-${index}`, content: `message-${index}`, iteration: index }),
      );
    }
    expect(history).toHaveLength(500);
    expect(history[0]?.content).toBe('message-5');
    expect(history.at(-1)?.content).toBe('message-504');
  });
});
