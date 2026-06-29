import { describe, expect, it } from 'vitest';
import { discoverOpenAICompatibleModels, mapCompatibleModel } from '../src/auto-discover.js';

describe('mapCompatibleModel', () => {
  it('maps omniroute extended metadata onto a ModelsDevModel', () => {
    const m = mapCompatibleModel({
      id: 'cc/claude-opus-4-8',
      name: 'cc/Claude Opus 4.8',
      capabilities: { vision: true, tool_calling: true, reasoning: true, thinking: true },
      input_modalities: ['text', 'image'],
      output_modalities: ['text'],
      context_length: 1000000,
      max_output_tokens: 128000,
      max_input_tokens: 1000000,
      created: 1782750388,
    });
    expect(m).toMatchObject({
      id: 'cc/claude-opus-4-8',
      name: 'cc/Claude Opus 4.8',
      tool_call: true,
      reasoning: true,
      modalities: { input: ['text', 'image'], output: ['text'] },
      limit: { context: 1000000, output: 128000 },
    });
  });

  it('infers vision from an image input modality when capability flag is absent', () => {
    const m = mapCompatibleModel({
      id: 'x/vision-model',
      input_modalities: ['text', 'image'],
      capabilities: { tool_calling: false },
    });
    expect(m?.modalities?.input).toContain('image');
  });

  it('treats reasoning OR thinking as reasoning-capable', () => {
    expect(mapCompatibleModel({ id: 'a', capabilities: { thinking: true } })?.reasoning).toBe(true);
    expect(mapCompatibleModel({ id: 'b', capabilities: { reasoning: true } })?.reasoning).toBe(true);
    expect(mapCompatibleModel({ id: 'c', capabilities: {} })?.reasoning).toBe(false);
  });

  it('falls back to the id for the display name and drops invalid limits', () => {
    const m = mapCompatibleModel({ id: 'bare', context_length: 0, max_output_tokens: -1 });
    expect(m?.name).toBe('bare');
    expect(m?.limit).toBeUndefined();
  });

  it('returns undefined for an entry with no id', () => {
    expect(mapCompatibleModel({ name: 'no id' })).toBeUndefined();
  });
});

function mockModelsFetch(payload: unknown, ok = true): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(payload), {
      status: ok ? 200 : 500,
      headers: { 'content-type': 'application/json' },
    })) as never as typeof fetch;
}

describe('discoverOpenAICompatibleModels', () => {
  it('builds a ModelsDevProvider classified to the openai-compatible family', async () => {
    const provider = await discoverOpenAICompatibleModels('omniroute', {
      baseUrl: 'http://localhost:20128/v1',
      apiKey: 'k',
      fetchImpl: mockModelsFetch({
        object: 'list',
        data: [
          { id: 'cc/claude-opus-4-8', capabilities: { tool_calling: true, reasoning: true } },
          { id: 'openai/gpt-5-codex', capabilities: { tool_calling: true } },
        ],
      }),
    });
    expect(provider?.id).toBe('omniroute');
    expect(provider?.npm).toBe('@ai-sdk/openai-compatible');
    expect(provider?.api).toBe('http://localhost:20128/v1');
    expect(Object.keys(provider?.models ?? {})).toEqual([
      'cc/claude-opus-4-8',
      'openai/gpt-5-codex',
    ]);
  });

  it('returns undefined on a non-OK response (best-effort)', async () => {
    const provider = await discoverOpenAICompatibleModels('omniroute', {
      baseUrl: 'http://localhost:20128/v1',
      fetchImpl: mockModelsFetch({}, false),
    });
    expect(provider).toBeUndefined();
  });

  it('returns undefined on an empty list', async () => {
    const provider = await discoverOpenAICompatibleModels('omniroute', {
      baseUrl: 'http://localhost:20128/v1',
      fetchImpl: mockModelsFetch({ object: 'list', data: [] }),
    });
    expect(provider).toBeUndefined();
  });

  it('never throws on a network error', async () => {
    const provider = await discoverOpenAICompatibleModels('omniroute', {
      baseUrl: 'http://localhost:20128/v1',
      fetchImpl: (async () => {
        throw new Error('ECONNREFUSED');
      }) as never as typeof fetch,
    });
    expect(provider).toBeUndefined();
  });
});
