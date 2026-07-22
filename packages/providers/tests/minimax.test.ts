import type { Request } from '@wrongstack/core/types';
import { describe, expect, it, vi } from 'vitest';
import { MiniMaxProvider } from '../src/minimax.js';

function request(model: string): Request {
  return {
    model,
    messages: [{ role: 'user', content: 'hi' }],
    maxTokens: 8192,
    reasoning: { enabled: true, effort: 'high' },
    tools: [{ name: 'read', description: 'Read', inputSchema: {} }],
  };
}

async function drain(provider: MiniMaxProvider, req: Request): Promise<void> {
  for await (const _event of provider.stream(req, {
    signal: new AbortController().signal,
  })) {
    // Request assertions inspect captured fetch calls.
  }
}

describe('MiniMaxProvider', () => {
  it('routes M2.x through the recommended Anthropic API with x-api-key', async () => {
    const calls: Array<{
      url: string;
      headers: Record<string, string>;
      body: Record<string, unknown>;
    }> = [];
    const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) => {
      calls.push({
        url: String(input),
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      });
      return new Response('', { status: 200 });
    }) as never as typeof fetch;
    const provider = new MiniMaxProvider({
      apiKey: 'minimax-key',
      // Old persisted preset URLs must normalize to the same root.
      baseUrl: 'https://api.minimax.io/v1',
      fetchImpl,
    });

    await drain(provider, request('MiniMax-M2.7'));

    expect(calls[0]?.url).toBe('https://api.minimax.io/anthropic/v1/messages');
    expect(calls[0]?.headers['x-api-key']).toBe('minimax-key');
    expect(calls[0]?.headers).not.toHaveProperty('authorization');
    expect(calls[0]?.body).not.toHaveProperty('thinking');
  });

  it('keeps unknown/newer models on the standard OpenAI API', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: unknown) => {
      urls.push(String(input));
      return new Response('', { status: 200 });
    }) as never as typeof fetch;
    const provider = new MiniMaxProvider({ apiKey: 'minimax-key', fetchImpl });

    await drain(provider, request('MiniMax-M3'));
    expect(urls).toEqual(['https://api.minimax.io/v1/chat/completions']);
  });
});
