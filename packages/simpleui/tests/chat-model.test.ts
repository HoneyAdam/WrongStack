import { describe, expect, it } from 'vitest';
import { contentToText, replayToMessages, updateSubagents } from '../src/lib/chat-model.js';
import { projectAssistantMessage } from '../src/lib/message-projection.js';

describe('SimpleUI chat projection', () => {
  it('extracts displayable text without leaking opaque tool blocks', () => {
    expect(
      contentToText([
        { type: 'text', text: 'Hello' },
        { type: 'tool_use', name: 'read', input: { path: 'secret' } },
        { type: 'text', text: 'World' },
      ]),
    ).toBe('Hello\n\nWorld');
  });

  it('restores only useful chat roles from session replay', () => {
    expect(
      replayToMessages([
        { role: 'user', content: 'Fix it' },
        { role: 'tool', content: 'huge output' },
        { role: 'assistant', content: [{ type: 'text', text: 'Done' }] },
      ]).map(({ role, text }) => ({ role, text })),
    ).toEqual([
      { role: 'user', text: 'Fix it' },
      { role: 'assistant', text: 'Done' },
    ]);
  });
});

describe('SimpleUI subagent projection', () => {
  it('tracks workers but never duplicates the leader', () => {
    let agents = updateSubagents([], {
      kind: 'spawned',
      subagentId: 'leader',
      name: 'LEADER',
    });
    agents = updateSubagents(agents, {
      kind: 'spawned',
      subagentId: 'worker-1',
      name: 'FIXER',
      model: 'gpt-5',
    });
    agents = updateSubagents(agents, {
      kind: 'task_started',
      subagentId: 'worker-1',
      description: 'Fix auth',
    });
    expect(agents).toEqual([
      expect.objectContaining({
        id: 'worker-1',
        name: 'FIXER',
        status: 'running',
        task: 'Fix auth',
      }),
    ]);
  });

  it('removes retired workers', () => {
    const agents = [{ id: 'worker-1', name: 'FIXER', status: 'idle' }];
    expect(updateSubagents(agents, { kind: 'removed', subagentId: 'worker-1' })).toEqual([]);
  });
});

describe('SimpleUI assistant metadata projection', () => {
  it('parses canonical next steps and removes their control block from prose', () => {
    expect(
      projectAssistantMessage(`Done.\n\n<nextsteps>\n1. Run tests\n2. Ship it auto="true"\n</nextsteps>`),
    ).toEqual({
      text: 'Done.',
      nextSteps: [
        { index: 1, text: 'Run tests' },
        { index: 2, text: 'Ship it', auto: true },
      ],
    });
  });

  it('accepts legacy next_steps tags without duplicating parser rules', () => {
    const projected = projectAssistantMessage(
      'Ready.\n<next_steps>\n- Inspect logs\n- Retry\n</next_steps>',
    );
    expect(projected.text).toBe('Ready.');
    expect(projected.nextSteps.map((step) => step.text)).toEqual(['Inspect logs', 'Retry']);
  });

  it('hides incomplete or malformed metadata instead of rendering raw tags', () => {
    expect(projectAssistantMessage('Answer\n\n<nextsteps>\n1. Still streaming')).toEqual({
      text: 'Answer',
      nextSteps: [],
    });
    expect(projectAssistantMessage('Answer\n<nextsteps>\nnot a list\n</nextsteps>').text).toBe(
      'Answer',
    );
  });

  it('leaves ordinary assistant text untouched', () => {
    expect(projectAssistantMessage('Plain answer')).toEqual({
      text: 'Plain answer',
      nextSteps: [],
    });
  });
});
