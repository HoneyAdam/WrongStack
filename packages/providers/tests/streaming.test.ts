import { describe, expect, it } from 'vitest';
import { AnthropicProvider } from '../src/anthropic.js';
import { OpenAIProvider } from '../src/openai.js';
import { GoogleProvider } from '../src/google.js';

function sseBody(events: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    pull(c) {
      c.enqueue(enc.encode(events));
      c.close();
    },
  });
}

function mockFetch(body: ReadableStream<Uint8Array>): typeof fetch {
  return (async () =>
    new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })) as unknown as typeof fetch;
}

describe('AnthropicProvider.stream', () => {
  it('parses canonical Anthropic SSE into StreamEvent[]', async () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"model":"claude-test","usage":{"input_tokens":12,"output_tokens":0}}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}',
      '',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":0}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n');
    const provider = new AnthropicProvider({ apiKey: 'k', fetchImpl: mockFetch(sseBody(sse)) });
    const res = await provider.complete(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }], maxTokens: 100 },
      { signal: new AbortController().signal },
    );
    expect(res.content).toEqual([{ type: 'text', text: 'Hello world' }]);
    expect(res.stopReason).toBe('end_turn');
    expect(res.usage).toEqual({ input: 12, output: 7, cacheRead: undefined, cacheWrite: undefined });
    expect(res.model).toBe('claude-test');
  });

  it('parses tool_use with partial JSON deltas', async () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"model":"m","usage":{"input_tokens":5}}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"echo","input":{}}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"text\\":"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"hi\\"}"}}',
      '',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":0}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":4}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n');
    const provider = new AnthropicProvider({ apiKey: 'k', fetchImpl: mockFetch(sseBody(sse)) });
    const res = await provider.complete(
      { model: 'm', messages: [{ role: 'user', content: 'go' }], maxTokens: 100 },
      { signal: new AbortController().signal },
    );
    expect(res.content).toEqual([
      { type: 'tool_use', id: 'toolu_1', name: 'echo', input: { text: 'hi' } },
    ]);
    expect(res.stopReason).toBe('tool_use');
  });
});

describe('OpenAIProvider.stream', () => {
  it('parses OpenAI chat.completion chunks into StreamEvent[]', async () => {
    const sse = [
      'data: {"id":"x","model":"gpt-test","choices":[{"index":0,"delta":{"content":"Hi"}}]}',
      '',
      'data: {"id":"x","choices":[{"index":0,"delta":{"content":" there"}}]}',
      '',
      'data: {"id":"x","choices":[{"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":3}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    const provider = new OpenAIProvider({ apiKey: 'k', fetchImpl: mockFetch(sseBody(sse)) });
    const res = await provider.complete(
      { model: 'gpt-test', messages: [{ role: 'user', content: 'hi' }], maxTokens: 100 },
      { signal: new AbortController().signal },
    );
    expect(res.content).toEqual([{ type: 'text', text: 'Hi there' }]);
    expect(res.stopReason).toBe('end_turn');
    expect(res.usage).toEqual({ input: 10, output: 3, cacheRead: undefined });
    expect(res.model).toBe('gpt-test');
  });

  it('parses tool_calls with arguments streamed in chunks', async () => {
    const sse = [
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"echo","arguments":"{\\"text\\":"}}]}}]}',
      '',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"hi\\"}"}}]}}]}',
      '',
      'data: {"choices":[{"index":0,"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":7,"completion_tokens":4}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    const provider = new OpenAIProvider({ apiKey: 'k', fetchImpl: mockFetch(sseBody(sse)) });
    const res = await provider.complete(
      { model: 'm', messages: [{ role: 'user', content: 'go' }], maxTokens: 100 },
      { signal: new AbortController().signal },
    );
    expect(res.content).toEqual([
      { type: 'tool_use', id: 'call_1', name: 'echo', input: { text: 'hi' } },
    ]);
    expect(res.stopReason).toBe('tool_use');
  });
});

describe('GoogleProvider.stream', () => {
  it('parses Gemini SSE chunks with text parts', async () => {
    const sse = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Hi"}],"role":"model"}}],"modelVersion":"gemini-test"}',
      '',
      'data: {"candidates":[{"content":{"parts":[{"text":" world"}],"role":"model"}}]}',
      '',
      'data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":2}}',
      '',
    ].join('\n');
    const provider = new GoogleProvider({ apiKey: 'k', fetchImpl: mockFetch(sseBody(sse)) });
    const res = await provider.complete(
      { model: 'gemini-test', messages: [{ role: 'user', content: 'hi' }], maxTokens: 100 },
      { signal: new AbortController().signal },
    );
    expect(res.content).toEqual([{ type: 'text', text: 'Hi world' }]);
    expect(res.stopReason).toBe('end_turn');
    expect(res.usage).toEqual({ input: 3, output: 2, cacheRead: undefined });
    expect(res.model).toBe('gemini-test');
  });

  it('emits tool_use for functionCall parts', async () => {
    const sse = [
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"echo","args":{"text":"hi"}}}],"role":"model"}}],"modelVersion":"gemini-test"}',
      '',
      'data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":1}}',
      '',
    ].join('\n');
    const provider = new GoogleProvider({ apiKey: 'k', fetchImpl: mockFetch(sseBody(sse)) });
    const res = await provider.complete(
      { model: 'gemini-test', messages: [{ role: 'user', content: 'go' }], maxTokens: 100 },
      { signal: new AbortController().signal },
    );
    expect(res.content).toHaveLength(1);
    expect(res.content[0]).toMatchObject({ type: 'tool_use', name: 'echo', input: { text: 'hi' } });
  });
});
