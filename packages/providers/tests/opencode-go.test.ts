import type { Request } from '@wrongstack/core/types';
import { describe, expect, it, vi } from 'vitest';
import { OpenCodeGoProvider } from '../src/opencode-go.js';

function request(model: string, reasoning?: Request['reasoning']): Request {
  return {
    model,
    messages: [{ role: 'user', content: 'hi' }],
    maxTokens: 8192,
    reasoning,
    tools: [{ name: 'read', description: 'Read a file', inputSchema: { type: 'object' } }],
  };
}

async function drain(provider: OpenCodeGoProvider, req: Request): Promise<void> {
  for await (const _event of provider.stream(req, {
    signal: new AbortController().signal,
  })) {
    // Routing/body assertions inspect the captured fetch call.
  }
}

describe('OpenCodeGoProvider', () => {
  it('routes Chat Completions and Anthropic Messages models behind one provider', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      });
      return new Response('', { status: 200 });
    }) as never as typeof fetch;
    const provider = new OpenCodeGoProvider({ apiKey: 'oc-test', fetchImpl });

    await drain(provider, request('grok-4.5', { effort: 'high' }));
    await drain(provider, request('minimax-m3', { enabled: true }));

    expect(calls[0]?.url).toBe('https://opencode.ai/zen/go/v1/chat/completions');
    expect(calls[1]?.url).toBe('https://opencode.ai/zen/go/v1/messages');
    expect(provider.id).toBe('opencode-go');
  });

  it('keeps only model-supported effort values even when tools are present', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (_input: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response('', { status: 200 });
    }) as never as typeof fetch;
    const provider = new OpenCodeGoProvider({ apiKey: 'oc-test', fetchImpl });

    await drain(provider, request('glm-5.2', { effort: 'max' }));
    await drain(provider, request('glm-5.2', { effort: 'none' }));
    await drain(provider, request('kimi-k2.7-code', { effort: 'high' }));

    expect(bodies[0]?.['reasoning_effort']).toBe('max');
    expect(bodies[1]).not.toHaveProperty('reasoning_effort');
    expect(bodies[2]).not.toHaveProperty('reasoning_effort');
  });

  it('uses adaptive thinking for MiniMax M3 and budget thinking for Qwen', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (_input: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response('', { status: 200 });
    }) as never as typeof fetch;
    const provider = new OpenCodeGoProvider({ apiKey: 'oc-test', fetchImpl });

    await drain(provider, request('minimax-m3', { enabled: true, effort: 'high' }));
    await drain(provider, request('qwen3.7-plus', { effort: 'high' }));
    await drain(provider, request('minimax-m2.7', { enabled: false, effort: 'none' }));

    expect(bodies[0]?.['thinking']).toEqual({ type: 'adaptive' });
    expect(bodies[1]?.['thinking']).toMatchObject({ type: 'enabled' });
    const qwenThinking = bodies[1]?.['thinking'] as Record<string, unknown> | undefined;
    expect(qwenThinking?.['budget_tokens']).toBeGreaterThan(0);
    expect(bodies[2]).not.toHaveProperty('thinking');
  });
});
