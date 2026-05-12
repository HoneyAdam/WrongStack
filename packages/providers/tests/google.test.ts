import { describe, it, expect, vi } from 'vitest';
import { GoogleProvider } from '../src/google.js';

function mockFetch(json: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
    text: async () => JSON.stringify(json),
  } as unknown as Response);
}

describe('GoogleProvider', () => {
  // Content-parsing tests live in streaming.test.ts since complete() wraps
  // stream() internally. This file covers headers, URLs, errors, and the
  // request-body shape.

  it('non-2xx becomes ProviderError', async () => {
    const fetchImpl = mockFetch({ error: 'bad' }, 400) as unknown as typeof fetch;
    const p = new GoogleProvider({ apiKey: 'k', fetchImpl });
    await expect(
      p.complete(
        { model: 'm', messages: [{ role: 'user', content: 'x' }], maxTokens: 1 },
        { signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('requires apiKey', () => {
    expect(() => new GoogleProvider({ apiKey: '' })).toThrow(/apiKey required/);
  });

  it('marks 429 and 5xx as retryable', async () => {
    const fetchImpl = mockFetch({}, 503) as unknown as typeof fetch;
    const p = new GoogleProvider({ apiKey: 'k', fetchImpl });
    await expect(
      p.complete(
        { model: 'm', messages: [{ role: 'user', content: 'x' }], maxTokens: 1 },
        { signal: new AbortController().signal },
      ),
    ).rejects.toMatchObject({ status: 503, retryable: true });
  });

  it('translates system, tool, tool_result through wire format', async () => {
    let body: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn(async (_url: unknown, init: { body?: string } = {}) => {
      body = JSON.parse(init.body ?? '{}');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { role: 'model', parts: [{ text: 'k' }] }, finishReason: 'stop' }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        }),
        text: async () => '',
      };
    }) as unknown as typeof fetch;
    const p = new GoogleProvider({ apiKey: 'k', fetchImpl });
    await p.complete(
      {
        model: 'gemini-2.5-flash',
        maxTokens: 50,
        temperature: 0.5,
        topP: 0.9,
        stopSequences: ['<end>'],
        system: [{ type: 'text', text: 'be terse' }],
        messages: [
          { role: 'user', content: 'see this' },
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'reading' },
              { type: 'tool_use', id: 'tu1', name: 'read', input: { path: 'a' } },
            ],
          },
          {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'tu1', content: 'data' },
            ],
          },
        ],
        tools: [
          {
            name: 'read',
            description: 'read',
            inputSchema: { type: 'object' },
            permission: 'auto',
            mutating: false,
            async execute() {
              return '';
            },
          },
        ],
      },
      { signal: new AbortController().signal },
    );
    expect(body?.['systemInstruction']).toEqual({ parts: [{ text: 'be terse' }] });
    const contents = body?.['contents'] as Array<{ role: string; parts: unknown[] }>;
    expect(contents.find((c) => c.role === 'model')).toBeDefined();
    expect(contents.find((c) => c.role === 'function')).toBeDefined();
    const tools = body?.['tools'] as Array<{ functionDeclarations: unknown[] }>;
    expect(tools[0]?.functionDeclarations).toHaveLength(1);
    const cfg = body?.['generationConfig'] as Record<string, unknown>;
    expect(cfg['temperature']).toBe(0.5);
    expect(cfg['stopSequences']).toEqual(['<end>']);
  });

  it('translates base64 image to inlineData part', async () => {
    let body: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn(async (_url: unknown, init: { body?: string } = {}) => {
      body = JSON.parse(init.body ?? '{}');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }],
          usageMetadata: {},
        }),
        text: async () => '',
      };
    }) as unknown as typeof fetch;
    const p = new GoogleProvider({ apiKey: 'k', fetchImpl });
    await p.complete(
      {
        model: 'gemini',
        maxTokens: 1,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'see' },
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAA' } },
            ],
          },
        ],
      },
      { signal: new AbortController().signal },
    );
    const contents = body?.['contents'] as Array<{ parts: Array<Record<string, unknown>> }>;
    const userParts = contents[0]!.parts;
    const inline = userParts.find((p) => p['inlineData']);
    expect(inline?.['inlineData']).toEqual({ mimeType: 'image/jpeg', data: 'AAA' });
  });
});
