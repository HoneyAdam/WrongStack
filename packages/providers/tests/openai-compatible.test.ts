import { describe, expect, it, vi } from 'vitest';
import {
  isCompatibilityQuirks,
  OpenAICompatibleProvider,
} from '../src/openai-compatible.js';

// ── isCompatibilityQuirks (type guard) ────────────────────────────

describe('isCompatibilityQuirks', () => {
  it('returns true for undefined (no quirks)', () => {
    expect(isCompatibilityQuirks(undefined)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isCompatibilityQuirks(null)).toBe(false);
  });

  it('returns false for non-object types', () => {
    expect(isCompatibilityQuirks('string')).toBe(false);
    expect(isCompatibilityQuirks(42)).toBe(false);
    expect(isCompatibilityQuirks(true)).toBe(false);
  });

  it('returns false for arrays', () => {
    expect(isCompatibilityQuirks([])).toBe(false);
  });

  it('returns true for empty object', () => {
    expect(isCompatibilityQuirks({})).toBe(true);
  });

  it('accepts valid boolean quirk keys', () => {
    expect(isCompatibilityQuirks({ stripCacheControl: true })).toBe(true);
    expect(isCompatibilityQuirks({ systemAsMessage: false })).toBe(true);
    expect(isCompatibilityQuirks({ flattenContentToString: true })).toBe(true);
    expect(isCompatibilityQuirks({ preserveToolCallIds: false })).toBe(true);
    expect(isCompatibilityQuirks({ parallelToolsDisabled: true })).toBe(true);
    expect(isCompatibilityQuirks({ jsonArgumentsBuggy: true })).toBe(true);
    expect(isCompatibilityQuirks({ stripThinkTags: false })).toBe(true);
  });

  it('rejects unknown keys', () => {
    expect(isCompatibilityQuirks({ unknownKey: true })).toBe(false);
  });

  it('rejects non-boolean values for boolean keys', () => {
    expect(isCompatibilityQuirks({ stripCacheControl: 'yes' })).toBe(false);
    expect(isCompatibilityQuirks({ parallelToolsDisabled: 1 })).toBe(false);
  });

  it('accepts valid emptyToolCallContent values', () => {
    expect(isCompatibilityQuirks({ emptyToolCallContent: 'null' })).toBe(true);
    expect(isCompatibilityQuirks({ emptyToolCallContent: 'empty_string' })).toBe(true);
  });

  it('rejects invalid emptyToolCallContent values', () => {
    expect(isCompatibilityQuirks({ emptyToolCallContent: 'invalid' })).toBe(false);
    expect(isCompatibilityQuirks({ emptyToolCallContent: true })).toBe(false);
  });

  it('accepts valid thinkingParam values', () => {
    expect(isCompatibilityQuirks({ thinkingParam: 'zai-glm' })).toBe(true);
    expect(isCompatibilityQuirks({ thinkingParam: 'kimi-toggle' })).toBe(true);
    expect(isCompatibilityQuirks({ thinkingParam: 'always-on' })).toBe(true);
  });

  it('rejects invalid thinkingParam values', () => {
    expect(isCompatibilityQuirks({ thinkingParam: 'invalid' })).toBe(false);
    expect(isCompatibilityQuirks({ thinkingParam: true })).toBe(false);
  });

  it('accepts multiple valid keys at once', () => {
    expect(isCompatibilityQuirks({
      stripCacheControl: true,
      emptyToolCallContent: 'null',
      thinkingParam: 'always-on',
    })).toBe(true);
  });
});

