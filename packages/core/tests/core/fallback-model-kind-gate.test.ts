/**
 * Kind-gating of the cross-provider fallback extension: capacity/transport
 * failures (rate_limit, overloaded, server, timeout, network, stream_hang)
 * hop through the chain; request-shaped failures (auth, invalid_request,
 * context_overflow, content_filter) must surface unchanged — they would fail
 * identically on any provider, or need a different remedy (compaction, key
 * fix, model reroute) owned by the recovery-strategy layer.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Context } from '../../src/core/context.js';
import { createFallbackModelExtension } from '../../src/core/fallback-model.js';
import { EventBus } from '../../src/kernel/events.js';
import type { Config } from '../../src/types/config.js';
import type { Provider, Request, Response } from '../../src/types/provider.js';
import { ProviderError, StreamHangError } from '../../src/types/provider.js';

function makeProvider(id: string): Provider {
  return { id, capabilities: { streaming: false } } as never as Provider;
}

function makeConfig(): Config {
  return {
    provider: 'primary',
    model: 'model-a',
    fallbackModels: ['other/model-b'],
    providers: {
      primary: { type: 'openai', apiKey: 'k1' },
      other: { type: 'openai', apiKey: 'k2' },
    },
  } as never as Config;
}

function makeHarness() {
  const buildProvider = vi.fn(async (providerId: string) => makeProvider(providerId));
  const ext = createFallbackModelExtension({
    getConfig: makeConfig,
    buildProvider,
    events: new EventBus(),
    now: () => 1_000,
  });
  const ctx = {
    provider: makeProvider('primary'),
    model: 'model-a',
    session: { id: 's1' },
  } as never as Context;
  const request = { model: 'model-a', messages: [], maxTokens: 100 } as never as Request;
  return { ext, ctx, request, buildProvider };
}

const okResponse = {
  content: [{ type: 'text', text: 'ok' }],
  stopReason: 'end_turn',
  usage: { input: 1, output: 1 },
  model: 'model-b',
} as never as Response;

describe('fallback-model kind gating', () => {
  it('hops the chain on rate_limit (capacity failure)', async () => {
    const { ext, ctx, request, buildProvider } = makeHarness();
    const inner = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError('rate limited', 429, true, 'primary'))
      .mockResolvedValueOnce(okResponse);
    const res = await ext.wrapProviderRunner?.(ctx, request, inner);
    expect(res).toBe(okResponse);
    expect(buildProvider).toHaveBeenCalledWith('other', 'model-b');
    expect(ctx.model).toBe('model-b');
  });

  it('hops on stream_hang', async () => {
    const { ext, ctx, request, buildProvider } = makeHarness();
    const hang = new StreamHangError({
      providerId: 'primary',
      model: 'model-a',
      hangTimeoutMs: 1000,
      bytesReceived: 0,
      elapsedMs: 1000,
    });
    const inner = vi.fn().mockRejectedValueOnce(hang).mockResolvedValueOnce(okResponse);
    const res = await ext.wrapProviderRunner?.(ctx, request, inner);
    expect(res).toBe(okResponse);
    expect(buildProvider).toHaveBeenCalled();
  });

  it('does NOT hop on context_overflow — surfaces for compaction instead', async () => {
    const { ext, ctx, request, buildProvider } = makeHarness();
    const err = new ProviderError('anthropic HTTP 400', 400, false, 'primary', {
      body: { type: 'invalid_request_error', message: 'prompt is too long: 250000 tokens' },
    });
    const inner = vi.fn().mockRejectedValue(err);
    await expect(ext.wrapProviderRunner?.(ctx, request, inner)).rejects.toBe(err);
    expect(buildProvider).not.toHaveBeenCalled();
    expect(ctx.model).toBe('model-a');
  });

  it('does NOT hop on content_filter — the reroute strategy owns it', async () => {
    const { ext, ctx, request, buildProvider } = makeHarness();
    const err = new ProviderError('filtered', 400, false, 'primary', {
      body: { type: 'content_filter', message: 'The response was filtered' },
    });
    const inner = vi.fn().mockRejectedValue(err);
    await expect(ext.wrapProviderRunner?.(ctx, request, inner)).rejects.toBe(err);
    expect(buildProvider).not.toHaveBeenCalled();
  });

  it('does NOT hop on auth failures — a different provider needs a different key anyway', async () => {
    const { ext, ctx, request, buildProvider } = makeHarness();
    const err = new ProviderError('bad key', 401, false, 'primary');
    const inner = vi.fn().mockRejectedValue(err);
    await expect(ext.wrapProviderRunner?.(ctx, request, inner)).rejects.toBe(err);
    expect(buildProvider).not.toHaveBeenCalled();
  });

  it('hops on request timeout (408) — new capacity-kind behavior', async () => {
    const { ext, ctx, request, buildProvider } = makeHarness();
    const inner = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError('timeout', 408, true, 'primary'))
      .mockResolvedValueOnce(okResponse);
    const res = await ext.wrapProviderRunner?.(ctx, request, inner);
    expect(res).toBe(okResponse);
    expect(buildProvider).toHaveBeenCalled();
  });
});
