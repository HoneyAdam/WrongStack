import { describe, expect, it } from 'vitest';
import {
  buildAgentToolCalls,
  classifyOfficeTool,
  synthesizeCurrentTool,
} from '../../src/lib/agent-office.js';
import type { VizEvent } from '../../src/stores/viz-store.js';

function event(
  kind: VizEvent['kind'],
  timestamp: number,
  data: Record<string, unknown>,
): VizEvent {
  return {
    id: `viz-${timestamp}-${kind}`,
    kind,
    timestamp,
    source: typeof data['agentId'] === 'string' ? data['agentId'] : String(data['name'] ?? 'tool'),
    target: typeof data['name'] === 'string' ? data['name'] : undefined,
    label: String(data['name'] ?? kind),
    data,
  };
}

describe('agent office tool model', () => {
  it('classifies the visual tool families', () => {
    expect(classifyOfficeTool('read_file')).toBe('read');
    expect(classifyOfficeTool('apply_patch')).toBe('edit');
    expect(classifyOfficeTool('shell_command')).toBe('terminal');
    expect(classifyOfficeTool('web.search')).toBe('web');
  });

  it('merges a tool start and completion while preserving exact line metrics', () => {
    const events = [
      event('tool:executed', 1_200, {
        id: 'tu-1',
        agentId: 'agent-a',
        sessionId: 'session-1',
        name: 'read',
        ok: true,
        durationMs: 200,
        input: { file_path: 'src/app.ts', offset: 20, limit: 40 },
        fileTargets: [{ filePath: 'src/app.ts', operation: 'read', line: 20, endLine: 59 }],
        outputLines: 40,
        outputBytes: 2_048,
      }),
      event('tool:started', 1_000, {
        id: 'tu-1',
        agentId: 'agent-a',
        sessionId: 'session-1',
        name: 'read',
        input: { file_path: 'src/app.ts', offset: 20, limit: 40 },
      }),
    ];

    const [call] = buildAgentToolCalls(events, 'agent-a', 'session-1');
    expect(call).toMatchObject({
      id: 'agent-a:tu-1',
      kind: 'read',
      status: 'succeeded',
      startedAt: 1_000,
      completedAt: 1_200,
      summary: '40 lines read',
      lineLabel: 'L20–59',
      target: 'src/app.ts',
      outputBytes: 2_048,
    });
  });

  it('reports exact edit deltas from patches', () => {
    const events = [
      event('tool:executed', 2_000, {
        id: 'tu-2',
        agentId: 'agent-a',
        name: 'apply_patch',
        ok: true,
        input: {
          file_path: 'src/store.ts',
          patch: '@@\n-old one\n-old two\n+new one\n+new two\n+new three',
        },
      }),
    ];
    expect(buildAgentToolCalls(events, 'agent-a')[0]?.summary).toBe('+3 / −2 lines');
  });

  it('keeps calls scoped to the selected session', () => {
    const events = [
      event('tool:executed', 2_000, {
        id: 'same', agentId: 'leader', sessionId: 'session-b', name: 'bash', ok: true,
      }),
      event('tool:executed', 1_000, {
        id: 'same', agentId: 'leader', sessionId: 'session-a', name: 'read', ok: true,
      }),
    ];
    expect(buildAgentToolCalls(events, 'leader', 'session-a').map((call) => call.toolName)).toEqual(['read']);
  });

  it('can synthesize a live action from a remote fleet snapshot', () => {
    expect(synthesizeCurrentTool('worker', 'fetch', 'session-1')).toMatchObject({
      agentId: 'worker',
      sessionId: 'session-1',
      kind: 'web',
      status: 'running',
      summary: 'Working online',
    });
  });
});