function mockFetchSpy() {
  return vi.fn(async (_url: unknown, init?: { headers?: Record<string, string> }) => {
    return {
      ok: true,
      status: 200,
      headers: init?.headers,
      json: async () => ({
        model: 'm',
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      text: async () => '',
      body: null as ReadableStream<Uint8Array> | NodeJS.ReadableStream | null,
    };
  });
}

describe('OpenAICompatibleProvider', () => {
  it('injects custom headers on each request', async () => {
    const spy = mockFetchSpy();
    const p = new OpenAICompatibleProvider({
      id: 'groq',
      apiKey: 'sk-x',
      baseUrl: 'https://api.groq.com/openai/v1',
      headers: { 'x-custom': '1' },
      fetchImpl: spy as never as typeof fetch,
    });
    await p.complete(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }], maxTokens: 1 },
      { signal: new AbortController().signal },
    );
    const [, init] = spy.mock.calls[0]!;
    expect((init!.headers as Record<string, string>)['x-custom']).toBe('1');
    expect((init!.headers as Record<string, string>)['authorization']).toMatch(/Bearer sk-x/);
  });

  it('honours capabilities override', () => {
    const p = new OpenAICompatibleProvider({
      id: 'xai',
      apiKey: 'k',
      baseUrl: 'https://api.x.ai/v1',
      capabilities: { vision: false, maxContext: 32_000 },
    });
    expect(p.capabilities.vision).toBe(false);
    expect(p.capabilities.maxContext).toBe(32_000);
  });

  it('disables parallel tools when quirk set', () => {
    const p = new OpenAICompatibleProvider({
      id: 'cerebras',
      apiKey: 'k',
      baseUrl: 'https://api.cerebras.ai/v1',
      quirks: { parallelToolsDisabled: true },
    });
    expect(p.capabilities.parallelTools).toBe(false);
  });

  it('honours urlOverride for non-standard URL structures', async () => {
    const spy = mockFetchSpy();
    const p = new OpenAICompatibleProvider({
      id: 'custom',
      apiKey: 'k',
      baseUrl: 'https://api.example.com',
      urlOverride: (baseUrl, _req) => baseUrl + '/v2/chat',
      fetchImpl: spy as never as typeof fetch,
    });
    await p.complete(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }], maxTokens: 1 },
      { signal: new AbortController().signal },
    );
    const [url] = spy.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/v2/chat');
  });

  it('keeps the legacy max_tokens field (compatible endpoints reject max_completion_tokens) (#10)', async () => {
    let captured: Record<string, unknown> | undefined;
    const spy = vi.fn(async (_url: unknown, init: { body?: string } = {}) => {
      captured = JSON.parse(init.body ?? '{}');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: 'm',
          choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        text: async () => '',
      };
    }) as never as typeof fetch;
    const p = new OpenAICompatibleProvider({
      id: 'groq',
      apiKey: 'k',
      baseUrl: 'https://api.groq.com/openai/v1',
      fetchImpl: spy,
    });
    await p.complete(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }], maxTokens: 128 },
      { signal: new AbortController().signal },
    );
    expect(captured?.['max_tokens']).toBe(128);
    expect(captured?.['max_completion_tokens']).toBeUndefined();
  });

  it('maps Z.AI disabled thinking and compatibility effort aliases', async () => {
    let captured: Record<string, unknown> | undefined;
    const spy = vi.fn(async (_url: unknown, init: { body?: string } = {}) => {
      captured = JSON.parse(init.body ?? '{}');
      return { ok: true, status: 200, json: async () => ({ model: 'm', choices: [], usage: {} }), text: async () => '' };
    }) as never as typeof fetch;
    const p = new OpenAICompatibleProvider({
      id: 'zai',
      apiKey: 'k',
      baseUrl: 'https://api.z.ai/api/paas/v4',
      quirks: { thinkingParam: 'zai-glm' },
      fetchImpl: spy,
    });
    await p.complete(
      { model: 'glm-5.2', messages: [{ role: 'user', content: 'hi' }], maxTokens: 1, reasoning: { enabled: true, effort: 'medium' } },
      { signal: new AbortController().signal },
    );
    expect(captured?.['reasoning_effort']).toBe('high');

    await p.complete(
      { model: 'glm-5.2', messages: [{ role: 'user', content: 'hi' }], maxTokens: 1, reasoning: { enabled: false } },
      { signal: new AbortController().signal },
    );
    expect(captured?.['thinking']).toEqual({ type: 'disabled' });
  });

  it('does not send disabled thinking to always-on compatible models', async () => {
    let captured: Record<string, unknown> | undefined;
    const spy = vi.fn(async (_url: unknown, init: { body?: string } = {}) => {
      captured = JSON.parse(init.body ?? '{}');
      return { ok: true, status: 200, json: async () => ({ model: 'm', choices: [], usage: {} }), text: async () => '' };
    }) as never as typeof fetch;
    const p = new OpenAICompatibleProvider({
      id: 'moonshot',
      apiKey: 'k',
      baseUrl: 'https://api.moonshot.ai/v1',
      quirks: { thinkingParam: 'always-on' },
      fetchImpl: spy,
    });
    await p.complete(
      { model: 'kimi-k2.7-code', messages: [{ role: 'user', content: 'hi' }], maxTokens: 1, reasoning: { enabled: false } },
      { signal: new AbortController().signal },
    );
    expect(captured?.['thinking']).toBeUndefined();
  });

  it('maps the effort levels the base builder drops onto reasoning_effort (#14)', async () => {
    let captured: Record<string, unknown> | undefined;
    const spy = vi.fn(async (_url: unknown, init: { body?: string } = {}) => {
      captured = JSON.parse(init.body ?? '{}');
      return { ok: true, status: 200, json: async () => ({ model: 'm', choices: [], usage: {} }), text: async () => '' };
    }) as never as typeof fetch;
    const p = new OpenAICompatibleProvider({
      id: 'deepseek',
      apiKey: 'k',
      baseUrl: 'https://api.deepseek.com/v1',
      fetchImpl: spy,
    });
    // `max` is outside OpenAI's accepted set, so the base builder dropped it
    // entirely before this fix; it now collapses onto `high`.
    await p.complete(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }], maxTokens: 1, reasoning: { effort: 'max' } },
      { signal: new AbortController().signal },
    );
    expect(captured?.['reasoning_effort']).toBe('high');

    // `minimal` collapses onto `low`.
    await p.complete(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }], maxTokens: 1, reasoning: { effort: 'minimal' } },
      { signal: new AbortController().signal },
    );
    expect(captured?.['reasoning_effort']).toBe('low');
  });

  it('leaves base-handled efforts untouched and skips when reasoning is disabled (#14)', async () => {
    let captured: Record<string, unknown> | undefined;
    const spy = vi.fn(async (_url: unknown, init: { body?: string } = {}) => {
      captured = JSON.parse(init.body ?? '{}');
      return { ok: true, status: 200, json: async () => ({ model: 'm', choices: [], usage: {} }), text: async () => '' };
    }) as never as typeof fetch;
    const p = new OpenAICompatibleProvider({
      id: 'deepseek',
      apiKey: 'k',
      baseUrl: 'https://api.deepseek.com/v1',
      fetchImpl: spy,
    });
    // medium is in OpenAI's set — emitted verbatim by the base builder, not remapped.
    await p.complete(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }], maxTokens: 1, reasoning: { effort: 'medium' } },
      { signal: new AbortController().signal },
    );
    expect(captured?.['reasoning_effort']).toBe('medium');

    // An out-of-set effort with reasoning explicitly disabled is not injected.
    await p.complete(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }], maxTokens: 1, reasoning: { enabled: false, effort: 'max' } },
      { signal: new AbortController().signal },
    );
    expect(captured?.['reasoning_effort']).toBeUndefined();
  });

  it('works without custom headers', async () => {
    const spy = mockFetchSpy();
    const p = new OpenAICompatibleProvider({
      id: 'plain',
      apiKey: 'k',
      baseUrl: 'https://example.com/v1',
      fetchImpl: spy as never as typeof fetch,
    });
    const res = await p.complete(
      { model: 'm', messages: [{ role: 'user', content: 'hi' }], maxTokens: 1 },
      { signal: new AbortController().signal },
    );
    expect(res.stopReason).toBe('end_turn');
  });
});
