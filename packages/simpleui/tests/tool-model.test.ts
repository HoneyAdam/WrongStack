import { describe, expect, it } from 'vitest';
import { agentTranscriptToToolCalls } from '../src/lib/tool-model.js';
import type { AgentTranscriptEntry } from '../src/types.js';

function event(
  id: string,
  kind: AgentTranscriptEntry['kind'],
  content: string,
  overrides: Partial<AgentTranscriptEntry> = {},
): AgentTranscriptEntry {
  return {
    id,
    subagentId: 'worker-1',
    agentName: 'WORKER',
    kind,
    content,
    iteration: 1,
    ts: '2026-07-15T12:00:00.000Z',
    ...overrides,
  };
}

describe('SimpleUI worker tool projection', () => {
  it('pairs each result with the latest running call of the same name', () => {
    const calls = agentTranscriptToToolCalls([
      event('read-1', 'tool_use', 'read({"path":"a.ts"})', { toolName: 'read' }),
      event('read-2', 'tool_use', 'read({"path":"b.ts"})', { toolName: 'read' }),
      event('result-2', 'tool_result', 'Completed read\nfile b', {
        toolName: 'read',
        toolOk: true,
      }),
      event('result-1', 'tool_result', 'Completed read\nfile a', {
        toolName: 'read',
        toolOk: true,
      }),
    ]);

    expect(calls).toEqual([
      expect.objectContaining({
        id: 'read-1',
        name: 'read',
        status: 'done',
        output: expect.stringContaining('file a'),
        ok: true,
      }),
      expect.objectContaining({
        id: 'read-2',
        name: 'read',
        status: 'done',
        output: expect.stringContaining('file b'),
        ok: true,
      }),
    ]);
  });

  it('uses the typed tool outcome instead of interpreting successful output text', () => {
    const [call] = agentTranscriptToToolCalls([
      event('grep-1', 'tool_use', 'grep(error)', { toolName: 'grep' }),
      event('grep-result', 'tool_result', 'Completed grep\n0 errors; error handling is clean', {
        toolName: 'grep',
        toolOk: true,
      }),
    ]);
    expect(call).toEqual(expect.objectContaining({ status: 'done', ok: true }));
  });

  it('marks an explicitly failed result and preserves orphan results', () => {
    const calls = agentTranscriptToToolCalls([
      event('orphan', 'tool_result', 'Failed bash\nexit 1', {
        toolName: 'bash',
        toolOk: false,
      }),
    ]);
    expect(calls).toEqual([
      expect.objectContaining({
        id: 'orphan',
        name: 'bash',
        status: 'error',
        ok: false,
        output: expect.stringContaining('exit 1'),
      }),
    ]);
  });

  it('infers a tool name from a call preview when metadata is absent', () => {
    expect(
      agentTranscriptToToolCalls([
        event('call', 'tool_use', 'fetch({"url":"https://example.com"})'),
      ]),
    ).toEqual([expect.objectContaining({ name: 'fetch', status: 'running' })]);
  });
});
