import { describe, expect, it, vi } from 'vitest';
import type { AgentInternals } from '../../src/core/agent-internals.js';
import { createAgentResponseHandler } from '../../src/core/agent-response.js';
import type { Request, Response } from '../../src/types/provider.js';

function createHarness() {
  const appendMessage = vi.fn();
  const appendSession = vi.fn(async () => undefined);
  const flushSession = vi.fn(async () => undefined);
  const flushConversationJournal = vi.fn(async () => undefined);
  const warn = vi.fn();

  const internals = {
    events: { emit: vi.fn() },
    pipelines: {
      response: { run: vi.fn(async (response: Response) => response) },
      assistantOutput: { run: vi.fn(async (block: unknown) => block) },
    },
    ctx: {
      session: {
        id: 'session-1',
        append: appendSession,
        flush: flushSession,
      },
      state: { appendMessage },
      tokenCounter: { account: vi.fn() },
      provider: { capabilities: { streaming: false } },
      signal: new AbortController().signal,
      toolAdjacencyDirty: false,
      flushConversationJournal,
    },
    logger: { warn },
    renderer: undefined,
  } as unknown as AgentInternals;

  const request = { model: 'test-model', messages: [] } as Request;
  return {
    handler: createAgentResponseHandler(internals),
    request,
    appendMessage,
    appendSession,
    flushSession,
    flushConversationJournal,
    warn,
  };
}

function response(content: Response['content']): Response {
  return {
    content,
    model: 'test-model',
    stopReason: 'end_turn',
    usage: { input: 1, output: 0 },
  };
}

describe('agent response persistence', () => {
  it('does not persist an assistant response containing only empty text', async () => {
    const h = createHarness();

    const result = await h.handler.processResponse(
      response([{ type: 'text', text: '' }]),
      h.request,
    );

    expect(result.finalText).toBe('');
    expect(h.appendMessage).not.toHaveBeenCalled();
    expect(h.appendSession).not.toHaveBeenCalled();
    expect(h.flushConversationJournal).not.toHaveBeenCalled();
    expect(h.flushSession).not.toHaveBeenCalled();
    expect(h.warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipping empty assistant response'),
    );
  });

  it('persists protocol-only assistant responses', async () => {
    const h = createHarness();
    const content: Response['content'] = [
      { type: 'tool_use', id: 'tool-1', name: 'read', input: { path: 'README.md' } },
    ];

    await h.handler.processResponse(response(content), h.request);

    expect(h.appendMessage).toHaveBeenCalledWith({ role: 'assistant', content });
    expect(h.appendSession).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'llm_response',
        content,
      }),
    );
    expect(h.flushConversationJournal).toHaveBeenCalledOnce();
    expect(h.flushSession).toHaveBeenCalledOnce();
  });
});
